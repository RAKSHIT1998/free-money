// Real, public, unauthenticated market data from SEVEN real exchanges (Binance,
// Coinbase, Kraken, Bybit, KuCoin, Bitget, Gate.io), built on ccxt — the same
// unified exchange library freqtrade (github.com/freqtrade/freqtrade) itself wraps
// everything around. No API keys, no orders, no account access of any kind; every
// call here is public ticker data anyone could curl.
//
// OKX was evaluated and dropped — its public REST endpoint timed out repeatedly
// from this environment (network/geo issue, not a code problem). Worth retrying in
// a different deployment environment if you want it back; see EXCHANGE_IDS below.
//
// Two ideas below are deliberately ported from freqtrade's own architecture rather
// than invented fresh:
//
// 1. Dynamic, volume-ranked pairlist (freqtrade's VolumePairList) instead of a fixed
//    hardcoded watchlist — the tradeable universe is derived every refresh from each
//    exchange's own top-quoteVolume markets, not a list someone has to remember to
//    update. Binance is the ANCHOR exchange (deepest, most complete USDT listings
//    among the seven): every candidate starts as a Binance USDT market, then each
//    OTHER configured exchange is checked for whether it also lists that asset (in
//    its own quote currency). "Combined volume" is the MIN quote volume across every
//    exchange that has it, not freqtrade's plain single-exchange sort key, because a
//    cross-exchange spread is only as tradeable as its least liquid leg — and an
//    asset only makes the list at all if at least one exchange besides Binance
//    actually lists it, since there's nothing to arbitrage against otherwise.
// 2. Spread filter (freqtrade's SpreadFilter, same formula: 1 - bid/ask) — rejects
//    any quote whose OWN bid/ask gap is already wide before it's ever compared
//    across exchanges. A wide same-exchange spread means the quote is thin/stale,
//    and a "cross-exchange opportunity" built on it is measuring noise, not a real
//    price gap.
//
// A third idea is NOT from freqtrade (freqtrade itself is REST/candle-based, not a
// streaming HFT system) but from what genuine high-frequency price data requires:
// 3. WebSocket streaming instead of REST polling for the live bid/ask quotes used in
//    spread detection, via ccxt.pro (bundled free in the same `ccxt` package since
//    v2 — no separate license). REST polling tops out at how often it's reasonable
//    to hammer a public REST endpoint; a WebSocket top-of-book subscription instead
//    pushes an update the instant the exchange's own order book changes — Binance's
//    bookTicker stream ticked every 60-100ms in testing, not once every 60 seconds.
//    One persistent multi-symbol subscription per exchange is kept open (not one
//    per asset): ccxt.pro's watchBidsAsks(symbols) call blocks until ANY of the
//    subscribed symbols updates and returns just that symbol's fresh quote, so a
//    single background loop per exchange keeps an in-memory cache current. Reading
//    that cache (getLiveQuotes) is then a pure in-memory operation with no network
//    round-trip — a "scan" can run as often as the agent wants, in milliseconds.
//    Honest limits: this is real-time retail market data, not co-located
//    microsecond execution infrastructure — see crossExchangeArbitrageAgent.js for
//    why this scanner still doesn't place orders.
//
// The pairlist (WHICH assets to watch) is still refreshed on its own slow TTL
// (freqtrade's pairlist `refresh_period`, default 30 min) via REST, since ranking by
// volume across a whole exchange doesn't have a meaningful streaming equivalent and
// doesn't need to happen every scan.
const ccxt = require('ccxt');

const RETRY_COUNT = 4; // matches freqtrade's exchange/common.py API_RETRY_COUNT default

// freqtrade's exchange/common.py calculate_backoff(): quadratic backoff that grows
// with each retry rather than a flat delay, so a real outage doesn't get hammered
// with retries at a fixed interval.
function calculateBackoffMs(remainingRetries, maxRetries) {
  return ((maxRetries - remainingRetries) ** 2 + 1) * 1000;
}

/**
 * Retries a ccxt call on transient network/exchange-availability errors (ccxt's
 * NetworkError covers ExchangeNotAvailable, DDoSProtection, RequestTimeout —
 * mirrors freqtrade's TemporaryError umbrella). Non-network errors (bad symbol,
 * auth) fail immediately since retrying them can't help.
 */
async function withRetry(fn, retries = RETRY_COUNT) {
  let remaining = retries;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      if (!(error instanceof ccxt.NetworkError) || remaining <= 0) throw error;
      const delayMs = calculateBackoffMs(remaining, retries);
      remaining -= 1;
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

// The seven exchanges this scanner watches. Binance/Bybit/KuCoin/Bitget/Gate quote
// their main spot markets in USDT; Coinbase/Kraken in USD.
const EXCHANGE_QUOTE_CURRENCY = {
  binance: 'USDT',
  coinbase: 'USD',
  kraken: 'USD',
  bybit: 'USDT',
  kucoin: 'USDT',
  bitget: 'USDT',
  gate: 'USDT'
};
const EXCHANGE_IDS = Object.keys(EXCHANGE_QUOTE_CURRENCY);

// Per-exchange ccxt constructor options some exchanges need to behave correctly for
// SPOT markets specifically — without this, Bybit's unified ticker calls default to
// a different market type and silently return empty bid/ask/volume fields (verified
// against the live API: fetchTickers() with no options returned {} for BTC/USDT).
const EXCHANGE_CCXT_OPTIONS = {
  bybit: { options: { defaultType: 'spot' } }
};
// Extra per-call params fetchTickers needs for the same reason.
const EXCHANGE_TICKERS_PARAMS = {
  bybit: { type: 'spot' }
};

// Coinbase's BULK fetchTickers() doesn't populate bid/ask (confirmed against the
// live API — only its per-symbol fetchTicker() does), so the spread filter can't be
// applied at ranking time for it the way it can for the other six. That's fine: the
// spread filter's real job — keeping bad quotes out of an actual spread comparison —
// still happens downstream in getLiveQuotes() against the WS-streamed cache, which
// DOES have real bid/ask for every exchange including Coinbase, and is fresher than
// a ranking-time REST snapshot would have been anyway.
const EXCHANGES_WITHOUT_BULK_BID_ASK = new Set(['coinbase']);

// Default taker-fee estimates for each exchange's LOWEST volume tier — real fee
// schedules vary by account volume/status, so these are a conservative starting
// point, not a guarantee. Override via env if your actual tier differs, since
// getting this wrong directly skews which spreads look profitable.
const DEFAULT_TAKER_FEES = {
  binance: parseFloat(process.env.ARB_TAKER_FEE_BINANCE) || 0.001,   // 0.10%
  coinbase: parseFloat(process.env.ARB_TAKER_FEE_COINBASE) || 0.006, // 0.60%
  kraken: parseFloat(process.env.ARB_TAKER_FEE_KRAKEN) || 0.0026,    // 0.26%
  bybit: parseFloat(process.env.ARB_TAKER_FEE_BYBIT) || 0.001,       // 0.10%
  kucoin: parseFloat(process.env.ARB_TAKER_FEE_KUCOIN) || 0.001,     // 0.10%
  bitget: parseFloat(process.env.ARB_TAKER_FEE_BITGET) || 0.001,     // 0.10%
  gate: parseFloat(process.env.ARB_TAKER_FEE_GATE) || 0.002          // 0.20%
};

// One REST instance and one ccxt.pro (WebSocket) instance per exchange. Constructing
// these doesn't open any connection — that happens lazily on first use.
const restExchanges = {};
const wsExchanges = {};
for (const id of EXCHANGE_IDS) {
  const opts = { enableRateLimit: true, ...(EXCHANGE_CCXT_OPTIONS[id] || {}) };
  restExchanges[id] = new ccxt[id](opts);
  wsExchanges[id] = new ccxt.pro[id](opts);
}

/**
 * freqtrade's SpreadFilter, verbatim formula: spread = 1 - bid/ask.
 * @param {{bid: number, ask: number}} ticker
 * @param {number} maxSpreadRatio
 * @returns {boolean} true if the quote is tight enough to keep
 */
function passesSpreadFilter(ticker, maxSpreadRatio) {
  if (!ticker || !(ticker.bid > 0) || !(ticker.ask > 0)) return false;
  const spread = 1 - ticker.bid / ticker.ask;
  return spread <= maxSpreadRatio;
}

let pairlistCache = { pairs: null, generatedAt: 0, expiresAt: 0 };

/**
 * Rebuilds the tradeable-asset pairlist across all seven exchanges — see the header
 * comment for the anchor-on-Binance algorithm. This is the slow/periodic phase —
 * equivalent to freqtrade's VolumePairList + SpreadFilter pairlist generators.
 * @param {Object} options
 * @param {number} options.numberAssets Top-N assets to keep (freqtrade: number_assets)
 * @param {number} options.minQuoteVolumeUsd Floor on combined 24h quote volume (freqtrade: min_value)
 * @param {number} options.maxSpreadRatio Max same-exchange bid/ask spread ratio (freqtrade: max_spread_ratio)
 * @returns {Promise<Array<{asset: string, exchangesPresent: string[], combinedVolumeUsd: number}>>}
 */
async function buildPairlist({ numberAssets = 15, minQuoteVolumeUsd = 2000000, maxSpreadRatio = 0.005 } = {}) {
  const tickersByExchange = {};
  await Promise.all(EXCHANGE_IDS.map(async id => {
    try {
      tickersByExchange[id] = await withRetry(() => restExchanges[id].fetchTickers(undefined, EXCHANGE_TICKERS_PARAMS[id]));
    } catch (error) {
      // One exchange being down for this refresh shouldn't block ranking against the
      // other six — it's just excluded from candidates until the next refresh.
      tickersByExchange[id] = {};
    }
  }));

  const binanceTickers = tickersByExchange.binance || {};
  const candidates = [];
  for (const [symbol, bTicker] of Object.entries(binanceTickers)) {
    if (!symbol.endsWith('/USDT')) continue;
    const asset = symbol.split('/')[0];
    if (!(bTicker.quoteVolume > 0) || !passesSpreadFilter(bTicker, maxSpreadRatio)) continue;

    const volumeByExchange = { binance: bTicker.quoteVolume };
    for (const id of EXCHANGE_IDS) {
      if (id === 'binance') continue;
      const symbolOnExchange = `${asset}/${EXCHANGE_QUOTE_CURRENCY[id]}`;
      const ticker = tickersByExchange[id]?.[symbolOnExchange];
      const spreadOk = EXCHANGES_WITHOUT_BULK_BID_ASK.has(id) || passesSpreadFilter(ticker, maxSpreadRatio);
      if (ticker && ticker.quoteVolume > 0 && spreadOk) {
        volumeByExchange[id] = ticker.quoteVolume;
      }
    }

    const exchangesPresent = Object.keys(volumeByExchange);
    if (exchangesPresent.length < 2) continue; // nothing to arbitrage against

    const combinedVolumeUsd = Math.min(...Object.values(volumeByExchange));
    if (combinedVolumeUsd < minQuoteVolumeUsd) continue;

    candidates.push({ asset, exchangesPresent, combinedVolumeUsd });
  }

  candidates.sort((a, b) => b.combinedVolumeUsd - a.combinedVolumeUsd);
  return candidates.slice(0, numberAssets);
}

/**
 * Returns the current pairlist, rebuilding it if the TTL has expired. Exposed
 * synchronously via getCachedPairlistAssets() for status/dashboard display.
 */
async function getPairlist(config, refreshMs) {
  const now = Date.now();
  if (pairlistCache.pairs && now < pairlistCache.expiresAt) {
    return pairlistCache.pairs;
  }
  const pairs = await buildPairlist(config);
  pairlistCache = { pairs, generatedAt: now, expiresAt: now + refreshMs };
  return pairs;
}

function getCachedPairlistAssets() {
  return (pairlistCache.pairs || []).map(p => p.asset);
}

// === WebSocket streaming layer (real-time quotes, no REST round-trip per scan) ===

// quoteCache[exchangeId][asset] = { bid, ask, updatedAt } — filled entirely by the
// background streamLoop()s below, read entirely by getLiveQuotes(). Never touched
// by REST code, so a slow/stuck REST pairlist refresh can never block live quotes.
const quoteCache = {};

// A failed watch* call is caught and retried silently by design (a single dropped
// connection shouldn't spam logs on every backoff tick) — but silent forever makes a
// real, ongoing connection problem indistinguishable from "briefly reconnecting".
// This tracks per-exchange connection health so it's actually observable (surfaced
// through getStreamHealth() → the agent's getStatusExtended()) instead of a black box.
const streamHealth = {};
for (const id of EXCHANGE_IDS) {
  quoteCache[id] = {};
  streamHealth[id] = { status: 'connecting', lastTickAt: null, lastError: null, consecutiveErrors: 0 };
}

const streamState = {
  running: false,
  stopRequested: false,
  getWatchedAssets: () => []
};

function symbolForExchange(exchangeId, asset) {
  // ccxt normalizes every exchange's own symbol/asset-code quirks (e.g. Kraken's
  // legacy XBT/XDG) to the same "BASE/QUOTE" form, so this only needs to know each
  // exchange's preferred quote currency, not any exchange-specific naming.
  return `${asset}/${EXCHANGE_QUOTE_CURRENCY[exchangeId]}`;
}

/**
 * Persistent per-exchange WebSocket loop: repeatedly awaits the next tick for any
 * currently-watched symbol and writes it into quoteCache. Runs until stopStreaming()
 * is called. A dropped connection surfaces as a thrown error from the watch* call;
 * that's caught, backed off (capped exponential, reset after any healthy tick), and
 * retried indefinitely — ccxt.pro reconnects transparently on the next watch call.
 * @param {string} exchangeId
 */
async function streamLoop(exchangeId) {
  const exchange = wsExchanges[exchangeId];
  let backoffMs = 1000;
  while (!streamState.stopRequested) {
    const assets = streamState.getWatchedAssets();
    if (assets.length === 0) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      continue;
    }
    const symbols = assets.map(asset => symbolForExchange(exchangeId, asset));
    try {
      // watchBidsAsks is the lightest channel (top-of-book only) where an exchange
      // exposes it; otherwise fall back to the ticker channel, which also carries
      // bid/ask (confirmed for every exchange here — Coinbase doesn't expose
      // watchBidsAsks in ccxt, for example, but its ticker channel works fine).
      const update = exchange.has.watchBidsAsks
        ? await exchange.watchBidsAsks(symbols)
        : await exchange.watchTickers(symbols);

      const now = Date.now();
      for (const [symbol, ticker] of Object.entries(update)) {
        const asset = symbol.split('/')[0];
        if (ticker && ticker.bid > 0 && ticker.ask > 0) {
          quoteCache[exchangeId][asset] = { bid: ticker.bid, ask: ticker.ask, updatedAt: now };
        }
      }
      backoffMs = 1000;
      streamHealth[exchangeId] = { status: 'connected', lastTickAt: now, lastError: null, consecutiveErrors: 0 };
    } catch (error) {
      if (streamState.stopRequested) break;
      streamHealth[exchangeId] = {
        ...streamHealth[exchangeId],
        status: 'reconnecting',
        lastError: error.message,
        consecutiveErrors: streamHealth[exchangeId].consecutiveErrors + 1
      };
      await new Promise(resolve => setTimeout(resolve, backoffMs));
      backoffMs = Math.min(backoffMs * 2, 30000);
    }
  }
}

function getStreamHealth() {
  return JSON.parse(JSON.stringify(streamHealth));
}

/**
 * Starts the background WebSocket loops (one per exchange) if not already running.
 * Idempotent — safe to call every scan cycle. getWatchedAssets is a live getter (not
 * a snapshot) so the streams automatically pick up new symbols as the REST pairlist
 * refresh changes it, with no explicit restart needed.
 * @param {() => string[]} getWatchedAssets
 */
function startStreaming(getWatchedAssets) {
  streamState.getWatchedAssets = getWatchedAssets;
  if (streamState.running) return;
  streamState.running = true;
  streamState.stopRequested = false;
  for (const exchangeId of EXCHANGE_IDS) {
    streamLoop(exchangeId);
  }
}

/**
 * Stops all background streaming loops and closes their WebSocket connections.
 * @returns {Promise<void>}
 */
async function stopStreaming() {
  streamState.stopRequested = true;
  streamState.running = false;
  await Promise.all(Object.values(wsExchanges).map(exchange => exchange.close().catch(() => {})));
}

const DEFAULT_STALE_QUOTE_MS = 15000;

/**
 * Pure in-memory read of the live quote cache — no network I/O, so this can be
 * called as often as the caller wants. A quote is dropped (and surfaced as an
 * error, same shape as before) if it's never arrived yet, has gone stale (the
 * stream stopped ticking — e.g. a silent disconnect), or fails the spread filter.
 * @param {string[]} assets
 * @param {Object} options
 * @param {number} options.maxSpreadRatio
 * @param {number} options.staleMs
 * @returns {Array<{asset: string, quotes: Array<{exchange: string, bid: number, ask: number}>, errors: Array<string>}>}
 */
function getLiveQuotes(assets, { maxSpreadRatio = 0.005, staleMs = DEFAULT_STALE_QUOTE_MS } = {}) {
  const now = Date.now();
  return assets.map(asset => {
    const quotes = [];
    const errors = [];
    for (const exchangeId of EXCHANGE_IDS) {
      const cached = quoteCache[exchangeId][asset];
      if (!cached) {
        errors.push(`${exchangeId}: no live quote received yet for ${asset}`);
        continue;
      }
      const ageMs = now - cached.updatedAt;
      if (ageMs > staleMs) {
        errors.push(`${exchangeId}: stale quote for ${asset} (${Math.round(ageMs / 1000)}s old — stream may be disconnected)`);
        continue;
      }
      if (!passesSpreadFilter(cached, maxSpreadRatio)) {
        errors.push(`${exchangeId}: quote for ${asset} failed spread filter`);
        continue;
      }
      quotes.push({ exchange: exchangeId, bid: cached.bid, ask: cached.ask });
    }
    return { asset, quotes, errors };
  });
}

module.exports = {
  EXCHANGE_IDS,
  DEFAULT_TAKER_FEES,
  buildPairlist,
  getPairlist,
  getCachedPairlistAssets,
  startStreaming,
  stopStreaming,
  getLiveQuotes,
  getStreamHealth
};

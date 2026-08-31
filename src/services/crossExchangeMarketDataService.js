// Real, public, unauthenticated market data from three real exchanges (Binance,
// Coinbase, Kraken), built on ccxt — the same unified exchange library freqtrade
// (github.com/freqtrade/freqtrade) itself wraps everything around. No API keys, no
// orders, no account access of any kind; every call here is public ticker data
// anyone could curl.
//
// Two ideas below are deliberately ported from freqtrade's own architecture rather
// than invented fresh:
//
// 1. Dynamic, volume-ranked pairlist (freqtrade's VolumePairList) instead of a fixed
//    hardcoded watchlist — the tradeable universe is derived every refresh from each
//    exchange's own top-quoteVolume markets, not a list someone has to remember to
//    update. "Combined volume" here is the MIN of the two exchanges' 24h quote
//    volume rather than freqtrade's plain sort key, because a cross-exchange spread
//    is only as tradeable as its less liquid leg.
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

// Default taker-fee estimates for each exchange's LOWEST volume tier — real fee
// schedules vary by account volume/status, so these are a conservative starting
// point, not a guarantee. Override via env if your actual tier differs, since
// getting this wrong directly skews which spreads look profitable.
const DEFAULT_TAKER_FEES = {
  binance: parseFloat(process.env.ARB_TAKER_FEE_BINANCE) || 0.001,   // 0.10%
  coinbase: parseFloat(process.env.ARB_TAKER_FEE_COINBASE) || 0.006, // 0.60%
  kraken: parseFloat(process.env.ARB_TAKER_FEE_KRAKEN) || 0.0026     // 0.26%
};

const binance = new ccxt.binance({ enableRateLimit: true });
const coinbase = new ccxt.coinbase({ enableRateLimit: true });
const kraken = new ccxt.kraken({ enableRateLimit: true });

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
 * Rebuilds the tradeable-asset pairlist: intersects Binance's USDT markets with
 * Coinbase's USD markets, ranks by combined (min of both) 24h quote volume, applies
 * the spread filter, and keeps the top N. This is the slow/periodic phase —
 * equivalent to freqtrade's VolumePairList + SpreadFilter pairlist generators.
 * @param {Object} options
 * @param {number} options.numberAssets Top-N assets to keep (freqtrade: number_assets)
 * @param {number} options.minQuoteVolumeUsd Floor on combined 24h quote volume (freqtrade: min_value)
 * @param {number} options.maxSpreadRatio Max same-exchange bid/ask spread ratio (freqtrade: max_spread_ratio)
 * @returns {Promise<Array<{asset: string, binanceSymbol: string, coinbaseSymbol: string, combinedVolumeUsd: number}>>}
 */
async function buildPairlist({ numberAssets = 15, minQuoteVolumeUsd = 2000000, maxSpreadRatio = 0.005 } = {}) {
  const [binanceTickers, coinbaseTickers] = await Promise.all([
    withRetry(() => binance.fetchTickers()),
    withRetry(() => coinbase.fetchTickers())
  ]);

  const candidates = [];
  for (const [symbol, bTicker] of Object.entries(binanceTickers)) {
    if (!symbol.endsWith('/USDT')) continue;
    const asset = symbol.split('/')[0];
    const coinbaseSymbol = `${asset}/USD`;
    const cTicker = coinbaseTickers[coinbaseSymbol];
    if (!cTicker) continue; // not cross-listed — nothing to arbitrage against

    if (!(bTicker.quoteVolume > 0) || !(cTicker.quoteVolume > 0)) continue;
    const combinedVolumeUsd = Math.min(bTicker.quoteVolume, cTicker.quoteVolume);
    if (combinedVolumeUsd < minQuoteVolumeUsd) continue;

    if (!passesSpreadFilter(bTicker, maxSpreadRatio)) continue;

    candidates.push({ asset, binanceSymbol: symbol, coinbaseSymbol, combinedVolumeUsd });
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

// Separate long-lived ccxt.pro instances from the plain REST ones above — WS
// subscriptions are stateful (open sockets, subscription lists) and need their own
// exchange objects. Constructing these doesn't open a connection; that happens
// lazily on the first watch*() call inside streamLoop.
const wsExchanges = {
  binance: new ccxt.pro.binance({ enableRateLimit: true }),
  coinbase: new ccxt.pro.coinbase({ enableRateLimit: true }),
  kraken: new ccxt.pro.kraken({ enableRateLimit: true })
};

// quoteCache[exchangeId][asset] = { bid, ask, updatedAt } — filled entirely by the
// background streamLoop()s below, read entirely by getLiveQuotes(). Never touched
// by REST code, so a slow/stuck REST pairlist refresh can never block live quotes.
const quoteCache = { binance: {}, coinbase: {}, kraken: {} };

// A failed watch* call is caught and retried silently by design (a single dropped
// connection shouldn't spam logs on every backoff tick) — but silent forever makes a
// real, ongoing connection problem indistinguishable from "briefly reconnecting".
// This tracks per-exchange connection health so it's actually observable (surfaced
// through getStreamHealth() → the agent's getStatusExtended()) instead of a black box.
const streamHealth = {
  binance: { status: 'connecting', lastTickAt: null, lastError: null, consecutiveErrors: 0 },
  coinbase: { status: 'connecting', lastTickAt: null, lastError: null, consecutiveErrors: 0 },
  kraken: { status: 'connecting', lastTickAt: null, lastError: null, consecutiveErrors: 0 }
};

const streamState = {
  running: false,
  stopRequested: false,
  getWatchedAssets: () => []
};

function symbolForExchange(exchangeId, asset) {
  // Binance quotes this scanner's pairlist in USDT (see buildPairlist); Coinbase and
  // Kraken in USD. ccxt normalizes both exchanges' own symbol/asset-code quirks
  // (e.g. Kraken's legacy XBT/XDG) to the same "BASE/QUOTE" form either way.
  return exchangeId === 'binance' ? `${asset}/USDT` : `${asset}/USD`;
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
      // watchBidsAsks (Binance, Kraken) is the lightest channel — top-of-book only.
      // Coinbase doesn't expose it in ccxt; its ticker channel carries bid/ask too.
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
 * Starts the three background WebSocket loops if not already running. Idempotent —
 * safe to call every scan cycle. getWatchedAssets is a live getter (not a snapshot)
 * so the streams automatically pick up new symbols as the REST pairlist refresh
 * changes it, with no explicit restart needed.
 * @param {() => string[]} getWatchedAssets
 */
function startStreaming(getWatchedAssets) {
  streamState.getWatchedAssets = getWatchedAssets;
  if (streamState.running) return;
  streamState.running = true;
  streamState.stopRequested = false;
  for (const exchangeId of Object.keys(wsExchanges)) {
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
    for (const exchangeId of Object.keys(wsExchanges)) {
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
  DEFAULT_TAKER_FEES,
  buildPairlist,
  getPairlist,
  getCachedPairlistAssets,
  startStreaming,
  stopStreaming,
  getLiveQuotes,
  getStreamHealth
};

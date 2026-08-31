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
// The pairlist (WHICH assets to watch) is refreshed on its own slow TTL (freqtrade's
// pairlist `refresh_period`, default 30 min) since ranking by volume doesn't need to
// happen every scan; the actual bid/ask quotes used for spread detection are fetched
// fresh every call to getAllQuotes(), since that's the whole point of a live scan.
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

/**
 * Fast phase: for the current pairlist, fetches fresh bid/ask from all three
 * exchanges and applies the spread filter per-quote (a quote that was tight when
 * the pairlist was built can still go stale/wide moment to moment). Binance's bulk
 * fetchTickers() already carries bid/ask; Coinbase's bulk tickers don't (confirmed
 * against the live API), so its shortlist is fetched per-symbol; Kraken is fetched
 * as a single batched fetchTickers(symbols) call for the shortlist.
 * @param {Object} config Same shape as buildPairlist's options, plus pairlistRefreshMs
 * @returns {Promise<Array<{asset: string, quotes: Array<{exchange: string, bid: number, ask: number}>, errors: Array<string>}>>}
 */
async function getAllQuotes(config = {}) {
  const {
    numberAssets = 15,
    minQuoteVolumeUsd = 2000000,
    maxSpreadRatio = 0.005,
    pairlistRefreshMs = 1800000
  } = config;

  const pairs = await getPairlist({ numberAssets, minQuoteVolumeUsd, maxSpreadRatio }, pairlistRefreshMs);

  let binanceTickers = {};
  const globalErrors = [];
  try {
    binanceTickers = await withRetry(() => binance.fetchTickers(pairs.map(p => p.binanceSymbol)));
  } catch (error) {
    globalErrors.push(`binance: ${error.message}`);
  }

  let krakenTickers = {};
  try {
    krakenTickers = await withRetry(() => kraken.fetchTickers(pairs.map(p => `${p.asset}/USD`)));
  } catch (error) {
    globalErrors.push(`kraken: ${error.message}`);
  }

  const out = [];
  for (const pair of pairs) {
    const quotes = [];
    const errors = [...globalErrors];

    const bTicker = binanceTickers[pair.binanceSymbol];
    if (passesSpreadFilter(bTicker, maxSpreadRatio)) {
      quotes.push({ exchange: 'binance', bid: bTicker.bid, ask: bTicker.ask });
    } else if (!globalErrors.some(e => e.startsWith('binance:'))) {
      errors.push(`binance: no valid tight-spread quote for ${pair.binanceSymbol}`);
    }

    try {
      const cTicker = await withRetry(() => coinbase.fetchTicker(pair.coinbaseSymbol));
      if (passesSpreadFilter(cTicker, maxSpreadRatio)) {
        quotes.push({ exchange: 'coinbase', bid: cTicker.bid, ask: cTicker.ask });
      } else {
        errors.push(`coinbase: quote for ${pair.coinbaseSymbol} failed spread filter`);
      }
    } catch (error) {
      errors.push(`coinbase: ${error.message}`);
    }

    const kTicker = krakenTickers[`${pair.asset}/USD`];
    if (passesSpreadFilter(kTicker, maxSpreadRatio)) {
      quotes.push({ exchange: 'kraken', bid: kTicker.bid, ask: kTicker.ask });
    } else if (!globalErrors.some(e => e.startsWith('kraken:'))) {
      errors.push(`kraken: no valid tight-spread quote for ${pair.asset}/USD`);
    }

    out.push({ asset: pair.asset, quotes, errors });

    // Courtesy delay between Coinbase per-symbol calls (the only per-asset loop
    // left, now that Binance/Kraken are single batched calls per scan).
    if (pairs.indexOf(pair) < pairs.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }
  return out;
}

module.exports = {
  DEFAULT_TAKER_FEES,
  buildPairlist,
  getAllQuotes,
  getCachedPairlistAssets
};

// Shared technical indicator math. Used by BOTH the live trading agents and the
// backtest engine, so a backtest result actually reflects what the live agent would
// have done — if these ever diverge, the backtest becomes meaningless.

/**
 * Standard Wilder-style RSI over the last `period` closes.
 * @param {number[]} closes closing prices, oldest -> newest
 * @param {number} period
 * @returns {number|null} RSI 0-100, or null if not enough data
 */
function calculateRsi(closes, period = 14) {
  if (closes.length < period + 1) return null;

  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) gains += change;
    else losses -= change;
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

/**
 * Breakout signal: is the latest candle within nearHighThresholdPct of the highest
 * high over the trailing `lookback` candles, AND has price risen at least
 * momentumThresholdPct over that same window? Mirrors breakoutFuturesAgent's live
 * 24hr-ticker-based signal, but computed from raw candles so it can run over
 * historical data.
 * @param {Array<{high:number, close:number}>} candles oldest -> newest, at least lookback+1 long
 * @param {number} lookback e.g. 24 (24 hourly candles = 24h)
 * @param {number} nearHighThresholdPct e.g. 0.001
 * @param {number} momentumThresholdPct e.g. 5 (percent, not fraction)
 * @returns {boolean}
 */
function isBreakoutSignal(candles, lookback, nearHighThresholdPct, momentumThresholdPct) {
  if (candles.length < lookback + 1) return false;

  const window = candles.slice(-lookback - 1, -1); // the lookback candles BEFORE the current one
  const current = candles[candles.length - 1];
  const windowHigh = Math.max(...window.map(c => c.high));
  const windowStartClose = window[0].close;

  const nearHigh = current.close >= windowHigh * (1 - nearHighThresholdPct);
  const momentumPct = ((current.close - windowStartClose) / windowStartClose) * 100;

  return nearHigh && momentumPct >= momentumThresholdPct;
}

/**
 * Exponential moving average series over closes.
 * @param {number[]} closes oldest -> newest
 * @param {number} period
 * @returns {Array<number|null>} EMA at each index, null where insufficient data
 */
function calculateEmaSeries(closes, period) {
  const k = 2 / (period + 1);
  const result = new Array(closes.length).fill(null);
  if (closes.length < period) return result;

  let sma = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[period - 1] = sma;
  let prevEma = sma;
  for (let i = period; i < closes.length; i++) {
    prevEma = closes[i] * k + prevEma * (1 - k);
    result[i] = prevEma;
  }
  return result;
}

/**
 * EMA crossover trend-following signal: fast EMA crosses above slow EMA on the
 * current candle (was below or equal on the previous candle). Classic, well-known
 * trend-following entry — not a claim it's profitable here, just a distinct signal
 * source from the breakout/mean-reversion ones already tested.
 * @param {number[]} fastEma
 * @param {number[]} slowEma
 * @param {number} i current index
 * @returns {boolean}
 */
function isEmaCrossoverSignal(fastEma, slowEma, i) {
  if (i < 1) return false;
  if (fastEma[i] === null || slowEma[i] === null || fastEma[i - 1] === null || slowEma[i - 1] === null) return false;
  const wasBelow = fastEma[i - 1] <= slowEma[i - 1];
  const isAbove = fastEma[i] > slowEma[i];
  return wasBelow && isAbove;
}

/**
 * Bollinger Bands (SMA +/- stdDevMultiplier * standard deviation) at one index.
 * @param {number[]} closes oldest -> newest
 * @param {number} i current index
 * @param {number} period
 * @param {number} stdDevMultiplier
 * @returns {{middle:number, upper:number, lower:number}|null}
 */
function calculateBollingerBands(closes, i, period = 20, stdDevMultiplier = 2) {
  if (i < period - 1) return null;
  const window = closes.slice(i - period + 1, i + 1);
  const middle = window.reduce((a, b) => a + b, 0) / period;
  const variance = window.reduce((sum, c) => sum + Math.pow(c - middle, 2), 0) / period;
  const stdDev = Math.sqrt(variance);
  return { middle, upper: middle + stdDevMultiplier * stdDev, lower: middle - stdDevMultiplier * stdDev };
}

/**
 * Bollinger Band mean-reversion signal: current close at or below the lower band —
 * a different mean-reversion trigger than RSI (price-dispersion-based rather than
 * momentum-based), testing whether that distinction actually matters historically.
 * @param {number[]} closes oldest -> newest
 * @param {number} i current index
 * @param {number} period
 * @param {number} stdDevMultiplier
 * @returns {boolean}
 */
function isBollingerBounceSignal(closes, i, period = 20, stdDevMultiplier = 2) {
  const bands = calculateBollingerBands(closes, i, period, stdDevMultiplier);
  if (!bands) return false;
  return closes[i] <= bands.lower;
}

/**
 * Volume-spike signal: the current candle's volume is a large multiple of the
 * trailing average volume, AND the candle itself closed up by at least
 * minPriceChangePct. Distinct from every other signal tested so far (all
 * price-only) — the idea is that unusual volume often precedes or accompanies a
 * meme-coin pump, before price momentum alone would register. Not a claim this is
 * profitable, just a genuinely different hypothesis worth backtesting.
 * @param {Array<{open:number, close:number, volume:number}>} candles oldest -> newest
 * @param {number} i current index
 * @param {number} lookback candles to average volume over (not including candle i)
 * @param {number} volumeMultiplier e.g. 3 for "3x average volume"
 * @param {number} minPriceChangePct e.g. 1 for "at least 1% up on this candle"
 * @returns {boolean}
 */
function isVolumeSpikeSignal(candles, i, lookback = 20, volumeMultiplier = 3, minPriceChangePct = 1) {
  if (i < lookback) return false;

  const window = candles.slice(i - lookback, i);
  const avgVolume = window.reduce((sum, c) => sum + c.volume, 0) / lookback;
  if (avgVolume <= 0) return false;

  const current = candles[i];
  const priceChangePct = ((current.close - current.open) / current.open) * 100;

  return current.volume >= avgVolume * volumeMultiplier && priceChangePct >= minPriceChangePct;
}

module.exports = {
  calculateRsi,
  isBreakoutSignal,
  calculateEmaSeries,
  isEmaCrossoverSignal,
  calculateBollingerBands,
  isBollingerBounceSignal,
  isVolumeSpikeSignal
};

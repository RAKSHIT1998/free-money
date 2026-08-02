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

module.exports = { calculateRsi, isBreakoutSignal };

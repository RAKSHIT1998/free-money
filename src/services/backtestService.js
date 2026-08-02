// Historical backtesting engine — runs the SAME signal logic and SAME risk parameters
// (leverage, stop-loss, take-profit) as the live agents against real historical price
// data, to answer "would this strategy actually have made money" before trusting it
// with more real capital. This is not a claim that past performance predicts future
// results — markets change regime — but it's the minimum diligence that should exist
// before running a strategy live, and it never existed for breakoutFutures or
// meanReversionFutures until now.
//
// Known limitations (stated plainly, not hidden):
// - No slippage modeling. Real fills, especially on illiquid symbols, are worse than
//   the close price used here.
// - Commission approximated at 0.05% per side (Binance USDT-M futures taker rate),
//   applied to both entry and exit.
// - The breakout signal here is reconstructed from raw candles (rolling high +
//   momentum over `lookback` candles), NOT the live agent's exact code path (which
//   scans Binance's bulk 24hr ticker endpoint across hundreds of symbols for
//   efficiency). Same underlying idea, not byte-for-byte the same signal source.
// - Backtests a fixed small set of liquid symbols, not the full ~500-symbol universe
//   the live breakout/mean-reversion scanners cover — fetching years of historical
//   candles for every symbol isn't practical here.
// - Assumes the stop-loss/take-profit ALWAYS fills exactly at the target price
//   (checked against candle high/low). Real fills can slip past the target in fast
//   moves, same as the real liquidation incident earlier already demonstrated.
const axios = require('axios');
const { calculateRsi, isBreakoutSignal } = require('../utils/indicators');

const FAPI_BASE = 'https://fapi.binance.com';
const TAKER_FEE_PCT = 0.0005; // 0.05% per side, approximate

/**
 * Fetch more historical candles than Binance's single-request 1500 limit by paging
 * backwards from now.
 * @param {string} symbol
 * @param {string} interval e.g. '1h'
 * @param {number} totalCandles
 * @returns {Promise<Array<{openTime, open, high, low, close, volume}>>} oldest -> newest
 */
async function fetchHistoricalKlines(symbol, interval, totalCandles) {
  const PAGE_SIZE = 1500;
  let candles = [];
  let endTime = Date.now();

  while (candles.length < totalCandles) {
    const limit = Math.min(PAGE_SIZE, totalCandles - candles.length);
    const { data } = await axios.get(`${FAPI_BASE}/fapi/v1/klines`, {
      params: { symbol, interval, endTime, limit }
    });
    if (data.length === 0) break;

    const page = data.map(k => ({
      openTime: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5])
    }));

    candles = [...page, ...candles];
    endTime = page[0].openTime - 1;

    if (data.length < limit) break; // ran out of history
  }

  return candles;
}

/**
 * Simulate one strategy's entries/exits over historical candles using the exact same
 * risk parameters as live trading (leverage, stop-loss, take-profit). Only ever
 * holds one position at a time per symbol, mirroring the live agents' one-open-
 * per-symbol-per-day-ish behavior (simplified here to one-at-a-time, no re-entry
 * until the open position closes).
 * @param {Array} candles oldest -> newest
 * @param {Function} signalFn (candles, index) => boolean — true if a long should open at candles[index]
 * @param {Object} risk { leverage, stopLossPct, takeProfitPct, marginUsd }
 * @returns {Array} closed trades
 */
function simulateTrades(candles, signalFn, risk) {
  const { leverage, stopLossPct, takeProfitPct, marginUsd } = risk;
  const trades = [];
  let openPosition = null;

  for (let i = 0; i < candles.length; i++) {
    if (openPosition) {
      const candle = candles[i];
      const stopHit = candle.low <= openPosition.stopPrice;
      const takeProfitHit = candle.high >= openPosition.takeProfitPrice;

      if (stopHit || takeProfitHit) {
        // If both could technically hit in the same candle, assume the worse
        // outcome (stop-loss) — conservative rather than optimistic.
        const exitPrice = stopHit ? openPosition.stopPrice : openPosition.takeProfitPrice;
        const notional = marginUsd * leverage;
        const qty = notional / openPosition.entryPrice;
        const grossPnl = qty * (exitPrice - openPosition.entryPrice);
        const commission = notional * TAKER_FEE_PCT + (qty * exitPrice) * TAKER_FEE_PCT;
        const netPnl = grossPnl - commission;

        trades.push({
          entryTime: openPosition.entryTime,
          exitTime: candle.openTime,
          entryPrice: openPosition.entryPrice,
          exitPrice,
          outcome: stopHit ? 'stop_loss' : 'take_profit',
          pnlUsd: netPnl,
          pnlPctOfMargin: (netPnl / marginUsd) * 100
        });
        openPosition = null;
      }
      continue;
    }

    if (i < 30) continue; // warm-up window for indicators
    if (signalFn(candles, i)) {
      const entryPrice = candles[i].close;
      openPosition = {
        entryTime: candles[i].openTime,
        entryPrice,
        stopPrice: entryPrice * (1 - stopLossPct),
        takeProfitPrice: entryPrice * (1 + takeProfitPct)
      };
    }
  }

  return trades;
}

function summarizeTrades(trades) {
  if (trades.length === 0) {
    return { totalTrades: 0, winCount: 0, lossCount: 0, winRatePct: null, totalPnlUsd: 0, avgPnlUsd: 0, maxDrawdownUsd: 0 };
  }

  const wins = trades.filter(t => t.pnlUsd > 0);
  const losses = trades.filter(t => t.pnlUsd <= 0);
  const totalPnlUsd = trades.reduce((sum, t) => sum + t.pnlUsd, 0);

  let equity = 0;
  let peak = 0;
  let maxDrawdownUsd = 0;
  for (const t of trades) {
    equity += t.pnlUsd;
    peak = Math.max(peak, equity);
    maxDrawdownUsd = Math.min(maxDrawdownUsd, equity - peak);
  }

  return {
    totalTrades: trades.length,
    winCount: wins.length,
    lossCount: losses.length,
    winRatePct: (wins.length / trades.length) * 100,
    totalPnlUsd,
    avgPnlUsd: totalPnlUsd / trades.length,
    maxDrawdownUsd
  };
}

/**
 * Run the mean-reversion (RSI oversold) strategy backtest for one symbol.
 */
async function backtestMeanReversion(symbol, { interval = '1h', candleCount = 2160, rsiPeriod = 14, rsiOversoldThreshold = 30, leverage = 50, stopLossPct = 0.01, takeProfitPct = 0.03, marginUsd = 5 } = {}) {
  const candles = await fetchHistoricalKlines(symbol, interval, candleCount);
  const closes = candles.map(c => c.close);

  const signalFn = (allCandles, i) => {
    const rsi = calculateRsi(closes.slice(0, i + 1), rsiPeriod);
    return rsi !== null && rsi < rsiOversoldThreshold;
  };

  const trades = simulateTrades(candles, signalFn, { leverage, stopLossPct, takeProfitPct, marginUsd });
  return { symbol, strategy: 'meanReversion', candleCount: candles.length, trades, summary: summarizeTrades(trades) };
}

/**
 * Run the breakout (momentum) strategy backtest for one symbol.
 */
async function backtestBreakout(symbol, { interval = '1h', candleCount = 2160, lookback = 24, nearHighThresholdPct = 0.001, momentumThresholdPct = 5, leverage = 50, stopLossPct = 0.01, takeProfitPct = 0.03, marginUsd = 5 } = {}) {
  const candles = await fetchHistoricalKlines(symbol, interval, candleCount);

  const signalFn = (allCandles, i) => isBreakoutSignal(allCandles.slice(0, i + 1), lookback, nearHighThresholdPct, momentumThresholdPct);

  const trades = simulateTrades(candles, signalFn, { leverage, stopLossPct, takeProfitPct, marginUsd });
  return { symbol, strategy: 'breakout', candleCount: candles.length, trades, summary: summarizeTrades(trades) };
}

module.exports = {
  fetchHistoricalKlines,
  simulateTrades,
  summarizeTrades,
  backtestMeanReversion,
  backtestBreakout
};

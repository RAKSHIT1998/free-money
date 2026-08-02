// Run this manually: node backtest.js
// Backtests breakoutFutures and meanReversionFutures against ~90 days of real 1h
// candles, using the exact live risk parameters (50x, 1% stop, 3% take-profit), so
// we know whether these strategies have shown any historical edge before trusting
// them with more real capital. Results are saved to backtest_results.json.
const fs = require('fs');
const { backtestMeanReversion, backtestBreakout } = require('./src/services/backtestService');

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'];
const CANDLE_COUNT = 2160; // 90 days of 1h candles

const RISK = { leverage: 50, stopLossPct: 0.01, takeProfitPct: 0.03, marginUsd: 5 };

async function main() {
  const results = { generatedAt: new Date().toISOString(), risk: RISK, candleCount: CANDLE_COUNT, meanReversion: [], breakout: [] };

  for (const symbol of SYMBOLS) {
    process.stdout.write(`Backtesting meanReversion on ${symbol}... `);
    const mr = await backtestMeanReversion(symbol, { ...RISK, candleCount: CANDLE_COUNT });
    results.meanReversion.push(mr);
    console.log(`${mr.summary.totalTrades} trades, $${mr.summary.totalPnlUsd.toFixed(2)} P&L, ${mr.summary.winRatePct === null ? 'n/a' : mr.summary.winRatePct.toFixed(0) + '%'} win rate`);

    process.stdout.write(`Backtesting breakout on ${symbol}... `);
    const bo = await backtestBreakout(symbol, { ...RISK, candleCount: CANDLE_COUNT });
    results.breakout.push(bo);
    console.log(`${bo.summary.totalTrades} trades, $${bo.summary.totalPnlUsd.toFixed(2)} P&L, ${bo.summary.winRatePct === null ? 'n/a' : bo.summary.winRatePct.toFixed(0) + '%'} win rate`);
  }

  const aggregate = (list) => {
    const allTrades = list.flatMap(r => r.trades);
    const totalPnl = allTrades.reduce((s, t) => s + t.pnlUsd, 0);
    const wins = allTrades.filter(t => t.pnlUsd > 0).length;
    return { totalTrades: allTrades.length, totalPnlUsd: totalPnl, winRatePct: allTrades.length > 0 ? (wins / allTrades.length) * 100 : null };
  };

  results.meanReversionAggregate = aggregate(results.meanReversion);
  results.breakoutAggregate = aggregate(results.breakout);

  console.log('\n=== AGGREGATE (all symbols combined) ===');
  console.log('Mean-Reversion:', JSON.stringify(results.meanReversionAggregate));
  console.log('Breakout:      ', JSON.stringify(results.breakoutAggregate));

  fs.writeFileSync('backtest_results.json', JSON.stringify(results, null, 2));
  console.log('\nFull results saved to backtest_results.json');
}

main().catch(e => { console.error('Backtest failed:', e.message); process.exit(1); });

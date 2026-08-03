// Run this manually: node backtest_trailing.js
// Re-runs all 4 strategies using a TRAILING stop instead of the fixed 1%/3%
// stop-loss/take-profit pair, to see whether trailing exits actually improve on the
// fixed-ratio results already on record in backtest_results.json.
const fs = require('fs');
const {
  backtestMeanReversion,
  backtestBreakout,
  backtestEmaCrossover,
  backtestBollingerBounce
} = require('../src/services/backtestService');

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'];
const CANDLE_COUNT = 2160;
const RISK = { leverage: 50, trailingStopPct: 0.01, marginUsd: 5 }; // 1% trailing callback, matching live stop-loss %
const DELAY_MS = 800;

const STRATEGIES = [
  { name: 'meanReversion', fn: backtestMeanReversion },
  { name: 'breakout', fn: backtestBreakout },
  { name: 'emaCrossover', fn: backtestEmaCrossover },
  { name: 'bollingerBounce', fn: backtestBollingerBounce }
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function aggregate(list) {
  const allTrades = list.flatMap(r => r.trades);
  const totalPnl = allTrades.reduce((s, t) => s + t.pnlUsd, 0);
  const wins = allTrades.filter(t => t.pnlUsd > 0).length;
  return {
    totalTrades: allTrades.length,
    totalPnlUsd: totalPnl,
    winRatePct: allTrades.length > 0 ? (wins / allTrades.length) * 100 : null,
    avgPnlPerTradeUsd: allTrades.length > 0 ? totalPnl / allTrades.length : null
  };
}

async function main() {
  const results = { generatedAt: new Date().toISOString(), risk: RISK, candleCount: CANDLE_COUNT, mode: 'trailing_stop_1pct', byStrategy: {} };

  for (const strategy of STRATEGIES) {
    results.byStrategy[strategy.name] = [];
    for (const symbol of SYMBOLS) {
      process.stdout.write(`${strategy.name} on ${symbol} (trailing 1%)... `);
      try {
        const r = await strategy.fn(symbol, { ...RISK, candleCount: CANDLE_COUNT });
        results.byStrategy[strategy.name].push(r);
        console.log(`${r.summary.totalTrades} trades, $${r.summary.totalPnlUsd.toFixed(2)} P&L, ${r.summary.winRatePct === null ? 'n/a' : r.summary.winRatePct.toFixed(0) + '%'} win rate`);
      } catch (error) {
        console.log(`FAILED: ${error.message}`);
      }
      await sleep(DELAY_MS);
    }
  }

  console.log('\n=== AGGREGATE (trailing stop 1%, all 4 symbols combined per strategy) ===');
  const aggregates = {};
  for (const strategy of STRATEGIES) {
    aggregates[strategy.name] = aggregate(results.byStrategy[strategy.name]);
    console.log(`${strategy.name.padEnd(18)}`, JSON.stringify(aggregates[strategy.name]));
  }
  results.aggregates = aggregates;

  fs.writeFileSync('backtest_trailing_results.json', JSON.stringify(results, null, 2));
  console.log('\nFull results saved to backtest_trailing_results.json');
}

main().catch(e => { console.error('Backtest failed:', e.message); process.exit(1); });

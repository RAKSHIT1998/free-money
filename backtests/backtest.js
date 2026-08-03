// Run this manually: node backtest.js
// Backtests 4 distinct strategies against ~90 days of real 1h candles, using the
// exact live risk parameters (50x, 1% stop, 3% take-profit), so we know whether a
// strategy has shown any historical edge before trusting it with real capital.
// Results are saved to backtest_results.json.
const fs = require('fs');
const {
  backtestMeanReversion,
  backtestBreakout,
  backtestEmaCrossover,
  backtestBollingerBounce
} = require('../src/services/backtestService');

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'];
const CANDLE_COUNT = 2160; // 90 days of 1h candles
const RISK = { leverage: 50, stopLossPct: 0.01, takeProfitPct: 0.03, marginUsd: 5 };
const DELAY_MS = 800; // spread out requests to stay well clear of rate limits

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
  const results = { generatedAt: new Date().toISOString(), risk: RISK, candleCount: CANDLE_COUNT, byStrategy: {} };

  for (const strategy of STRATEGIES) {
    results.byStrategy[strategy.name] = [];
    for (const symbol of SYMBOLS) {
      process.stdout.write(`${strategy.name} on ${symbol}... `);
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

  console.log('\n=== AGGREGATE (all 4 symbols combined per strategy) ===');
  const aggregates = {};
  for (const strategy of STRATEGIES) {
    aggregates[strategy.name] = aggregate(results.byStrategy[strategy.name]);
    console.log(`${strategy.name.padEnd(18)}`, JSON.stringify(aggregates[strategy.name]));
  }
  results.aggregates = aggregates;

  fs.writeFileSync('backtest_results.json', JSON.stringify(results, null, 2));
  console.log('\nFull results saved to backtest_results.json');
}

main().catch(e => { console.error('Backtest failed:', e.message); process.exit(1); });

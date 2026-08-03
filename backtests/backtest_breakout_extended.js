// Run this manually: node backtest_breakout_extended.js
// Expands the sample size on breakoutFutures — the ONE strategy currently running
// live with real money — by testing 6 more liquid, established coins beyond the
// original BTC/ETH/SOL/BNB. 22-27 trades was too small a sample to trust; this adds
// real data points to that same honest question: does this signal have real edge?
const fs = require('fs');
const { backtestBreakout } = require('../src/services/backtestService');

const EXTRA_SYMBOLS = ['ADAUSDT', 'XRPUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT', 'LTCUSDT'];
const CANDLE_COUNT = 2160; // 90 days of 1h candles
const RISK = { leverage: 50, stopLossPct: 0.01, takeProfitPct: 0.03, marginUsd: 5 };
const DELAY_MS = 800;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const results = { generatedAt: new Date().toISOString(), risk: RISK, candleCount: CANDLE_COUNT, strategy: 'breakout', note: 'extends the original 4-symbol breakout backtest with 6 more liquid coins', symbols: [] };

  for (const symbol of EXTRA_SYMBOLS) {
    process.stdout.write(`breakout on ${symbol}... `);
    try {
      const r = await backtestBreakout(symbol, { ...RISK, candleCount: CANDLE_COUNT });
      results.symbols.push(r);
      console.log(`${r.summary.totalTrades} trades, $${r.summary.totalPnlUsd.toFixed(2)} P&L, ${r.summary.winRatePct === null ? 'n/a' : r.summary.winRatePct.toFixed(0) + '%'} win rate`);
    } catch (error) {
      console.log(`FAILED: ${error.message}`);
    }
    await sleep(DELAY_MS);
  }

  const allTrades = results.symbols.flatMap(r => r.trades);
  const totalPnl = allTrades.reduce((s, t) => s + t.pnlUsd, 0);
  const wins = allTrades.filter(t => t.pnlUsd > 0).length;
  const aggregate = {
    totalTrades: allTrades.length,
    totalPnlUsd: totalPnl,
    winRatePct: allTrades.length > 0 ? (wins / allTrades.length) * 100 : null,
    avgPnlPerTradeUsd: allTrades.length > 0 ? totalPnl / allTrades.length : null
  };
  results.aggregate = aggregate;

  // Combined with the original 4-symbol result (22 trades, +$19.49), for the full picture
  const original = { totalTrades: 22, totalPnlUsd: 19.4875 };
  const combined = {
    totalTrades: original.totalTrades + aggregate.totalTrades,
    totalPnlUsd: original.totalPnlUsd + aggregate.totalPnlUsd
  };
  combined.avgPnlPerTradeUsd = combined.totalTrades > 0 ? combined.totalPnlUsd / combined.totalTrades : null;
  results.combinedWithOriginal4Symbols = combined;

  console.log('\n=== NEW 6 SYMBOLS AGGREGATE ===');
  console.log(JSON.stringify(aggregate));
  console.log('\n=== COMBINED WITH ORIGINAL 4-SYMBOL RESULT (10 symbols total) ===');
  console.log(JSON.stringify(combined));

  fs.writeFileSync('backtest_breakout_extended_results.json', JSON.stringify(results, null, 2));
  console.log('\nFull results saved to backtest_breakout_extended_results.json');
}

main().catch(e => { console.error('Backtest failed:', e.message); process.exit(1); });

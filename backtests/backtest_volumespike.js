// Run this manually: node backtest_volumespike.js
// Backtests the volume-spike signal against the same 5 real meme coins used for the
// breakout backtest, same 90-day/1h/50x/1%/3% methodology, to see honestly whether
// this genuinely different idea (volume precedes price) actually shows an edge.
const fs = require('fs');
const { backtestVolumeSpike } = require('../src/services/backtestService');

const MEME_SYMBOLS = ['DOGEUSDT', '1000PEPEUSDT', '1000SHIBUSDT', 'WIFUSDT', '1000BONKUSDT'];
const CANDLE_COUNT = 2160;
const RISK = { leverage: 50, stopLossPct: 0.01, takeProfitPct: 0.03, marginUsd: 5 };
const DELAY_MS = 800;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const results = { generatedAt: new Date().toISOString(), risk: RISK, candleCount: CANDLE_COUNT, strategy: 'volumeSpike', symbols: [] };

  for (const symbol of MEME_SYMBOLS) {
    process.stdout.write(`volumeSpike on ${symbol}... `);
    try {
      const r = await backtestVolumeSpike(symbol, { ...RISK, candleCount: CANDLE_COUNT });
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

  console.log('\n=== AGGREGATE (volumeSpike on 5 meme coins combined) ===');
  console.log(JSON.stringify(aggregate));

  fs.writeFileSync('backtest_volumespike_results.json', JSON.stringify(results, null, 2));
  console.log('\nFull results saved to backtest_volumespike_results.json');
}

main().catch(e => { console.error('Backtest failed:', e.message); process.exit(1); });

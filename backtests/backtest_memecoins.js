// Run this manually: node backtest_memecoins.js
// Backtests the ONE strategy that showed real positive signal on major coins
// (breakout) against real meme-coin historical data, same methodology and risk
// parameters as before, to see honestly whether that edge holds up here too.
const fs = require('fs');
const { backtestBreakout } = require('../src/services/backtestService');

const MEME_SYMBOLS = ['DOGEUSDT', '1000PEPEUSDT', '1000SHIBUSDT', 'WIFUSDT', '1000BONKUSDT'];
const CANDLE_COUNT = 2160; // 90 days of 1h candles
const RISK = { leverage: 50, stopLossPct: 0.01, takeProfitPct: 0.03, marginUsd: 5 };
const DELAY_MS = 800;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const results = { generatedAt: new Date().toISOString(), risk: RISK, candleCount: CANDLE_COUNT, strategy: 'breakout', symbols: [] };

  for (const symbol of MEME_SYMBOLS) {
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

  console.log('\n=== AGGREGATE (breakout on 5 meme coins combined) ===');
  console.log(JSON.stringify(aggregate));

  fs.writeFileSync('backtest_memecoins_results.json', JSON.stringify(results, null, 2));
  console.log('\nFull results saved to backtest_memecoins_results.json');
}

main().catch(e => { console.error('Backtest failed:', e.message); process.exit(1); });

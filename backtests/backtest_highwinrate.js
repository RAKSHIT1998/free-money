// Run this manually: node backtest_highwinrate.js
//
// Answers a specific question honestly with real data: what happens if
// meanReversion/breakout are reshaped (via TP/SL ratio) to hit ~90% win rate?
// Fetches each symbol's candles ONCE per strategy, then runs THREE risk configs
// against the exact same price history so the comparison is apples-to-apples:
//   - baseline:    SL 1% / TP 3%   (current live config)
//   - moderate:    SL 1% / TP 0.5% (biases toward higher win rate, still sane)
//   - highWinRate: SL 1% / TP 0.11% (SL/(SL+TP) ≈ 90% under a driftless-random-walk
//                  approximation — i.e. shaped specifically to target ~90%)
// Leverage/margin/symbols/lookback match the existing backtest.js for comparability.
const fs = require('fs');
const {
  fetchHistoricalKlines,
  simulateTrades,
  summarizeTrades,
  backtestMeanReversion
} = require('../src/services/backtestService');
const { calculateRsi, isBreakoutSignal } = require('../src/utils/indicators');

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'];
const CANDLE_COUNT = 2160; // 90 days of 1h candles
const LEVERAGE = 50;
const MARGIN_USD = 5;
const DELAY_MS = 800;

const RISK_CONFIGS = {
  baseline: { stopLossPct: 0.01, takeProfitPct: 0.03 },
  moderate: { stopLossPct: 0.01, takeProfitPct: 0.005 },
  highWinRate: { stopLossPct: 0.01, takeProfitPct: 0.0011 }
};

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

async function backtestAllConfigs(symbol, strategyName, signalFnBuilder) {
  const candles = await fetchHistoricalKlines(symbol, '1h', CANDLE_COUNT);
  const signalFn = signalFnBuilder(candles);

  const perConfig = {};
  for (const [configName, riskOverrides] of Object.entries(RISK_CONFIGS)) {
    const risk = { leverage: LEVERAGE, marginUsd: MARGIN_USD, ...riskOverrides };
    const trades = simulateTrades(candles, signalFn, risk);
    perConfig[configName] = { symbol, strategy: strategyName, candleCount: candles.length, trades, summary: summarizeTrades(trades) };
  }
  return perConfig;
}

async function main() {
  const results = { generatedAt: new Date().toISOString(), riskConfigs: RISK_CONFIGS, leverage: LEVERAGE, marginUsd: MARGIN_USD, candleCount: CANDLE_COUNT, byStrategy: {} };

  const strategies = [
    {
      name: 'meanReversion',
      signalFnBuilder: (candles) => {
        const closes = candles.map(c => c.close);
        return (allCandles, i) => {
          const rsi = calculateRsi(closes.slice(0, i + 1), 14);
          return rsi !== null && rsi < 30;
        };
      }
    },
    {
      name: 'breakout',
      signalFnBuilder: () => (allCandles, i) => isBreakoutSignal(allCandles.slice(0, i + 1), 24, 0.001, 5)
    }
  ];

  for (const strategy of strategies) {
    results.byStrategy[strategy.name] = { baseline: [], moderate: [], highWinRate: [] };
    for (const symbol of SYMBOLS) {
      process.stdout.write(`${strategy.name} on ${symbol}... `);
      try {
        const perConfig = await backtestAllConfigs(symbol, strategy.name, strategy.signalFnBuilder);
        for (const configName of Object.keys(RISK_CONFIGS)) {
          results.byStrategy[strategy.name][configName].push(perConfig[configName]);
        }
        const line = Object.keys(RISK_CONFIGS)
          .map(c => `${c}: ${perConfig[c].summary.totalTrades}t/${perConfig[c].summary.winRatePct === null ? 'n/a' : perConfig[c].summary.winRatePct.toFixed(0) + '%'}/$${perConfig[c].summary.totalPnlUsd.toFixed(2)}`)
          .join('  |  ');
        console.log(line);
      } catch (error) {
        console.log(`FAILED: ${error.message}`);
      }
      await sleep(DELAY_MS);
    }
  }

  console.log('\n=== AGGREGATE (all 4 symbols combined) ===');
  const aggregates = {};
  for (const strategy of strategies) {
    aggregates[strategy.name] = {};
    console.log(`\n${strategy.name}:`);
    for (const configName of Object.keys(RISK_CONFIGS)) {
      const agg = aggregate(results.byStrategy[strategy.name][configName]);
      aggregates[strategy.name][configName] = agg;
      console.log(`  ${configName.padEnd(12)} SL=${(RISK_CONFIGS[configName].stopLossPct * 100).toFixed(2)}% TP=${(RISK_CONFIGS[configName].takeProfitPct * 100).toFixed(3)}%  ->  ${JSON.stringify(agg)}`);
    }
  }
  results.aggregates = aggregates;

  fs.writeFileSync(`${__dirname}/backtest_highwinrate_results.json`, JSON.stringify(results, null, 2));
  console.log('\nFull results saved to backtest_highwinrate_results.json');
}

main().catch(e => { console.error('Backtest failed:', e.message); process.exit(1); });

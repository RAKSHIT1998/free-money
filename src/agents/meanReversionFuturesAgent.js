// REAL MONEY, LEVERAGED agent: mean-reversion strategy, distinct signal source from
// breakoutFuturesAgent (momentum) — buys liquid USDT perpetuals whose 14-period RSI
// on the 1h chart indicates oversold conditions, betting on a bounce back toward the
// mean rather than continued momentum in either direction.
//
// Signal (deliberately simple, NOT backtested, NOT a proven-profitable strategy):
//   among the most liquid perpetuals (by 24h quote volume), a symbol qualifies when
//   its 1h RSI(14) is below rsiOversoldThreshold. RSI is a well-known, publicly
//   documented indicator — using it here is not a claim that this particular
//   application of it is reliably profitable.
//
// Safety properties (do not remove without updating the plan/tests):
// - Never calls walletService.addEarnings — zero interaction with the fabricated
//   in-app "earnings" currency used by cryptoHunter/developer/opportunityScout agents.
// - Every order goes through realFuturesTradingService.openLeveragedLong, which
//   independently requires LIVE_TRADING_CONFIRMED=true, LIVE_FUTURES_TRADING_CONFIRMED=true,
//   and real (non-placeholder) Binance credentials.
// - Sizing is checked against realFuturesTradingService.getEffectiveRemainingBudgetUsd,
//   which enforces BOTH this agent's own budgetCapUsd AND the shared cross-agent
//   globalFuturesBudgetCapUsd — running this alongside binanceFuturesDca/breakoutFutures
//   cannot silently multiply total real exposure past the global cap.
// - At most one open per symbol per UTC day (derived from the ledger, not memory).
// - Once EITHER this agent's own cap or the global cap is spent, this agent halts/rests
//   — no auto-reset, no auto-sell/liquidation anywhere here.
// - A stop-loss is attached to every position at open time, but this agent never
//   widens leverage or position size on its own; those are fixed config values a
//   human must change deliberately.
const BaseAgent = require('./baseAgent');
const realFuturesTradingService = require('../services/realFuturesTradingService');

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

class MeanReversionFuturesAgent extends BaseAgent {
  constructor(options = {}) {
    super({
      ...options,
      type: 'meanReversionFutures',
      config: {
        perTradeMarginUsd: options.config?.perTradeMarginUsd || 5,
        budgetCapUsd: options.config?.budgetCapUsd || 50,
        leverage: options.config?.leverage || 50,
        marginMode: options.config?.marginMode || 'ISOLATED',
        stopLossPct: options.config?.stopLossPct != null ? options.config.stopLossPct : 0.01,
        takeProfitPct: options.config?.takeProfitPct != null ? options.config.takeProfitPct : 0.03,
        rsiPeriod: options.config?.rsiPeriod || 14,
        rsiInterval: options.config?.rsiInterval || '1h',
        rsiOversoldThreshold: options.config?.rsiOversoldThreshold != null ? options.config.rsiOversoldThreshold : 30,
        minQuoteVolumeUsd: options.config?.minQuoteVolumeUsd || 5000000,
        watchlistSize: options.config?.watchlistSize || 30,
        maxCandidatesPerCycle: options.config?.maxCandidatesPerCycle || 2,
        scanIntervalMs: options.config?.scanIntervalMs || 900000, // 15 minutes
        ...options.config
      }
    });

    this.haltedReason = null;
    this.lastScanCandidates = [];
  }

  async run() {
    this.log(
      'info',
      `Starting mean-reversion futures scanner (top ${this.config.watchlistSize} liquid perpetuals): ` +
      `$${this.config.perTradeMarginUsd} margin/trade @ ${this.config.leverage}x ${this.config.marginMode}, ` +
      `per-agent budget cap $${this.config.budgetCapUsd} (also bound by the global cross-agent cap), ` +
      `stop-loss ${(this.config.stopLossPct * 100).toFixed(2)}%, take-profit ${(this.config.takeProfitPct * 100).toFixed(2)}%, ` +
      `signal = RSI(${this.config.rsiPeriod}) on ${this.config.rsiInterval} < ${this.config.rsiOversoldThreshold}`
    );

    while (this.isRunning) {
      try {
        await this.scanAndTrade();
      } catch (error) {
        this.log('error', 'Error in mean-reversion scan cycle:', error.message);
        this.state = 'error';
      }

      if (this.isRunning) {
        await new Promise(resolve => setTimeout(resolve, this.config.scanIntervalMs));
      }
    }
  }

  async scanAndTrade() {
    if (this.haltedReason) {
      this.state = 'resting';
      return [];
    }

    this.state = 'active';

    const [tickers, perpetualSymbols, symbolsTradedToday] = await Promise.all([
      realFuturesTradingService.getAll24hrTickers(),
      realFuturesTradingService.getUsdtPerpetualSymbols(),
      realFuturesTradingService.getSymbolsTradedToday(this.id)
    ]);

    const perpetualSet = new Set(perpetualSymbols);
    const watchlist = tickers
      .filter(t => perpetualSet.has(t.symbol) && t.quoteVolume >= this.config.minQuoteVolumeUsd && !symbolsTradedToday.has(t.symbol))
      .sort((a, b) => b.quoteVolume - a.quoteVolume)
      .slice(0, this.config.watchlistSize);

    this.log('info', `Checking RSI on top ${watchlist.length} liquid perpetuals (of ${tickers.length} scanned)`);

    const candidates = [];
    for (const ticker of watchlist) {
      try {
        const klines = await realFuturesTradingService.getKlines(ticker.symbol, this.config.rsiInterval, this.config.rsiPeriod + 20);
        const closes = klines.map(k => k.close);
        const rsi = calculateRsi(closes, this.config.rsiPeriod);
        if (rsi !== null && rsi < this.config.rsiOversoldThreshold) {
          candidates.push({ symbol: ticker.symbol, rsi, lastPrice: ticker.lastPrice });
        }
      } catch (error) {
        this.log('warn', `Failed to compute RSI for ${ticker.symbol}:`, error.message);
      }
    }

    candidates.sort((a, b) => a.rsi - b.rsi); // most oversold first
    this.lastScanCandidates = candidates.slice(0, 10);

    this.log('info', `Found ${candidates.length} oversold candidate(s)`);

    const opened = [];
    for (const candidate of candidates.slice(0, this.config.maxCandidatesPerCycle)) {
      const budget = await realFuturesTradingService.getEffectiveRemainingBudgetUsd(this.id, this.config.budgetCapUsd);
      if (budget.spentByAgent >= this.config.budgetCapUsd) {
        this.haltedReason = `Budget cap of $${this.config.budgetCapUsd} margin reached (spent $${budget.spentByAgent.toFixed(2)})`;
        this.log('warn', this.haltedReason);
        this.state = 'resting';
        break;
      }
      if (budget.remaining <= 0) {
        this.log('warn', `Global futures budget cap of $${budget.globalCapUsd} reached across all real futures agents (spent $${budget.spentAllAgents.toFixed(2)}) — skipping this candidate`);
        this.state = 'resting';
        break;
      }

      const marginUsd = Math.min(this.config.perTradeMarginUsd, budget.remaining);
      if (marginUsd <= 0) continue;

      try {
        const result = await realFuturesTradingService.openLeveragedLong({
          symbol: candidate.symbol,
          marginUsd,
          leverage: this.config.leverage,
          marginMode: this.config.marginMode,
          stopLossPct: this.config.stopLossPct,
          takeProfitPct: this.config.takeProfitPct,
          agentId: this.id
        });

        this.updatePerformance({
          actionsTaken: this.performance.actionsTaken + 1,
          opportunitiesFound: this.performance.opportunitiesFound + 1
        });

        this.log(
          'info',
          `Mean-reversion entry: $${marginUsd} margin @ ${this.config.leverage}x of ${candidate.symbol} ` +
          `(RSI ${candidate.rsi.toFixed(1)}) -> qty=${result.filledQty} @ ${result.fillPrice}` +
          (result.stopPrice ? `, stop-loss @ ${result.stopPrice}` : ', NO STOP-LOSS PLACED (check logs for error)')
        );

        opened.push(result);
      } catch (error) {
        this.log('error', `Failed to open mean-reversion position for ${candidate.symbol}:`, error.message);
      }
    }

    if (opened.length === 0) {
      this.state = 'idle';
    }

    return opened;
  }

  async getStatusExtended() {
    const [spent, ledger] = await Promise.all([
      realFuturesTradingService.getTotalMarginUsd(this.id),
      realFuturesTradingService.getLedger(this.id)
    ]);

    return {
      ...this.getStatus(),
      real: {
        leverage: this.config.leverage,
        marginMode: this.config.marginMode,
        totalMarginSpentUsd: spent,
        budgetCapUsd: this.config.budgetCapUsd,
        budgetRemainingUsd: Math.max(0, this.config.budgetCapUsd - spent),
        halted: !!this.haltedReason,
        haltedReason: this.haltedReason,
        openPositionsCount: ledger.length,
        lastScanCandidates: this.lastScanCandidates,
        recentTrades: ledger.slice(-10)
      }
    };
  }

  async cleanup() {
    this.log(
      'info',
      'Cleaning up mean-reversion futures agent (no auto-liquidation/close performed; ' +
      'open positions and stop-loss orders remain live on the account)'
    );
  }
}

module.exports = MeanReversionFuturesAgent;

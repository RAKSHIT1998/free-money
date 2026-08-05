// REAL MONEY, LEVERAGED agent: continuously scans all USDT-margined Binance futures
// perpetuals for a breakout (long) or breakdown (short) signal and opens a leveraged
// position when triggered.
//
// Signal (deliberately simple, NOT backtested, NOT a proven-profitable strategy):
//   a symbol qualifies for a LONG as "breaking out" when its last price is within
//   nearHighThresholdPct of its own 24h high AND its 24h priceChangePercent exceeds
//   momentumThresholdPct. It qualifies for a SHORT as "breaking down" when its last
//   price is within nearLowThresholdPct of its own 24h low AND its 24h
//   priceChangePercent is below -breakdownThresholdPct — the mirror image of the long
//   signal. Both numbers come from a single bulk 24hr-ticker API call covering every
//   symbol, so scanning "all coins" costs one request per cycle, not one per symbol.
//
// Safety properties (do not remove without updating the plan/tests):
// - Never calls walletService.addEarnings — zero interaction with the fabricated
//   in-app "earnings" currency used by cryptoHunter/developer/opportunityScout agents.
// - Every order goes through realFuturesTradingService.openLeveragedLong, which
//   independently requires LIVE_TRADING_CONFIRMED=true, LIVE_FUTURES_TRADING_CONFIRMED=true,
//   and real (non-placeholder) Binance credentials.
// - totalBudgetCapUsd is a SHARED cap across every symbol this agent ever trades, not
//   per-symbol. Checked fresh from the real ledger immediately before each individual
//   position open (sequential, not parallel, within a scan cycle) so concurrent
//   candidates in the same cycle cannot collectively overshoot the cap.
// - At most one open per symbol per UTC day (derived from the ledger, not memory).
// - Once the budget cap is spent, this agent halts permanently — no auto-reset,
//   no auto-sell/liquidation anywhere here.
// - A stop-loss is attached to every position at open time (see
//   realFuturesTradingService.openLeveragedLong), but this agent never widens
//   leverage or position size on its own; those are fixed config values a human
//   must change deliberately.
const BaseAgent = require('./baseAgent');
const realFuturesTradingService = require('../services/realFuturesTradingService');

class BreakoutFuturesAgent extends BaseAgent {
  constructor(options = {}) {
    super({
      ...options,
      type: 'breakoutFutures',
      config: {
        // 'percentOfBalance' (default): each trade risks riskPct of the CURRENT
        // available futures balance, so position size grows with wins and shrinks
        // with losses. 'fixed': always risk perTradeMarginUsd regardless of balance.
        sizingMode: options.config?.sizingMode || 'percentOfBalance',
        riskPct: options.config?.riskPct != null ? options.config.riskPct : 0.2,
        perTradeMarginUsd: options.config?.perTradeMarginUsd || 5,
        budgetCapUsd: options.config?.budgetCapUsd || Infinity,
        leverage: options.config?.leverage || 50,
        marginMode: options.config?.marginMode || 'ISOLATED',
        stopLossPct: options.config?.stopLossPct != null ? options.config.stopLossPct : 0.01,
        takeProfitPct: options.config?.takeProfitPct != null ? options.config.takeProfitPct : 0.03,
        // Widened from 0.1% (2026-08-05): that band was so tight a real pump would
        // routinely sit 1-3% off its intraday high between 5-minute scan ticks and
        // get skipped every cycle. 2% catches a continuing move, not just the literal
        // instant it prints a new high.
        nearHighThresholdPct: options.config?.nearHighThresholdPct != null
          ? options.config.nearHighThresholdPct : 0.02, // within 2% of 24h high
        momentumThresholdPct: options.config?.momentumThresholdPct != null
          ? options.config.momentumThresholdPct : 5, // 24h priceChangePercent > 5%
        // Mirror-image breakdown signal: within nearLowThresholdPct of the 24h low AND
        // down beyond breakdownThresholdPct on the day opens a short instead of a long.
        nearLowThresholdPct: options.config?.nearLowThresholdPct != null
          ? options.config.nearLowThresholdPct : 0.02, // within 2% of 24h low
        breakdownThresholdPct: options.config?.breakdownThresholdPct != null
          ? options.config.breakdownThresholdPct : 5, // 24h priceChangePercent < -5%
        // Lowered from $5M (2026-08-05, explicit request to scan every token, not just
        // the most liquid third of the market): $250K still excludes the handful of
        // symbols thin enough that 50x leverage risks real slippage/gap-through on a
        // stop-loss, while covering ~99% of all USDT perpetuals rather than ~33%.
        minQuoteVolumeUsd: options.config?.minQuoteVolumeUsd || 250000, // liquidity floor
        // Uncapped by default (explicit user decision): every symbol that qualifies
        // this cycle gets a position, not just the top few. Still bounded in practice
        // by the $5M liquidity floor and one-open-per-symbol-per-day rule above.
        maxCandidatesPerCycle: options.config?.maxCandidatesPerCycle || Infinity,
        // Shortened from 5 minutes (2026-08-05) alongside the wider near-high/low
        // band above, so a continuing move is caught sooner rather than waiting up to
        // 5 minutes to re-check.
        scanIntervalMs: options.config?.scanIntervalMs || 120000, // 2 minutes
        ...options.config
      }
    });

    this.haltedReason = null;
    this.lastScanCandidates = [];
  }

  async run() {
    const sizingDesc = this.config.sizingMode === 'percentOfBalance'
      ? `${(this.config.riskPct * 100).toFixed(0)}% of available balance/trade`
      : `$${this.config.perTradeMarginUsd} margin/trade`;
    this.log(
      'info',
      `Starting breakout futures scanner across all USDT perpetuals: ` +
      `${sizingDesc} @ ${this.config.leverage}x ${this.config.marginMode}, ` +
      `shared lifetime budget cap $${this.config.budgetCapUsd} (hard backstop regardless of sizing), ` +
      `stop-loss ${(this.config.stopLossPct * 100).toFixed(2)}%, take-profit ${(this.config.takeProfitPct * 100).toFixed(2)}%, ` +
      `long signal = within ${(this.config.nearHighThresholdPct * 100).toFixed(2)}% of 24h high and 24h change > ${this.config.momentumThresholdPct}%, ` +
      `short signal = within ${(this.config.nearLowThresholdPct * 100).toFixed(2)}% of 24h low and 24h change < -${this.config.breakdownThresholdPct}%`
    );

    // Avoids landing this scan's startup burst (getAll24hrTickers + up to
    // maxCandidatesPerCycle position opens) in the exact same instant as the DCA
    // slots' and mean-reversion's own startup bursts, all spawned within the same
    // few seconds at boot.
    if (this.isRunning) {
      await new Promise(resolve => setTimeout(resolve, Math.random() * 60000));
    }

    while (this.isRunning) {
      try {
        await this.scanAndTrade();
      } catch (error) {
        this.log('error', 'Error in breakout scan cycle:', error.message);
        this.state = 'error';
      }

      if (this.isRunning) {
        const jitterMs = Math.random() * 0.1 * this.config.scanIntervalMs;
        await new Promise(resolve => setTimeout(resolve, this.config.scanIntervalMs + jitterMs));
      }
    }
  }

  /**
   * One scan cycle: fetch all tickers, find breakout candidates, then sequentially
   * (not in parallel) attempt to open positions for up to maxCandidatesPerCycle of
   * them, re-checking the shared budget cap before each one.
   * @returns {Promise<Array>} trades opened this cycle
   */
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
    const eligible = t => perpetualSet.has(t.symbol) && !symbolsTradedToday.has(t.symbol) && t.quoteVolume >= this.config.minQuoteVolumeUsd;

    const longCandidates = tickers
      .filter(t =>
        eligible(t) &&
        t.highPrice > 0 &&
        t.lastPrice >= t.highPrice * (1 - this.config.nearHighThresholdPct) &&
        t.priceChangePercent >= this.config.momentumThresholdPct
      )
      .map(t => ({ ...t, direction: 'long' }));

    // Mirror-image of the breakout signal: near the 24h low AND down beyond
    // breakdownThresholdPct on the day opens a short instead of a long.
    const shortCandidates = tickers
      .filter(t =>
        eligible(t) &&
        t.lowPrice > 0 &&
        t.lastPrice <= t.lowPrice * (1 + this.config.nearLowThresholdPct) &&
        t.priceChangePercent <= -this.config.breakdownThresholdPct
      )
      .map(t => ({ ...t, direction: 'short' }));

    // Strongest move (either direction) first.
    const candidates = [...longCandidates, ...shortCandidates]
      .sort((a, b) => Math.abs(b.priceChangePercent) - Math.abs(a.priceChangePercent));

    this.lastScanCandidates = candidates.slice(0, 10).map(c => ({
      symbol: c.symbol,
      direction: c.direction,
      priceChangePercent: c.priceChangePercent,
      lastPrice: c.lastPrice
    }));

    this.log(
      'info',
      `Scanned ${tickers.length} symbols (${perpetualSet.size} eligible perpetuals), ` +
      `found ${candidates.length} breakout candidate(s)`
    );

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

      const desiredMargin = this.config.sizingMode === 'percentOfBalance'
        ? (await realFuturesTradingService.getAvailableFuturesBalanceUsd()) * this.config.riskPct
        : this.config.perTradeMarginUsd;
      // budgetCapUsd (per-agent) and the global cross-agent cap are both hard
      // backstops, regardless of sizing mode — a growing balance can never push a
      // single trade's margin past either.
      const marginUsd = Math.min(desiredMargin, budget.remaining);
      if (marginUsd <= 0) continue;

      try {
        const openFn = candidate.direction === 'long'
          ? realFuturesTradingService.openLeveragedLong
          : realFuturesTradingService.openLeveragedShort;
        const result = await openFn({
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
          `Breakout ${candidate.direction} entry: $${marginUsd} margin @ ${this.config.leverage}x of ${candidate.symbol} ` +
          `(24h change ${candidate.priceChangePercent}%) -> qty=${result.filledQty} @ ${result.fillPrice}` +
          (result.stopPrice ? `, stop-loss @ ${result.stopPrice}` : ', NO STOP-LOSS PLACED (check logs for error)')
        );

        opened.push(result);
      } catch (error) {
        this.log('error', `Failed to open breakout position for ${candidate.symbol}:`, error.message);
      }
    }

    if (opened.length === 0) {
      this.state = 'idle';
    }

    return opened;
  }

  /**
   * Extended status including real margin spend and current scan candidates, for
   * the dashboard.
   * @returns {Promise<Object>}
   */
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
      'Cleaning up breakout futures agent (no auto-liquidation/close performed; ' +
      'open positions and stop-loss orders remain live on the account)'
    );
  }
}

module.exports = BreakoutFuturesAgent;

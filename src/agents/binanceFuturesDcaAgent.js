// REAL MONEY, LEVERAGED agent: opens real Binance USDT-M futures long positions on a
// daily dollar-cost-averaging schedule, against the user's own Binance.com account.
//
// Safety properties (do not remove without updating the plan/tests):
// - Never calls walletService.addEarnings — zero interaction with the fabricated
//   in-app "earnings" currency used by cryptoHunter/developer/opportunityScout agents.
// - Every order goes through realFuturesTradingService.openLeveragedLong, which
//   independently requires LIVE_TRADING_CONFIRMED=true, LIVE_FUTURES_TRADING_CONFIRMED=true,
//   and real (non-placeholder) Binance credentials.
// - "Already bought today" is derived from the real trade ledger's own timestamps, not
//   in-memory state, so a process restart can never cause a double-open.
// - Once the configured margin budget cap is spent, this agent halts permanently and
//   will never open another position (no auto-reset).
// - At high leverage, a stop-loss is attached at open time to bound the loss on each
//   position — but liquidation can still occur faster than the stop-loss fills during
//   extreme volatility/slippage. This agent NEVER widens leverage or position size on
//   its own; those are fixed config values a human must change deliberately.
const BaseAgent = require('./baseAgent');
const realFuturesTradingService = require('../services/realFuturesTradingService');

class BinanceFuturesDcaAgent extends BaseAgent {
  constructor(options = {}) {
    super({
      ...options,
      type: 'binanceFuturesDca',
      config: {
        symbol: options.config?.symbol || 'BTCUSDT',
        dailyMarginUsd: options.config?.dailyMarginUsd || 5,
        budgetCapUsd: options.config?.budgetCapUsd || 50,
        leverage: options.config?.leverage || 50,
        marginMode: options.config?.marginMode || 'ISOLATED',
        stopLossPct: options.config?.stopLossPct != null ? options.config.stopLossPct : 0.01,
        takeProfitPct: options.config?.takeProfitPct != null ? options.config.takeProfitPct : 0.03,
        checkIntervalMs: options.config?.checkIntervalMs || 3600000,
        ...options.config
      }
    });

    // Set once the budget cap is reached; never cleared automatically.
    this.haltedReason = null;
  }

  async run() {
    this.log(
      'info',
      `Starting Binance Futures DCA agent for ${this.config.symbol}: ` +
      `$${this.config.dailyMarginUsd}/day margin @ ${this.config.leverage}x ${this.config.marginMode}, ` +
      `budget cap $${this.config.budgetCapUsd}, stop-loss ${(this.config.stopLossPct * 100).toFixed(2)}%, ` +
      `take-profit ${(this.config.takeProfitPct * 100).toFixed(2)}%`
    );

    while (this.isRunning) {
      try {
        await this.maybeOpenDailyPosition();
      } catch (error) {
        this.log('error', 'Error in futures DCA cycle:', error.message);
        this.state = 'error';
      }

      if (this.isRunning) {
        await new Promise(resolve => setTimeout(resolve, this.config.checkIntervalMs));
      }
    }
  }

  /**
   * Core cycle: checks budget/halt state, checks whether today's position already
   * opened (derived from the real ledger, not memory), and if not, opens a real
   * leveraged position clamped to the remaining margin budget.
   * @returns {Promise<Object|null>} the recorded trade, or null if no order was placed
   */
  async maybeOpenDailyPosition() {
    if (this.haltedReason) {
      this.state = 'resting';
      return null;
    }

    const budget = await realFuturesTradingService.getEffectiveRemainingBudgetUsd(this.id, this.config.budgetCapUsd);
    if (budget.spentByAgent >= this.config.budgetCapUsd) {
      this.haltedReason = `Budget cap of $${this.config.budgetCapUsd} margin reached (spent $${budget.spentByAgent.toFixed(2)})`;
      this.log('warn', this.haltedReason);
      this.state = 'resting';
      return null;
    }
    if (budget.remaining <= 0) {
      this.log('warn', `Global futures budget cap of $${budget.globalCapUsd} reached across all real futures agents (spent $${budget.spentAllAgents.toFixed(2)}) — waiting for room to free up`);
      this.state = 'resting';
      return null;
    }

    const ledger = await realFuturesTradingService.getLedger(this.id);
    const lastOrder = ledger[ledger.length - 1];
    const today = new Date().toISOString().slice(0, 10);
    const lastOrderDay = lastOrder ? new Date(lastOrder.timestamp).toISOString().slice(0, 10) : null;

    if (lastOrderDay === today) {
      this.state = 'idle';
      return null;
    }

    const marginUsd = Math.min(this.config.dailyMarginUsd, budget.remaining);
    if (marginUsd <= 0) {
      return null;
    }

    this.state = 'active';
    const result = await realFuturesTradingService.openLeveragedLong({
      symbol: this.config.symbol,
      marginUsd,
      leverage: this.config.leverage,
      marginMode: this.config.marginMode,
      stopLossPct: this.config.stopLossPct,
      takeProfitPct: this.config.takeProfitPct,
      agentId: this.id
    });

    // Intentionally NOT touching `earnings` — this agent has no fake-currency
    // interaction. Real spend/holdings/P&L live only in realFuturesTradingService's ledger.
    this.updatePerformance({
      actionsTaken: this.performance.actionsTaken + 1
    });

    this.log(
      'info',
      `Opened real leveraged long: $${marginUsd} margin @ ${this.config.leverage}x of ${this.config.symbol} ` +
      `-> qty=${result.filledQty} @ ${result.fillPrice}` +
      (result.stopPrice ? `, stop-loss @ ${result.stopPrice}` : ', NO STOP-LOSS PLACED (check logs for error)')
    );

    return result;
  }

  /**
   * Extended status including real margin spend/holdings, for the dashboard.
   * @returns {Promise<Object>}
   */
  async getStatusExtended() {
    const [spent, ledger, currentPrice] = await Promise.all([
      realFuturesTradingService.getTotalMarginUsd(this.id),
      realFuturesTradingService.getLedger(this.id),
      realFuturesTradingService.getCurrentPrice(this.config.symbol).catch(() => null)
    ]);

    return {
      ...this.getStatus(),
      real: {
        symbol: this.config.symbol,
        leverage: this.config.leverage,
        marginMode: this.config.marginMode,
        totalMarginSpentUsd: spent,
        budgetCapUsd: this.config.budgetCapUsd,
        budgetRemainingUsd: Math.max(0, this.config.budgetCapUsd - spent),
        currentPrice,
        halted: !!this.haltedReason,
        haltedReason: this.haltedReason,
        lastOrder: ledger[ledger.length - 1] || null
      }
    };
  }

  async cleanup() {
    this.log(
      'info',
      'Cleaning up Binance Futures DCA agent (no auto-liquidation/close performed; ' +
      'open positions and stop-loss orders remain live on the account)'
    );
  }
}

module.exports = BinanceFuturesDcaAgent;

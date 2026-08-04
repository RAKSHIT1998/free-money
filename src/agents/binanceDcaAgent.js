// REAL MONEY agent: places real Binance spot market-buy orders on a daily
// dollar-cost-averaging schedule, against the user's own Binance.com account.
//
// Safety properties (do not remove without updating the plan/tests):
// - Never calls walletService.addEarnings — has zero interaction with the fabricated
//   in-app "earnings" currency used by cryptoHunter/developer/opportunityScout agents.
// - Every order goes through realTradingService.placeMarketBuyOrder, which independently
//   requires LIVE_TRADING_CONFIRMED=true and real (non-placeholder) Binance credentials.
// - "Already bought today" is derived from the real trade ledger's own timestamps, not
//   in-memory state, so a process restart can never cause a double-buy.
// - Once the configured budget cap is spent, this agent halts permanently and will
//   never place another order (no auto-reset, no auto-sell/liquidation anywhere here).
const BaseAgent = require('./baseAgent');
const realTradingService = require('../services/realTradingService');

class BinanceDcaAgent extends BaseAgent {
  constructor(options = {}) {
    super({
      ...options,
      type: 'binanceDca',
      config: {
        symbol: options.config?.symbol || 'BTCUSDT',
        dailyBuyUsd: options.config?.dailyBuyUsd || 5,
        budgetCapUsd: options.config?.budgetCapUsd || Infinity,
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
      `Starting Binance DCA agent for ${this.config.symbol}: $${this.config.dailyBuyUsd}/day, budget cap $${this.config.budgetCapUsd}`
    );

    while (this.isRunning) {
      try {
        await this.maybePlaceDailyOrder();
      } catch (error) {
        this.log('error', 'Error in DCA cycle:', error.message);
        this.state = 'error';
      }

      if (this.isRunning) {
        await new Promise(resolve => setTimeout(resolve, this.config.checkIntervalMs));
      }
    }
  }

  /**
   * Core cycle: checks budget/halt state, checks whether today's buy already
   * happened (derived from the real ledger, not memory), and if not, places a
   * real order clamped to the remaining budget.
   * @returns {Promise<Object|null>} the recorded trade, or null if no order was placed
   */
  async maybePlaceDailyOrder() {
    if (this.haltedReason) {
      this.state = 'resting';
      return null;
    }

    const spentSoFar = await realTradingService.getTotalSpentUsd(this.id, this.config.symbol);
    if (spentSoFar >= this.config.budgetCapUsd) {
      this.haltedReason = `Budget cap of $${this.config.budgetCapUsd} reached (spent $${spentSoFar.toFixed(2)})`;
      this.log('warn', this.haltedReason);
      this.state = 'resting';
      return null;
    }

    const ledger = await realTradingService.getLedger(this.id);
    const lastOrder = ledger[ledger.length - 1];
    const today = new Date().toISOString().slice(0, 10);
    const lastOrderDay = lastOrder ? new Date(lastOrder.timestamp).toISOString().slice(0, 10) : null;

    if (lastOrderDay === today) {
      this.state = 'idle';
      return null;
    }

    const remaining = this.config.budgetCapUsd - spentSoFar;
    const buyAmount = Math.min(this.config.dailyBuyUsd, remaining);
    if (buyAmount <= 0) {
      return null;
    }

    this.state = 'active';
    const result = await realTradingService.placeMarketBuyOrder({
      symbol: this.config.symbol,
      quoteOrderQtyUsd: buyAmount,
      agentId: this.id
    });

    // Intentionally NOT touching `earnings` — this agent has no fake-currency
    // interaction. Real spend/holdings/P&L live only in realTradingService's ledger.
    this.updatePerformance({
      actionsTaken: this.performance.actionsTaken + 1
    });

    this.log(
      'info',
      `Placed real DCA buy: $${buyAmount} of ${this.config.symbol} -> qty=${result.filledQty} @ ${result.fillPrice}`
    );

    return result;
  }

  /**
   * Extended status including real spend/holdings/live P&L, for the dashboard.
   * @returns {Promise<Object>}
   */
  async getStatusExtended() {
    const pnl = await realTradingService.computeUnrealizedPnl(this.id, this.config.symbol);
    const ledger = await realTradingService.getLedger(this.id);

    return {
      ...this.getStatus(),
      real: {
        symbol: this.config.symbol,
        totalSpentUsd: pnl.spent,
        budgetCapUsd: this.config.budgetCapUsd,
        budgetRemainingUsd: Math.max(0, this.config.budgetCapUsd - pnl.spent),
        qtyHeld: pnl.qty,
        currentPrice: pnl.currentPrice,
        unrealizedPnl: pnl.unrealizedPnl,
        halted: !!this.haltedReason,
        haltedReason: this.haltedReason,
        lastOrder: ledger[ledger.length - 1] || null
      }
    };
  }

  async cleanup() {
    this.log('info', 'Cleaning up Binance DCA agent (no auto-liquidation performed; holdings remain in the account)');
  }
}

module.exports = BinanceDcaAgent;

// REAL MONEY agent: periodically checks the spot wallet's free (idle) balance of a
// given asset and subscribes anything above a configured reserve into the
// highest-APY subscribable Binance Simple Earn flexible product for that asset.
//
// Distinct risk profile from every other real-money agent in this codebase: no
// leverage, no directional market exposure, no open position that can move against
// you — the subscribed asset is redeemable back to spot at any time (see
// binanceEarnService.redeemFlexible), so the only real risks are Binance/product
// counterparty risk and the (usually variable, can drop) APY itself.
//
// Safety properties (do not remove without updating the plan/tests):
// - Never calls walletService.addEarnings — zero interaction with the fabricated
//   in-app "earnings" currency used by cryptoHunter/developer/opportunityScout agents.
// - Every subscribe/redeem goes through binanceEarnService, which independently
//   requires LIVE_TRADING_CONFIRMED=true and real (non-placeholder) Binance credentials.
// - reserveUsd is never touched — this agent only ever acts on the amount ABOVE that
//   reserve, so it can't starve the spot DCA agent (or anything else drawing from the
//   same spot wallet) of the balance it needs for its own next buy.
// - Never redeems on its own initiative — redemption is a manual action via the
//   service, not something this agent's cycle does automatically.
const BaseAgent = require('./baseAgent');
const binanceEarnService = require('../services/binanceEarnService');
const realTradingService = require('../services/realTradingService');

class BinanceEarnAgent extends BaseAgent {
  constructor(options = {}) {
    super({
      ...options,
      type: 'binanceEarn',
      config: {
        asset: options.config?.asset || 'USDT',
        // Left untouched in the spot wallet — e.g. so binanceDca's daily buy always has
        // room, regardless of how much idle balance this agent has swept into Earn.
        reserveUsd: options.config?.reserveUsd != null ? options.config.reserveUsd : 20,
        // Not worth a Binance call over trivial dust — also avoids repeatedly retrying
        // an amount that's below a product's own minPurchaseAmount.
        minSubscribeUsd: options.config?.minSubscribeUsd != null ? options.config.minSubscribeUsd : 5,
        checkIntervalMs: options.config?.checkIntervalMs || 21600000, // 6 hours — idle balance doesn't need fast reaction
        ...options.config
      }
    });

    this.haltedReason = null;
  }

  async run() {
    this.log(
      'info',
      `Starting Binance Earn agent for ${this.config.asset}: sweeps idle spot balance above ` +
      `$${this.config.reserveUsd} reserve into the highest-APY flexible Earn product, checks every ` +
      `${Math.round(this.config.checkIntervalMs / 60000)} min`
    );

    if (this.isRunning) {
      await new Promise(resolve => setTimeout(resolve, Math.random() * 60000));
    }

    while (this.isRunning) {
      try {
        await this.maybeSubscribeIdleBalance();
      } catch (error) {
        this.log('error', 'Error in Earn cycle:', error.message);
        this.state = 'error';
      }

      if (this.isRunning) {
        await new Promise(resolve => setTimeout(resolve, this.config.checkIntervalMs));
      }
    }
  }

  /**
   * Core cycle: checks idle spot balance above the reserve, and if there's enough to
   * be worth acting on, subscribes it to the best available flexible Earn product.
   * @returns {Promise<Object|null>} the recorded action, or null if nothing was done
   */
  async maybeSubscribeIdleBalance() {
    if (this.haltedReason) {
      this.state = 'resting';
      return null;
    }

    // Checked up front, quietly, rather than attempting a call and logging the same
    // "spot disabled" error every 6-hour cycle — the spot wallet holds $0 right now,
    // so there's nothing this agent could act on even if the call went through.
    try {
      realTradingService.assertSpotCallsAllowed();
    } catch (error) {
      this.state = 'resting';
      return null;
    }

    this.state = 'active';

    const freeBalance = await binanceEarnService.getFreeSpotBalance(this.config.asset);
    const idle = freeBalance - this.config.reserveUsd;

    if (idle < this.config.minSubscribeUsd) {
      this.state = 'idle';
      return null;
    }

    const products = await binanceEarnService.getFlexibleProducts(this.config.asset);
    const subscribable = products.filter(p => p.canPurchase !== false && p.isSoldOut !== true);

    if (subscribable.length === 0) {
      this.log('warn', `No subscribable flexible Earn products found for ${this.config.asset} this cycle`);
      this.state = 'idle';
      return null;
    }

    // Highest APY first — latestAnnualPercentageRate is Binance's own real-time rate,
    // not a fixed/advertised one.
    subscribable.sort((a, b) => parseFloat(b.latestAnnualPercentageRate || 0) - parseFloat(a.latestAnnualPercentageRate || 0));
    const best = subscribable[0];

    const minPurchase = parseFloat(best.minPurchaseAmount || 0);
    if (idle < minPurchase) {
      this.log('warn', `Idle balance $${idle.toFixed(2)} is below ${best.productId}'s minimum purchase of $${minPurchase}`);
      this.state = 'idle';
      return null;
    }

    const result = await binanceEarnService.subscribeFlexible({
      productId: best.productId,
      asset: this.config.asset,
      amount: idle,
      agentId: this.id,
      latestAnnualPercentageRate: parseFloat(best.latestAnnualPercentageRate || 0)
    });

    this.updatePerformance({
      actionsTaken: this.performance.actionsTaken + 1
    });

    this.log(
      'info',
      `Subscribed $${idle.toFixed(2)} ${this.config.asset} to Earn product ${best.productId} ` +
      `(APY ${(parseFloat(best.latestAnnualPercentageRate || 0) * 100).toFixed(2)}%)`
    );

    return result;
  }

  /**
   * Extended status including current Earn positions and free balance, for the dashboard.
   * @returns {Promise<Object>}
   */
  async getStatusExtended() {
    const [freeBalance, positions, ledger] = await Promise.all([
      binanceEarnService.getFreeSpotBalance(this.config.asset).catch(() => null),
      binanceEarnService.getFlexiblePositions(this.config.asset).catch(() => []),
      binanceEarnService.getLedger(this.id)
    ]);

    return {
      ...this.getStatus(),
      real: {
        asset: this.config.asset,
        freeSpotBalance: freeBalance,
        reserveUsd: this.config.reserveUsd,
        positions,
        halted: !!this.haltedReason,
        haltedReason: this.haltedReason,
        recentActions: ledger.slice(-10)
      }
    };
  }

  async cleanup() {
    this.log(
      'info',
      'Cleaning up Binance Earn agent (no auto-redeem performed; any subscribed Earn position remains live on the account)'
    );
  }
}

module.exports = BinanceEarnAgent;

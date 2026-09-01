// Manager-side half of the DIY "follow best meme coin traders" system — see
// smartMoneyTrackerService.js's file header for the full design and why this is
// self-built rather than dependent on a third-party leaderboard/API key.
// pumpFunSniperAgent records real on-chain "who bought this early" observations as
// it evaluates candidates; this agent's only job is to periodically go back and
// judge those observations against real, current market caps, and expose the
// resulting leaderboard. Purely read-only/analytical — never buys, sells, or
// follows a wallet's trades; see the service file for why copy-trading is
// explicitly out of scope (this reads chain data, not custody of anything).
const BaseAgent = require('./baseAgent');
const smartMoneyTrackerService = require('../services/smartMoneyTrackerService');

class SmartMoneyTrackerAgent extends BaseAgent {
  constructor(options = {}) {
    super({
      ...options,
      type: 'smartMoneyTracker',
      config: {
        reconcileIntervalMs: options.config?.reconcileIntervalMs || 1800000, // 30 min
        maxReconcilePerCycle: options.config?.maxReconcilePerCycle || 20,
        ...options.config
      }
    });
    this.lastCycleSummary = null;
  }

  async run() {
    this.log('info', `Starting smart-money tracker: judging real on-chain early-buy observations every ${this.config.reconcileIntervalMs}ms against ${smartMoneyTrackerService.PUMP_MULTIPLE_THRESHOLD}x market-cap growth — read-only, never trades or follows anyone`);

    while (this.isRunning) {
      try {
        await this.cycle();
      } catch (error) {
        this.log('error', 'Reconciliation cycle failed:', error.message);
        this.state = 'error';
      }

      if (this.isRunning) {
        await new Promise(resolve => setTimeout(resolve, this.config.reconcileIntervalMs));
      }
    }
  }

  async cycle() {
    this.state = 'active';
    const result = await smartMoneyTrackerService.reconcilePending(this.config.maxReconcilePerCycle);
    // Self-paced internally (see FETCH_MIN_INTERVAL_MS) — safe to call every cycle
    // regardless of this agent's own interval; it no-ops if the cache is still
    // fresh, or if no SOLANA_TRACKER_API_KEY is configured at all.
    const established = await smartMoneyTrackerService.refreshEstablishedLeaderboard().catch(() => null);
    this.lastCycleSummary = { timestamp: new Date(), ...result, establishedLeaderboardFetchedAt: established?.fetchedAt || null };
    this.updatePerformance({ actionsTaken: this.performance.actionsTaken + 1 });
    this.log('info', `Reconciled ${result.reconciled} observation(s), dropped ${result.stale} as stale`);
    this.state = 'idle';
  }

  getStatus() {
    return {
      ...super.getStatus(),
      smartMoney: {
        lastCycleSummary: this.lastCycleSummary,
        stats: smartMoneyTrackerService.getStats(),
        diyLeaderboard: smartMoneyTrackerService.getLeaderboard(),
        establishedLeaderboard: smartMoneyTrackerService.getEstablishedLeaderboard()
      }
    };
  }

  async cleanup() {
    this.log('info', 'Cleaning up smart money tracker agent');
  }
}

module.exports = SmartMoneyTrackerAgent;

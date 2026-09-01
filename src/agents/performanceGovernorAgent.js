// "Race to survival": periodically reviews every real-money directional trading agent
// (binanceFuturesDca, breakoutFutures, meanReversionFutures, pumpFunSniper) against its
// own REAL realized P&L and, once it has enough closed trades to not just be noise,
// either stops it (sustained real loss) or raises its budget cap (sustained real
// profit, reallocating room from agents that aren't earning it). Deliberately excludes
// binanceEarn (no directional exposure, can't "lose" the way these do) and
// fundingRateArbitrage (market-neutral by design). Never touches an agent mid-position
// — see hasOpenPosition/openPosition checks below — so a real leveraged or pump.fun
// position is never left unmonitored by a mid-flight removal.
const BaseAgent = require('./baseAgent');
const realFuturesTradingService = require('../services/realFuturesTradingService');
const agentCullService = require('../services/agentCullService');
const agentMemoryService = require('../services/agentMemoryService');
const telegramNotifierService = require('../services/telegramNotifierService');

const FUTURES_TYPES = ['binanceFuturesDca', 'breakoutFutures', 'meanReversionFutures'];

class PerformanceGovernorAgent extends BaseAgent {
  constructor(options = {}) {
    super({
      ...options,
      type: 'performanceGovernor',
      config: {
        checkIntervalMs: options.config?.checkIntervalMs || 1800000, // 30 minutes
        minClosedTradesFutures: options.config?.minClosedTradesFutures ?? 8,
        minClosedTradesPumpFun: options.config?.minClosedTradesPumpFun ?? 5,
        // Cull once net realized P&L falls below -(lossThresholdPct * reference budget).
        lossThresholdPct: options.config?.lossThresholdPct ?? 0.5,
        // Raise budgetCapUsd once net realized P&L reaches +(eliteThresholdPct * budgetCapUsd).
        eliteThresholdPct: options.config?.eliteThresholdPct ?? 0.5,
        boostFactor: options.config?.boostFactor ?? 1.5,
        maxBudgetCapUsd: options.config?.maxBudgetCapUsd ?? 100,
        ...options.config
      }
    });
    this.lastCycleSummary = null;
  }

  async run() {
    this.log('info', `Starting performance governor: reviewing every ${this.config.checkIntervalMs}ms, culling below -${this.config.lossThresholdPct * 100}% of allocated budget, boosting above +${this.config.eliteThresholdPct * 100}%`);

    while (this.isRunning) {
      try {
        await this.cycle();
      } catch (error) {
        this.log('error', 'Governor cycle failed:', error.message);
      }

      if (this.isRunning) {
        await new Promise(resolve => setTimeout(resolve, this.config.checkIntervalMs));
      }
    }
  }

  async cleanup() {
    this.log('info', 'Cleaning up performance governor');
  }

  async cycle() {
    this.state = 'active';

    // Lazy require to avoid a circular require at module load time (agentManager
    // requires every agent type, including this one).
    const AgentManager = require('./agentManager');
    const manager = AgentManager.getInstance();
    const agents = manager.getAllAgents().filter(a => a.id !== this.id);

    let culled = 0;
    let boosted = 0;

    for (const agent of agents) {
      try {
        if (FUTURES_TYPES.includes(agent.type)) {
          const outcome = await this.evaluateFuturesAgent(manager, agent);
          if (outcome === 'culled') culled++;
          if (outcome === 'boosted') boosted++;
        } else if (agent.type === 'pumpFunSniper') {
          const outcome = await this.evaluatePumpFunAgent(manager, agent);
          if (outcome === 'culled') culled++;
        }
      } catch (error) {
        this.log('error', `Failed to evaluate ${agent.type}#${agent.id}:`, error.message);
      }
    }

    this.lastCycleSummary = { timestamp: new Date(), reviewed: agents.length, culled, boosted };
    this.updatePerformance({ actionsTaken: this.performance.actionsTaken + 1 });
    this.state = 'idle';
  }

  async evaluateFuturesAgent(manager, agent) {
    const perf = await realFuturesTradingService.getAgentPerformance(String(agent.id));
    if (perf.hasOpenPosition) return null; // never touch an agent mid-position
    if (perf.closedTradeCount < this.config.minClosedTradesFutures) return null;

    const label = `${agent.type}#${agent.id}${agent.config?.symbol ? ` (${agent.config.symbol})` : ''}`;
    const budgetCapUsd = Number.isFinite(agent.config?.budgetCapUsd) ? agent.config.budgetCapUsd : null;
    // Uncapped agents still get judged, against a reference scaled to their own trade
    // count, so an uncapped losing agent isn't permanently unculllable.
    const refBudget = budgetCapUsd || Math.max(perf.closedTradeCount * 5, 20);

    if (perf.netRealizedPnlUsd <= -(this.config.lossThresholdPct * refBudget)) {
      const reason = `Culled: net realized P&L $${perf.netRealizedPnlUsd.toFixed(2)} over ${perf.closedTradeCount} closed trades (${perf.winCount}W/${perf.lossCount}L) breached -${(this.config.lossThresholdPct * 100).toFixed(0)}% loss threshold`;
      this.log('warn', `${label}: ${reason}`);
      await agentCullService.recordCull(agent.type, agent.config?.symbol || null, reason, perf);
      agentMemoryService.recordLesson(agent.type, reason, { symbol: agent.config?.symbol, agentId: agent.id });
      telegramNotifierService.sendMessage(`⚠️ <b>Culled ${label}</b>\n${reason}`).catch(() => {});
      await manager.removeAgent(agent.id);
      return 'culled';
    }

    if (budgetCapUsd && perf.netRealizedPnlUsd >= this.config.eliteThresholdPct * budgetCapUsd) {
      const newCap = Math.min(budgetCapUsd * this.config.boostFactor, this.config.maxBudgetCapUsd);
      if (newCap > budgetCapUsd) {
        const boostMsg = `Boosted: elite performer (net +$${perf.netRealizedPnlUsd.toFixed(2)} over ${perf.closedTradeCount} trades, ${perf.winCount}W/${perf.lossCount}L) — budgetCapUsd $${budgetCapUsd} -> $${newCap.toFixed(2)}`;
        this.log('info', `${label}: ${boostMsg}`);
        agentMemoryService.recordLesson(agent.type, boostMsg, { symbol: agent.config?.symbol, agentId: agent.id });
        telegramNotifierService.sendMessage(`🚀 <b>Boosted ${label}</b>\n${boostMsg}`).catch(() => {});
        await manager.updateAgentConfig(agent.id, { budgetCapUsd: newCap });
        return 'boosted';
      }
    }

    return null;
  }

  async evaluatePumpFunAgent(manager, agent) {
    if (agent.openPosition) return null; // never touch an agent mid-position

    // Source real history from the persistent, restart-safe ledger, not
    // agent.performance/actionsTaken -- those live only in this process's memory
    // (reset to zero on every pm2 restart) and every fresh spawn gets a new
    // incrementing agent id too, so neither one ever actually accumulates enough to
    // trip this cull path across a restart. Found 2026-09-01 auditing why this had
    // never fired despite real, live losses. getAllTimeSummary() is global (every
    // pump.fun trade ever recorded, any agent id) -- the right scope for "should
    // this STRATEGY keep running", not "has this particular process instance done
    // badly since it last booted".
    const pumpFunTradingService = require('../services/pumpFunTradingService');
    const summary = await pumpFunTradingService.getAllTimeSummary();
    if (summary.closedTradeCount < this.config.minClosedTradesPumpFun) return null;

    const earnings = summary.totalRealizedPnlUsd || 0;
    const configuredCap = Number.isFinite(agent.config?.budgetCapUsd) ? agent.config.budgetCapUsd : null;
    let refBudget = configuredCap;
    if (!refBudget) {
      // budgetCapUsd is Infinity by design (2026-09-01: "whatever's in the wallet,
      // use it") -- the old hardcoded $10 fallback made the -50% cull threshold
      // ($5) meaningless against a real wallet worth ~$2. Use the wallet's current
      // free SOL value instead: the real amount actually at risk right now, with a
      // $1 floor so a single small loss can't trip it on a near-empty wallet.
      const [freeSol, solPrice] = await Promise.all([
        pumpFunTradingService.getWalletBalanceSol(),
        pumpFunTradingService.getSolUsdPrice()
      ]);
      refBudget = Math.max(freeSol * solPrice, 1);
    }

    if (earnings <= -(this.config.lossThresholdPct * refBudget)) {
      const reason = `Culled: lifetime real P&L $${earnings.toFixed(2)} over ${summary.closedTradeCount} closed trades (${summary.winCount}W/${summary.lossCount}L) breached -${(this.config.lossThresholdPct * 100).toFixed(0)}% of $${refBudget.toFixed(2)} at-risk reference`;
      this.log('warn', `pumpFunSniper#${agent.id}: ${reason}`);
      await agentCullService.recordCull(agent.type, null, reason, { netRealizedPnlUsd: earnings, closedTradeCount: summary.closedTradeCount });
      agentMemoryService.recordLesson(agent.type, reason, { agentId: agent.id });
      telegramNotifierService.sendMessage(`⚠️ <b>Culled pumpFunSniper#${agent.id}</b>\n${reason}`).catch(() => {});
      await manager.removeAgent(agent.id);
      return 'culled';
    }

    return null;
  }

  getStatusExtended() {
    return {
      ...this.getStatus(),
      governor: { lastCycleSummary: this.lastCycleSummary }
    };
  }
}

module.exports = PerformanceGovernorAgent;

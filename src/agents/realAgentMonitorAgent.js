// Health-monitor agent: watches every OTHER agent for one stuck in 'error' state and
// restarts it in place. Not a survival/elimination system like the old simulated
// 'manager' agent — that logic never touches real trading agents, which may be
// holding real leveraged positions and must never be silently killed/removed.
//
// "Restart in place" means calling stop()/start() on the SAME agent instance/ID,
// deliberately NOT remove+respawn. A real futures agent's per-agent budget cap is
// tracked by its numeric agent ID (see realFuturesTradingService.getTotalMarginUsd) —
// spawning a replacement with a new ID would silently reset that agent's own cap
// tracking (the shared global cap would still catch total exposure, but there's no
// reason to introduce that gap). Restarting in place preserves the ID and therefore
// the existing budget-cap history.
const BaseAgent = require('./baseAgent');

class RealAgentMonitorAgent extends BaseAgent {
  constructor(options = {}) {
    super({
      ...options,
      type: 'realAgentMonitor',
      config: {
        checkIntervalMs: options.config?.checkIntervalMs || 120000, // 2 minutes
        errorCyclesBeforeRestart: options.config?.errorCyclesBeforeRestart || 2,
        // How long to fully stand down (no restarts at all, regardless of streaks)
        // after detecting a likely shared external failure. Long enough to outlast
        // a typical exchange rate-limit ban rather than re-trigger it repeatedly.
        systemicBackoffMs: options.config?.systemicBackoffMs || 45 * 60000, // 45 minutes
        ...options.config
      }
    });

    this.errorStreaks = new Map(); // agentId -> consecutive error-state sightings
    this.restartHistory = [];
    this.systemicBackoffUntil = 0;
  }

  async run() {
    this.log('info', `Starting real agent health monitor: checks every ${this.config.checkIntervalMs}ms, restarts an agent after ${this.config.errorCyclesBeforeRestart} consecutive error-state checks`);

    while (this.isRunning) {
      try {
        await this.checkAndRestart();
      } catch (error) {
        this.log('error', 'Error in health monitor cycle:', error.message);
      }

      if (this.isRunning) {
        await new Promise(resolve => setTimeout(resolve, this.config.checkIntervalMs));
      }
    }
  }

  async checkAndRestart() {
    this.state = 'active';

    if (Date.now() < this.systemicBackoffUntil) {
      this.log('info', `Standing down (systemic backoff) for ${Math.ceil((this.systemicBackoffUntil - Date.now()) / 60000)} more minute(s) — not restarting anything this cycle.`);
      this.state = 'idle';
      return;
    }

    // Lazy require to avoid a circular require at module load time (agentManager
    // requires every agent type, including this one).
    const AgentManager = require('./agentManager');
    const manager = AgentManager.getInstance();
    const agents = manager.getAllAgents().filter(a => a.id !== this.id);

    const seenThisCycle = new Set();
    const dueForRestart = [];

    for (const agent of agents) {
      seenThisCycle.add(agent.id);

      if (agent.state !== 'error') {
        this.errorStreaks.delete(agent.id);
        continue;
      }

      const streak = (this.errorStreaks.get(agent.id) || 0) + 1;
      this.errorStreaks.set(agent.id, streak);

      if (streak >= this.config.errorCyclesBeforeRestart) {
        dueForRestart.push(agent);
      } else {
        this.log('info', `${agent.type} (id ${agent.id}) in error state (${streak}/${this.config.errorCyclesBeforeRestart} checks) — waiting before restart`);
      }
    }

    // If a large fraction of agents are simultaneously due for restart, that's a
    // strong signal of a SHARED external problem (e.g. a Binance rate-limit ban
    // affecting every agent that talks to it), not N independent bugs. Restarting
    // all of them at once means N simultaneous immediate retries against something
    // still failing — exactly what turned a ~20-minute rate-limit ban into a 3+ hour
    // one in practice. Back off entirely this cycle instead of piling on.
    const SYSTEMIC_THRESHOLD = 3;
    if (dueForRestart.length >= SYSTEMIC_THRESHOLD) {
      this.systemicBackoffUntil = Date.now() + this.config.systemicBackoffMs;
      this.log('warn', `${dueForRestart.length} agents simultaneously due for restart (${dueForRestart.map(a => `${a.type}#${a.id}`).join(', ')}) — ` +
        `treating as a likely shared external issue (e.g. exchange rate-limit) rather than restarting all of them at once. ` +
        `Standing down for ${this.config.systemicBackoffMs / 60000} minutes.`);
      this.restartHistory.unshift({
        timestamp: new Date(),
        outcome: 'skipped_systemic',
        note: `${dueForRestart.length} agents due for restart simultaneously — backing off for ${this.config.systemicBackoffMs / 60000}min instead of restarting`
      });
      this.restartHistory = this.restartHistory.slice(0, 20);
    } else {
      for (const agent of dueForRestart) {
        await this.restartAgent(agent);
        this.errorStreaks.delete(agent.id);
      }
    }

    // Clean up tracking for agents that no longer exist (removed/terminated).
    for (const trackedId of this.errorStreaks.keys()) {
      if (!seenThisCycle.has(trackedId)) {
        this.errorStreaks.delete(trackedId);
      }
    }

    this.state = 'idle';
  }

  async restartAgent(agent) {
    this.log('warn', `Restarting ${agent.type} (id ${agent.id}) after ${this.config.errorCyclesBeforeRestart} consecutive error-state checks`);
    try {
      await agent.stop();
      await agent.start();

      this.updatePerformance({ actionsTaken: this.performance.actionsTaken + 1 });
      this.restartHistory.unshift({
        timestamp: new Date(),
        agentId: agent.id,
        agentType: agent.type,
        outcome: 'restarted'
      });
      this.restartHistory = this.restartHistory.slice(0, 20);
      this.log('info', `Restarted ${agent.type} (id ${agent.id})`);
    } catch (error) {
      this.log('error', `Failed to restart ${agent.type} (id ${agent.id}):`, error.message);
      this.restartHistory.unshift({
        timestamp: new Date(),
        agentId: agent.id,
        agentType: agent.type,
        outcome: 'restart_failed',
        error: error.message
      });
      this.restartHistory = this.restartHistory.slice(0, 20);
    }
  }

  getStatusExtended() {
    return {
      ...this.getStatus(),
      monitor: {
        watching: this.errorStreaks.size,
        restartHistory: this.restartHistory,
        systemicBackoffActive: Date.now() < this.systemicBackoffUntil,
        systemicBackoffRemainingMinutes: Math.max(0, Math.ceil((this.systemicBackoffUntil - Date.now()) / 60000))
      }
    };
  }

  async cleanup() {
    this.log('info', 'Cleaning up real agent health monitor');
  }
}

module.exports = RealAgentMonitorAgent;

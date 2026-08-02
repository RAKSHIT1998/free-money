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
        ...options.config
      }
    });

    this.errorStreaks = new Map(); // agentId -> consecutive error-state sightings
    this.restartHistory = [];
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
    // Lazy require to avoid a circular require at module load time (agentManager
    // requires every agent type, including this one).
    const AgentManager = require('./agentManager');
    const manager = AgentManager.getInstance();
    const agents = manager.getAllAgents().filter(a => a.id !== this.id);

    const seenThisCycle = new Set();

    for (const agent of agents) {
      seenThisCycle.add(agent.id);

      if (agent.state !== 'error') {
        this.errorStreaks.delete(agent.id);
        continue;
      }

      const streak = (this.errorStreaks.get(agent.id) || 0) + 1;
      this.errorStreaks.set(agent.id, streak);

      if (streak >= this.config.errorCyclesBeforeRestart) {
        await this.restartAgent(agent);
        this.errorStreaks.delete(agent.id);
      } else {
        this.log('info', `${agent.type} (id ${agent.id}) in error state (${streak}/${this.config.errorCyclesBeforeRestart} checks) — waiting before restart`);
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
        restartHistory: this.restartHistory
      }
    };
  }

  async cleanup() {
    this.log('info', 'Cleaning up real agent health monitor');
  }
}

module.exports = RealAgentMonitorAgent;

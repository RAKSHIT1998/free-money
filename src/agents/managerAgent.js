// Manager Agent - oversees other agents and implements survival-of-the-fittest logic
const BaseAgent = require('./baseAgent');
const Agent = require('../models/Agent');

class ManagerAgent extends BaseAgent {
  constructor(options = {}) {
    super({
      ...options,
      type: 'manager',
      config: {
        // Default configuration for manager agent
        evaluationInterval: options.config?.evaluationInterval || 300000, // 5 minutes
        survivalThreshold: options.config?.survivalThreshold || 0.2, // Bottom 20% get eliminated
        eliteThreshold: options.config?.eliteThreshold || 0.1, // Top 10% get boosted
        maxAgents: options.config?.maxAgents || 20,
        minAgents: options.config?.minAgents || 3,
        evaluationWeight: options.config?.evaluationWeight || {
          earningsPerHour: 0.4,
          opportunitiesPerHour: 0.3,
          successRate: 0.2,
          stability: 0.1
        },
        ...options.config
      }
    });

    // Reference to agent manager for controlling other agents
    this.agentManager = null;
  }

  /**
   * Set the agent manager reference
   * @param {AgentManager} manager - Reference to the agent manager
   */
  setAgentManager(manager) {
    this.agentManager = manager;
  }

  /**
   * Main logic loop for the manager agent
   * @returns {Promise<void>}
   */
  async run() {
    this.log('info', 'Starting manager agent - monitoring agent performance');

    while (this.isRunning) {
      try {
        const startTime = Date.now();

        // Perform management action
        await this.performAction();

        // Update performance metrics
        this.updatePerformance({
          actionsTaken: this.performance.actionsTaken + 1,
          lastActionTime: Date.now()
        });

        // Calculate delay to maintain evaluation interval
        const elapsed = Date.now() - startTime;
        const delay = Math.max(0, this.config.evaluationInterval - elapsed);

        if (this.isRunning) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      } catch (error) {
        this.log('error', 'Error during management operation:', error.message);
        this.state = 'error';

        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    }
  }

  /**
   * Perform a management action - evaluate agents and apply survival logic
   * @returns {Promise<void>}
   */
  async performAction() {
    this.state = 'active';

    try {
      // If we don't have an agent manager yet, try to get it
      if (!this.agentManager) {
        this.log('warn', 'Agent manager not set, attempting to get reference');
        // In a real implementation, we might get this from a global context
        // For now, we'll skip evaluation if we don't have the manager
        return;
      }

      // Get all agents from the manager
      const agents = this.agentManager.getAllAgents();

      if (agents.length === 0) {
        this.log('info', 'No agents to manage');
        return;
      }

      this.log('info', `Evaluating ${agents.length} agents for survival`);

      // Evaluate all agents and rank them by performance
      const evaluatedAgents = agents
        .map(agent => ({
          agent,
          score: this.calculatePerformanceScore(agent)
        }))
        .sort((a, b) => b.score - a.score); // Descending order (best first)

      // Apply survival logic
      await this.applySurvivalLogic(evaluatedAgents);

      // Update our own performance
      this.updatePerformance({
        lastEvaluation: Date.now(),
        agentsManaged: agents.length
      });

      this.log('info', `Management cycle complete. Evaluated ${agents.length} agents.`);
    } catch (error) {
      this.log('error', 'Error during management action:', error.message);
      throw error;
    }
  }

  /**
   * Calculate a performance score for an agent
   * @param {Object} agent - The agent to evaluate
   * @returns {number} Performance score (0-100)
   */
  calculatePerformanceScore(agent) {
    // If agent doesn't have performance metrics, return a default score
    if (!agent.performance || !agent.performance.metrics) {
      return 50; // Neutral score for unknown performance
    }

    const metrics = agent.performance.metrics;
    const weights = this.config.evaluationWeight;

    // Normalize metrics to 0-100 scale
    const normalizedEarnings = Math.min(100, (metrics.earningsPerHour || 0) * 2); // $50/hr = 100
    const normalizedOpportunities = Math.min(100, (metrics.opportunitiesPerHour || 0) * 10); // 10/hr = 100
    const normalizedSuccessRate = (metrics.successRate || 0) * 100; // Already 0-1
    const normalizedStability = Math.min(100, (metrics.uptimePercentage || 0)); // Already 0-100

    // Calculate weighted score
    const score = (
      normalizedEarnings * weights.earningsPerHour +
      normalizedOpportunities * weights.opportunitiesPerHour +
      normalizedSuccessRate * weights.successRate +
      normalizedStability * weights.stability
    );

    return Math.max(0, Math.min(100, score)); // Ensure score is between 0-100
  }

  /**
   * Apply survival-of-the-fittest logic to the agent population
   * @param {Array} evaluatedAgents - Array of {agent, score} objects sorted by score descending
   * @returns {Promise<void>}
   */
  async applySurvivalLogic(evaluatedAgents) {
    const totalAgents = evaluatedAgents.length;

    // Calculate how many agents to eliminate and promote
    const eliminateCount = Math.max(1, Math.floor(totalAgents * this.config.survivalThreshold));
    const eliteCount = Math.max(1, Math.floor(totalAgents * this.config.eliteThreshold));

    // Ensure we don't eliminate too many
    const actualEliminateCount = Math.min(eliminateCount, Math.max(0, totalAgents - this.config.minAgents));

    // Identify agents to eliminate (lowest performers)
    const agentsToEliminate = evaluatedAgents
      .slice(-actualEliminateCount) // Take the worst performers
      .map(item => item.agent);

    // Identify elite agents (top performers)
    const eliteAgents = evaluatedAgents
      .slice(0, eliteCount)
      .map(item => item.agent);

    // Eliminate underperforming agents
    for (const agent of agentsToEliminate) {
      this.log('info', `Eliminating underperforming agent: ${agent.id} (${agent.type}) - Score: ${this.calculatePerformanceScore(agent).toFixed(2)}`);

      try {
        await this.agentManager.removeAgent(agent.id);
      } catch (error) {
        this.log('error', `Failed to remove agent ${agent.id}:`, error.message);
      }
    }

    // Boost elite agents (increase their resources, give them priority, etc.)
    for (const agent of eliteAgents) {
      this.log('info', `Boosting elite agent: ${agent.id} (${agent.type}) - Score: ${this.calculatePerformanceScore(agent).toFixed(2)}`);

      try {
        // In a real implementation, we might:
        // - Increase their scan frequency
        // - Give them access to more resources
        // - Assign them higher-value targets
        // For now, we'll just log it
        await this.agentManager.updateAgentConfig(agent.id, {
          priority: 'high',
          boosted: true,
          lastBoosted: Date.now()
        });
      } catch (error) {
        this.log('error', `Failed to boost agent ${agent.id}:`, error.message);
      }
    }

    // If we're below minimum agents, spawn new ones
    const currentAgentCount = this.agentManager.getAllAgents().length;
    if (currentAgentCount < this.config.minAgents) {
      const needed = this.config.minAgents - currentAgentCount;
      this.log('info', `Below minimum agent threshold. Spawning ${needed} new agents.`);

      for (let i = 0; i < needed; i++) {
        try {
          // Randomly choose agent type for diversity
          const agentType = Math.random() > 0.5 ? 'opportunityScout' : 'cryptoHunter';
          await this.agentManager.spawnAgent(agentType, {
            name: `Auto-spawned-${agentType}-${Date.now()}-${Math.floor(Math.random() * 1000)}`
          });
        } catch (error) {
          this.log('error', `Failed to spawn replacement agent:`, error.message);
        }
      }
    }
  }

  /**
   * Cleanup resources when stopping
   * @returns {Promise<void>}
   */
  async cleanup() {
    this.log('info', 'Cleaning up manager agent');
    // Cleanup any resources if needed
  }
}

module.exports = ManagerAgent;
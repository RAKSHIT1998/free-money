// Agent Manager - responsible for spawning, tracking, and managing all agents
const CryptoHunterAgent = require('./cryptoHunterAgent');
const OpportunityScoutAgent = require('./opportunityScoutAgent');
const ManagerAgent = require('./managerAgent');
const DeveloperAgent = require('./developerAgent');
const { Config } = require('../config/config');
const Agent = require('../models/Agent');

// Singleton instance
let instance = null;

class AgentManager {
  constructor(options = {}) {
    if (instance) {
      throw new Error('AgentManager is a singleton. Use getInstance() or initialize()');
    }

    // Load configuration
    const config = new Config(options.config || {});
    this.config = config;

    this.agents = new Map(); // agentId => agent instance
    this.nextId = 1;
    this.options = {
      maxConcurrent: config.get('agentManager.maxConcurrent') || 50,
      spawnDelay: config.get('agentManager.spawnDelay') || 1000,
      cleanupInterval: config.get('agentManager.cleanupInterval') || 60000,
      persistenceEnabled: config.get('agentManager.persistenceEnabled') !== false,
      survivalThreshold: config.get('agentManager.survivalThreshold') || 0.2,
      eliteThreshold: config.get('agentManager.eliteThreshold') || 0.1,
      evaluationInterval: config.get('agentManager.evaluationInterval') || 300000,
      evaluationWeight: config.get('agentManager.evaluationWeight') || {
        earningsPerHour: 0.4,
        opportunitiesPerHour: 0.3,
        successRate: 0.2,
        stability: 0.1
      }
    };

    // Override with direct options if provided
    Object.assign(this.options, options);

    // Track start time for uptime calculation
    this.startTime = Date.now();

    // Load existing agents from database if persistence is enabled
    if (this.options.persistenceEnabled) {
      this.loadAgentsFromDatabase().catch(err => {
        console.warn('Warning: Failed to load agents from database:', err.message);
      });
    }

    // Start cleanup interval
    this.cleanupInterval = setInterval(() => this.cleanup(), this.options.cleanupInterval);

    // Bind methods
    this.spawnAgent = this.spawnAgent = this.spawnAgent.bind(this);
    this.removeAgent = this.removeAgent.bind(this);
    this.spawnAgent.bind(this);
    this.removeAgent = this.removeAgent.bind(this);
    this.getAgent = this.getAgent.bind(this);
    this.getAllAgents = this.getAllAgents.bind(this);
    this.updateAgentConfig = this.updateAgentConfig.bind(this);
    this.saveAgentToDatabase = this.saveAgentToDatabase.bind(this);
    this.loadAgentsFromDatabase = this.loadAgentsFromDatabase.bind(this);

    // Set the instance
    instance = this;
  }

  // Static method to initialize the singleton
  static initialize(options = {}) {
    if (!instance) {
      instance = new AgentManager(options);
    }
    return instance;
  }

  // Static method to get the instance
  static getInstance() {
    if (!instance) {
      throw new Error('AgentManager not initialized. Call initialize() first.');
    }
    return instance;
  }

  /**
   * Spawn a new agent of the specified type
   * @param {string} type - Type of agent to spawn ('cryptoHunter', 'opportunityScout', 'developer', 'manager')
   * @param {Object} options - Options for the agent
   * @returns {Promise<Object>} The created agent
   */
  async spawnAgent(type, options = {}) {
    // Check if we're at capacity
    if (this.agents.size >= this.options.maxConcurrent) {
      throw new Error(`Maximum agent limit reached (${this.options.maxConcurrent})`);
    }

    let agent;

    // Create the appropriate agent type
    switch (type.toLowerCase()) {
      case 'cryptohunter':
      case 'crypto hunter':
      case 'cryptohunteragent':
        agent = new CryptoHunterAgent({
          id: this.nextId++,
          config: {
            ...this.config.get('agentTypes.cryptoHunter') || {},
            ...options.config
          },
          ...options
        });
        break;

      case 'opportunityscout':
      case 'opportunity scout':
      case 'opportunity scout agent':
        agent = new OpportunityScoutAgent({
          id: this.nextId++,
          config: {
            ...this.config.get('agentTypes.opportunityScout') || {},
            ...options.config
          },
          ...options
        });
        break;

      case 'developer':
      case 'developer agent':
        agent = new DeveloperAgent({
          id: this.nextId++,
          config: {
            ...this.config.get('agentTypes.developer') || {},
            ...options.config
          },
          ...options
        });
        break;

      case 'manager':
      case 'manager agent':
        agent = new ManagerAgent({
          id: this.nextId++,
          config: {
            ...this.config.get('agentTypes.manager') || {},
            ...options.config
          },
          ...options
        });
        // Set the agent manager reference for manager agents
        agent.setAgentManager(this);
        break;

      default:
        throw new Error(`Unknown agent type: ${type}`);
    }

    // Add to our tracking map
    this.agents.set(agent.id, agent);

    // Start the agent
    try {
      await agent.start();
      console.log(`Spawned ${type} agent with ID ${agent.id}`);

      // Save to database if persistence is enabled
      if (this.options.persistenceEnabled) {
        await this.saveAgentToDatabase(agent).catch(err => {
          console.warn(`Warning: Failed to save agent ${agent.id} to database:`, err.message);
          // Continue even if saving fails
        });
      }

      return agent;
    } catch (error) {
      // If starting fails, clean up
      this.agents.delete(agent.id);
      throw error;
    }
  }

  /**
   * Remove an agent by ID
   * @param {string|number} id - ID of the agent to remove
   * @returns {Promise<boolean>} True if removed, false if not found
   */
  async removeAgent(id) {
    const agentId = Number(id);
    const agent = this.agents.get(agentId);

    if (!agent) {
      return false;
    }

    try {
      // Stop the agent first
      await agent.stop();

      // Remove from our tracking map
      this.agents.delete(agentId);

      // Remove from database if persistence is enabled
      if (this.options.persistenceEnabled) {
        await this.removeAgentFromDatabase(agentId).catch(err => {
          console.warn(`Warning: Failed to remove agent ${agentId} from database:`, err.message);
          // Continue even if removal from DB fails
        });
      }

      console.log(`Removed agent with ID ${agentId}`);
      return true;
    } catch (error) {
      console.error(`Error removing agent ${agentId}:`, error.message);
      throw error;
    }
  }

  /**
   * Get an agent by ID
   * @param {string|number} id - ID of the agent to retrieve
   * @returns {Object|null} The agent or null if not found
   */
  getAgent(id) {
    return this.agents.get(Number(id)) || null;
  }

  /**
   * Get all agents
   * @returns {Array} Array of all agent instances
   */
  getAllAgents() {
    return Array.from(this.agents.values());
  }

  /**
   * Get agents by type
   * @param {string} type - Type of agents to retrieve
   * @returns {Array} Array of agent instances of the specified type
   */
  getAgentsByType(type) {
    return this.getAllAgents().filter(agent => agent.type === type);
  }

  /**
   * Update configuration for a specific agent
   * @param {string|number} id - ID of the agent to update
   * @param {Object} config - Configuration updates
   * @returns {Promise<boolean>} True if updated, false if not found
   */
  async updateAgentConfig(id, config) {
    const agent = this.getAgent(id);
    if (!agent) {
      return false;
    }

    try {
      // Update the agent's configuration
      if (agent.updateConfig) {
        await agent.updateConfig(config);
      } else {
        // Fallback: just merge config if no specific method
        agent.config = { ...agent.config, ...config };
      }

      // Update in database if persistence is enabled
      if (this.options.persistenceEnabled) {
        await this.saveAgentToDatabase(agent).catch(err => {
          console.warn(`Warning: Failed to update agent ${id} in database:`, err.message);
          // Continue even if update fails
        });
      }

      return true;
    } catch (error) {
      console.error(`Error updating config for agent ${id}:`, error.message);
      throw error;
    }
  }

  /**
   * Get statistics about all agents
   * @returns {Object} Statistics about the agent population
   */
  getStatistics() {
    const agents = this.getAllAgents();

    if (agents.length === 0) {
      return {
        total: 0,
        byType: {},
        averagePerformance: null
      };
    }

    // Count by type
    const byType = {};
    agents.forEach(agent => {
      byType[agent.type] = (byType[agent.type] || 0) + 1;
    });

    // Calculate average performance (if available)
    const agentsWithPerformance = agents.filter(agent =>
      agent.performance && agent.performance.actionsTaken !== undefined
    );

    let averagePerformance = null;
    if (agentsWithPerformance.length > 0) {
      const metrics = ['earnings', 'opportunitiesFound', 'actionsTaken', 'successRate'];
      const averages = {};

      metrics.forEach(metric => {
        const values = agentsWithPerformance
          .map(agent => agent.performance[metric] || 0)
          .filter(val => typeof val === 'number' && !isNaN(val));

        if (values.length > 0) {
          const sum = values.reduce((a, b) => a + b, 0);
          averages[metric] = sum / values.length;
        } else {
          averages[metric] = 0;
        }
      });

      averagePerformance = averages;
    }

    return {
      total: agents.length,
      byType,
      averagePerformance,
      uptime: Date.now() - this.startTime
    };
  }

  /**
   * Save agent to database
   * @private
   * @param {Object} agent - Agent instance to save
   * @returns {Promise<void>}
   */
  async saveAgentToDatabase(agent) {
    if (!this.options.persistenceEnabled) return;

    try {
      // Prepare agent data for storage
      const agentData = {
        agentId: agent.id,
        type: agent.type,
        name: agent.config.name || `Agent-${agent.id}`,
        config: agent.config,
        state: agent.state,
        isRunning: agent.isRunning,
        performance: agent.performance,
        createdAt: agent.createdAt,
        lastActive: agent.lastActive,
        lastSeen: new Date()
      };

      // Upsert the agent (update if exists, insert if not)
      await Agent.findOneAndUpdate(
        { agentId: agent.id },
        agentData,
        { upsert: true, new: true }
      );
    } catch (error) {
      console.error(`Error saving agent ${agent.id} to database:`, error);
      throw error;
    }
  }

  /**
   * Remove agent from database
   * @private
   * @param {string|number} id - Agent ID to remove
   * @returns {Promise<void>}
   */
  async removeAgentFromDatabase(id) {
    if (!this.options.persistenceEnabled) return;

    try {
      await Agent.deleteOne({ agentId: Number(id) });
    } catch (error) {
      console.error(`Error removing agent ${id} from database:`, error);
      throw error;
    }
  }

  /**
   * Load agents from database
   * @private
   * @returns {Promise<void>}
   */
  async loadAgentsFromDatabase() {
    if (!this.options.persistenceEnabled) return;

    try {
      const dbAgents = await Agent.find({});

      for (const dbAgent of dbAgents) {
        // Skip if we already have this agent in memory (shouldn't happen, but safe)
        if (this.agents.has(dbAgent.agentId)) {
          continue;
        }

        // Recreate agent instance based on type
        let agent;
        switch (dbAgent.type) {
          case 'cryptoHunter':
            agent = new CryptoHunterAgent({
              id: dbAgent.agentId,
              name: dbAgent.name,
              config: dbAgent.config
            });
            break;

          case 'opportunityScout':
            agent = new OpportunityScoutAgent({
              id: dbAgent.agentId,
              name: dbAgent.name,
              config: dbAgent.config
            });
            break;

          case 'developer':
            agent = new DeveloperAgent({
              id: dbAgent.agentId,
              name: dbAgent.name,
              config: dbAgent.config
            });
            break;

          case 'manager':
            agent = new ManagerAgent({
              id: dbAgent.agentId,
              name: dbAgent.name,
              config: dbAgent.config
            });
            // Set the agent manager reference for manager agents
            agent.setAgentManager(this);
            break;

          default:
            console.warn(`Unknown agent type ${dbAgent.type} found in database, skipping`);
            continue;
        }

        // Restore agent state
        agent.state = dbAgent.state;
        agent.isRunning = dbAgent.isRunning;
        agent.createdAt = dbAgent.createdAt || new Date();
        agent.lastActive = dbAgent.lastActive || new Date();
        agent.performance = dbAgent.performance || {
          earnings: 0,
          opportunitiesFound: 0,
          actionsTaken: 0,
          successRate: 0,
          lastUpdated: new Date()
        };

        // Add to our tracking map
        this.agents.set(agent.id, agent);

        // Start the agent if it was running
        if (agent.isRunning) {
          await agent.start().catch(err => {
            console.warn(`Warning: Failed to restart agent ${agent.id} from database:`, err.message);
          });
        }

        this.nextId = Math.max(this.nextId, dbAgent.agentId + 1);
      }

      console.log(`Loaded ${dbAgents.length} agents from database`);
    } catch (error) {
      console.error('Error loading agents from database:', error);
      throw error;
    }
  }

  /**
   * Clean up any finished or errored agents
   * @returns {Promise<void>}
   */
  async cleanup() {
    const toRemove = [];

    // Check each agent for cleanup conditions
    for (const [id, agent] of this.agents.entries()) {
      // Remove agents that have finished their work and aren't meant to run continuously
      // Or agents that have been in error state for too long
      if (agent.state === 'finished' ||
          (agent.state === 'error' && agent.stateChangedAt && (Date.now() - agent.stateChangedAt) > 300000)) { // 5 minutes
        toRemove.push(id);
      }
    }

    // Remove the flagged agents
    for (const id of toRemove) {
      await this.removeAgent(id);
    }
  }

  /**
   * Shutdown all agents and clean up resources
   * @returns {Promise<void>}
   */
  async shutdown() {
    console.log('Shutting down agent manager...');

    // Stop the cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Stop all agents and save their final state
    const stopPromises = Array.from(this.agents.values()).map(async (agent) => {
      try {
        await agent.stop();
        // Save final state to database if persistence is enabled
        if (this.options.persistenceEnabled) {
          await this.saveAgentToDatabase(agent).catch(err => {
            console.warn(`Warning: Failed to save final state for agent ${agent.id}:`, err.message);
          });
        }
      } catch (error) {
        console.error(`Error stopping agent ${agent.id}:`, error.message);
      }
    });

    await Promise.allSettled(stopPromises);

    // Clear the agents map
    this.agents.clear();

    console.log('Agent manager shutdown complete');
  }
}

module.exports = AgentManager;
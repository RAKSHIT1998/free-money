// Base agent class for the multi-agent money-making system
class BaseAgent {
  /**
   * @param {Object} options - Configuration options for the agent
   * @param {string} options.id - Unique identifier for the agent
   * @param {string} options.type - Type of agent (cryptoHunter, opportunityScout, developer, manager)
   * @param {Object} options.config - Configuration specific to the agent type
   */
  constructor(options = {}) {
    this.id = options.id || this.generateId();
    this.type = options.type || 'base';
    this.config = options.config || {};
    this.createdAt = new Date();
    this.lastActive = new Date();
    this.performance = {
      earnings: 0,
      opportunitiesFound: 0,
      actionsTaken: 0,
      successRate: 0,
      lastUpdated: new Date()
    };
    this.state = 'idle'; // idle, active, resting, error
    this.isRunning = false;

    // Bind methods to ensure proper 'this' context
    this.start = this.start.bind(this);
    this.stop = this.stop.bind(this);
    this.performAction = this.performAction.bind(this);
    this.updatePerformance = this.updatePerformance.bind(this);
    this.getStatus = this.getStatus.bind(this);
  }

  /**
   * Generate a unique ID for the agent
   * @returns {string} Unique identifier
   */
  generateId() {
    return `${this.type}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  }

  /**
   * Start the agent's operation
   * @returns {Promise<void>}
   */
  async start() {
    if (this.isRunning) {
      console.warn(`Agent ${this.id} is already running`);
      return;
    }

    this.isRunning = true;
    this.state = 'active';
    this.lastActive = new Date();

    console.log(`Agent ${this.id} (${this.type}) started`);

    // Run the agent's main loop, but catch any errors and set state to error
    this.run().catch(error => {
      this.state = 'error';
      this.isRunning = false;
      console.error(`Agent ${this.id} encountered an error:`, error);
    });
  }

  /**
   * Stop the agent's operation
   * @returns {Promise<void>}
   */
  async stop() {
    if (!this.isRunning) {
      console.warn(`Agent ${this.id} is not running`);
      return;
    }

    this.isRunning = false;
    this.state = 'idle';
    this.lastActive = new Date();

    console.log(`Agent ${this.id} (${this.type}) stopped`);

    // Subclasses should override this method if they need cleanup
    await this.cleanup();
  }

  /**
   * Main logic loop for the agent - to be implemented by subclasses
   * @returns {Promise<void>}
   */
  async run() {
    throw new Error('Method "run()" must be implemented by subclass');
  }

  /**
   * Perform a single action - to be implemented by subclasses
   * @returns {Promise<Object>} Result of the action
   */
  async performAction() {
    throw new Error('Method "performAction()" must be implemented by subclass');
  }

  /**
   * Cleanup resources when stopping - to be implemented by subclasses if needed
   * @returns {Promise<void>}
   */
  async cleanup() {
    // Default implementation does nothing
  }

  /**
   * Update performance metrics
   * @param {Object} metrics - Metrics to update
   */
  updatePerformance(metrics) {
    this.performance = {
      ...this.performance,
      ...metrics,
      lastUpdated: new Date()
    };

    // Calculate success rate if we have enough data
    if (this.performance.actionsTaken > 0) {
      this.performance.successRate =
        (this.performance.opportunitiesFound / this.performance.actionsTaken) * 100;
    }
  }

  /**
   * Get current status of the agent
   * @returns {Object} Status information
   */
  getStatus() {
    return {
      id: this.id,
      type: this.type,
      state: this.state,
      isRunning: this.isRunning,
      createdAt: this.createdAt,
      lastActive: this.lastActive,
      performance: { ...this.performance }
    };
  }

  /**
   * Log a message with agent prefix
   * @param {string} level - Log level (info, warn, error, debug)
   * @param {string} message - Message to log
   * @param {...any} args - Additional arguments
   */
  log(level, message, ...args) {
    const timestamp = new Date().toISOString();
    console[level](`[${this.id}] [${timestamp}] ${message}`, ...args);
  }
}

// Export for use in other modules
module.exports = BaseAgent;
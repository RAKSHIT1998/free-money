// Configuration for the Multi-Agent Money-Making System
// This file defines default settings that can be overridden via environment variables or custom config

module.exports = {
  // Environment detection
  env: process.env.NODE_ENV || 'development',

  // Server configuration
  server: {
    port: process.env.PORT || 5000,
    host: process.env.HOST || '0.0.0.0'
  },

  // Database configuration
  database: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/money-maker',
    options: {
      useNewUrlParser: true,
      useUnifiedTopology: true
    }
  },

  // Agent Manager Settings
  agentManager: {
    maxConcurrent: parseInt(process.env.MAX_CONCURRENT) || 50,
    spawnDelay: parseInt(process.env.SPAWN_DELAY) || 1000,
    cleanupInterval: parseInt(process.env.CLEANUP_INTERVAL) || 60000,
    persistenceEnabled: process.env.PERSISTENCE_ENABLED !== 'false',

    // Survival Algorithm Settings
    survivalThreshold: parseFloat(process.env.SURVIVAL_THRESHOLD) || 0.2,
    eliteThreshold: parseFloat(process.env.ELITE_THRESHOLD) || 0.1,
    evaluationInterval: parseInt(process.env.EVALUATION_INTERVAL) || 300000,

    // Performance Weights (must sum to 1.0)
    evaluationWeight: {
      earningsPerHour: parseFloat(process.env.WEIGHT_EARNINGS) || 0.4,
      opportunitiesPerHour: parseFloat(process.env.WEIGHT_OPPORTUNITIES) || 0.3,
      successRate: parseFloat(process.env.WEIGHT_SUCCESS_RATE) || 0.2,
      stability: parseFloat(process.env.WEIGHT_STABILITY) || 0.1
    }
  },

  // Agent Type Defaults
  agentTypes: {
    cryptoHunter: {
      scanInterval: parseInt(process.env.CRYPTO_HUNTER_SCAN_INTERVAL) || 30000,
      maxResultsPerScan: parseInt(process.env.CRYPTO_HUNTER_MAX_RESULTS) || 10,
      minRewardThreshold: parseFloat(process.env.CRYPTO_HUNTER_MIN_REWARD) || 10,
      useLLM: process.env.USE_LLM === "true",
      llmModel: process.env.LLM_MODEL || "local-default",
      llmEndpoint: process.env.LLM_ENDPOINT || "http://localhost:11434"
    },
    opportunityScout: {
      scanInterval: parseInt(process.env.OPPORTUNITY_SCOUT_SCAN_INTERVAL) || 45000,
      maxResultsPerScan: parseInt(process.env.OPPORTUNITY_SCOUT_MAX_RESULTS) || 15,
      minRewardThreshold: parseFloat(process.env.OPPORTUNITY_SCOUT_MIN_REWARD) || 5,
      useLLM: process.env.USE_LLM === "true",
      llmModel: process.env.LLM_MODEL || "local-default",
      llmEndpoint: process.env.LLM_ENDPOINT || "http://localhost:11434"
    },
    developer: {
      taskInterval: parseInt(process.env.DEVELOPER_TASK_INTERVAL) || 60000,
      maxTasksPerCycle: parseInt(process.env.DEVELOPER_MAX_TASKS) || 3
    },
    manager: {
      evaluationInterval: parseInt(process.env.MANAGER_EVAL_INTERVAL) || 300000
    }
  },

  // Opportunity Service Settings
  opportunityService: {
    // API keys would go here if integrating with real services
    // For simulation, these control the randomness
    opportunityFrequency: parseFloat(process.env.OPPORTUNITY_FREQUENCY) || 0.3,
    maxValuePerOpportunity: parseFloat(process.env.MAX_OPPORTUNITY_VALUE) || 1000
  },

  // System Limits
  limits: {
    maxEarningsPerAgentPerHour: parseFloat(process.env.MAX_EARNINGS_PER_HOUR) || 10000,
    maxOpportunitiesPerAgentPerHour: parseInt(process.env.MAX_OPPORTUNITIES_PER_HOUR) || 100,
    minAgentLifetime: parseInt(process.env.MIN_AGENT_LIFETIME) || 60000
  },

  // Logging configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    timestampFormat: 'ISO'
  }
};

// Configuration utility class
class Config {
  constructor(customConfig = {}) {
    this.defaultConfig = require('./default');
    this.customConfig = customConfig;
    this.mergedConfig = this.deepMerge(this.defaultConfig, this.customConfig);
  }

  deepMerge(target, source) {
    const output = Object.assign({}, target);

    if (isObject(target) && isObject(source)) {
      Object.keys(source).forEach(key => {
        if (isObject(source[key])) {
          if (!(key in target)) {
            Object.assign(output, { [key]: source[key] });
          } else {
            output[key] = this.deepMerge(target[key], source[key]);
          }
        } else {
          Object.assign(output, { [key]: source[key] });
        }
      });
    }

    return output;
  }

  get(path, defaultValue) {
    const parts = path.split('.');
    let current = this.mergedConfig;

    for (const part of parts) {
      if (current == null || !(part in current)) {
        return defaultValue;
      }
      current = current[part];
    }

    return current === undefined ? defaultValue : current;
  }

  set(path, value) {
    const parts = path.split('.');
    let current = this.mergedConfig;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!(part in current)) {
        current[part] = {};
      }
      current = current[part];
    }

    current[parts[parts.length - 1]] = value;
  }

  toObject() {
    return JSON.parse(JSON.stringify(this.mergedConfig));
  }
}

function isObject(item) {
  return item && typeof item === 'object' && !Array.isArray(item);
}

module.exports.Config = Config;
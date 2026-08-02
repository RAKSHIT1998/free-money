// Configuration for the Multi-Agent Money-Making System
// This file defines default settings that can be overridden via environment variables or custom config

// Real Binance API keys/secrets are 64-char alphanumeric HMAC keys. Placeholder values
// (the defaults shipped in .env.example, or anything left unset) must never be mistaken
// for real credentials, since that decides whether live-money code paths are reachable.
function isLikelyRealBinanceKey(value) {
  if (!value || typeof value !== 'string') return false;
  if (/your_|_here|placeholder|change_in_production|example/i.test(value)) return false;
  return /^[A-Za-z0-9]{60,70}$/.test(value.trim());
}

// Configuration utility class
class Config {
  constructor(customConfig = {}) {
    // The default configuration is defined inline here
    this.defaultConfig = {
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

      // JWT Configuration
      jwtSecret: process.env.JWT_SECRET || 'your-secret-key-change-in-production',

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
          llmEndpoint: process.env.LLM_ENDPOINT || "http://localhost:11434",
          // Cryptocurrency earning options
          earnInCrypto: process.env.CRYPTO_HUNTER_EARN_IN_CRYPTO === "true",
          cryptoCurrency: process.env.CRYPTO_HUNTER_CRYPTO_CURRENCY || "BNB"
        },
        opportunityScout: {
          scanInterval: parseInt(process.env.OPPORTUNITY_SCOUT_SCAN_INTERVAL) || 45000,
          maxResultsPerScan: parseInt(process.env.OPPORTUNITY_SCOUT_MAX_RESULTS) || 15,
          minRewardThreshold: parseFloat(process.env.OPPORTUNITY_SCOUT_MIN_REWARD) || 5,
          useLLM: process.env.USE_LLM === "true",
          llmModel: process.env.LLM_MODEL || "local-default",
          llmEndpoint: process.env.LLM_ENDPOINT || "http://localhost:11434",
          // Cryptocurrency earning options
          earnInCrypto: process.env.OPPORTUNITY_SCOUT_EARN_IN_CRYPTO === "true",
          cryptoCurrency: process.env.OPPORTUNITY_SCOUT_CRYPTO_CURRENCY || "BNB"
        },
        developer: {
          taskInterval: parseInt(process.env.DEVELOPER_TASK_INTERVAL) || 60000,
          maxTasksPerCycle: parseInt(process.env.DEVELOPER_MAX_TASKS) || 3,
          // Cryptocurrency earning options
          earnInCrypto: process.env.DEVELOPER_EARN_IN_CRYPTO === "true",
          cryptoCurrency: process.env.DEVELOPER_CRYPTO_CURRENCY || "BNB"
        },
        manager: {
          evaluationInterval: parseInt(process.env.MANAGER_EVAL_INTERVAL) || 300000
        },
        // Real Binance spot-market DCA agent. Only places orders when
        // liveTrading.confirmed is true AND real (non-placeholder) API credentials
        // are configured; otherwise realTradingService blocks order placement.
        binanceDca: {
          symbol: process.env.BINANCE_DCA_SYMBOL || 'BTCUSDT',
          dailyBuyUsd: parseFloat(process.env.BINANCE_DCA_DAILY_USD) || 5,
          budgetCapUsd: parseFloat(process.env.BINANCE_DCA_BUDGET_CAP_USD) || 50,
          checkIntervalMs: parseInt(process.env.BINANCE_DCA_CHECK_INTERVAL_MS) || 3600000
        },
        // Real, LEVERAGED Binance USDT-M futures DCA agent. Only places orders when
        // LIVE_TRADING_CONFIRMED=true AND LIVE_FUTURES_TRADING_CONFIRMED=true AND real
        // (non-placeholder) API credentials are configured; otherwise
        // realFuturesTradingService blocks order placement. budgetCapUsd is measured in
        // margin committed, not notional (leveraged) exposure.
        binanceFuturesDca: {
          symbol: process.env.BINANCE_FUTURES_DCA_SYMBOL || 'BTCUSDT',
          dailyMarginUsd: parseFloat(process.env.BINANCE_FUTURES_DCA_DAILY_MARGIN_USD) || 5,
          budgetCapUsd: parseFloat(process.env.BINANCE_FUTURES_DCA_BUDGET_CAP_USD) || 50,
          leverage: parseInt(process.env.BINANCE_FUTURES_DCA_LEVERAGE) || 50,
          marginMode: process.env.BINANCE_FUTURES_DCA_MARGIN_MODE || 'ISOLATED',
          stopLossPct: parseFloat(process.env.BINANCE_FUTURES_DCA_STOP_LOSS_PCT) || 0.01,
          takeProfitPct: parseFloat(process.env.BINANCE_FUTURES_DCA_TAKE_PROFIT_PCT) || 0.03,
          checkIntervalMs: parseInt(process.env.BINANCE_FUTURES_DCA_CHECK_INTERVAL_MS) || 3600000
        },
        // Real, LEVERAGED breakout scanner across all USDT-margined futures perpetuals.
        // Same dual live-trading gates as binanceFuturesDca (enforced in
        // realFuturesTradingService, not here). budgetCapUsd is a SHARED cap across every
        // symbol this agent ever trades, not per-symbol.
        breakoutFutures: {
          sizingMode: process.env.BREAKOUT_FUTURES_SIZING_MODE || 'percentOfBalance',
          riskPct: parseFloat(process.env.BREAKOUT_FUTURES_RISK_PCT) || 0.2,
          perTradeMarginUsd: parseFloat(process.env.BREAKOUT_FUTURES_PER_TRADE_MARGIN_USD) || 5,
          budgetCapUsd: parseFloat(process.env.BREAKOUT_FUTURES_BUDGET_CAP_USD) || 50,
          leverage: parseInt(process.env.BREAKOUT_FUTURES_LEVERAGE) || 50,
          marginMode: process.env.BREAKOUT_FUTURES_MARGIN_MODE || 'ISOLATED',
          stopLossPct: parseFloat(process.env.BREAKOUT_FUTURES_STOP_LOSS_PCT) || 0.01,
          takeProfitPct: parseFloat(process.env.BREAKOUT_FUTURES_TAKE_PROFIT_PCT) || 0.03,
          nearHighThresholdPct: parseFloat(process.env.BREAKOUT_FUTURES_NEAR_HIGH_PCT) || 0.001,
          momentumThresholdPct: parseFloat(process.env.BREAKOUT_FUTURES_MOMENTUM_PCT) || 5,
          minQuoteVolumeUsd: parseFloat(process.env.BREAKOUT_FUTURES_MIN_VOLUME_USD) || 5000000,
          maxCandidatesPerCycle: parseInt(process.env.BREAKOUT_FUTURES_MAX_CANDIDATES_PER_CYCLE) || 3,
          scanIntervalMs: parseInt(process.env.BREAKOUT_FUTURES_SCAN_INTERVAL_MS) || 300000
        },
        // Real, LEVERAGED mean-reversion (RSI oversold) scanner — distinct signal from
        // breakoutFutures (momentum). Same dual live-trading gates plus the shared
        // global cross-agent cap, enforced in realFuturesTradingService.
        meanReversionFutures: {
          perTradeMarginUsd: parseFloat(process.env.MEAN_REVERSION_FUTURES_PER_TRADE_MARGIN_USD) || 5,
          budgetCapUsd: parseFloat(process.env.MEAN_REVERSION_FUTURES_BUDGET_CAP_USD) || 50,
          leverage: parseInt(process.env.MEAN_REVERSION_FUTURES_LEVERAGE) || 50,
          marginMode: process.env.MEAN_REVERSION_FUTURES_MARGIN_MODE || 'ISOLATED',
          stopLossPct: parseFloat(process.env.MEAN_REVERSION_FUTURES_STOP_LOSS_PCT) || 0.01,
          takeProfitPct: parseFloat(process.env.MEAN_REVERSION_FUTURES_TAKE_PROFIT_PCT) || 0.03,
          rsiPeriod: parseInt(process.env.MEAN_REVERSION_FUTURES_RSI_PERIOD) || 14,
          rsiInterval: process.env.MEAN_REVERSION_FUTURES_RSI_INTERVAL || '1h',
          rsiOversoldThreshold: parseFloat(process.env.MEAN_REVERSION_FUTURES_RSI_OVERSOLD) || 30,
          minQuoteVolumeUsd: parseFloat(process.env.MEAN_REVERSION_FUTURES_MIN_VOLUME_USD) || 5000000,
          watchlistSize: parseInt(process.env.MEAN_REVERSION_FUTURES_WATCHLIST_SIZE) || 30,
          maxCandidatesPerCycle: parseInt(process.env.MEAN_REVERSION_FUTURES_MAX_CANDIDATES_PER_CYCLE) || 2,
          scanIntervalMs: parseInt(process.env.MEAN_REVERSION_FUTURES_SCAN_INTERVAL_MS) || 900000
        },
        // Read-only real HackerOne public-program feed. No auth, no order/report
        // submission — surfaces real opportunities for the user to act on manually.
        hackerOneBounty: {
          pollIntervalMs: parseInt(process.env.HACKERONE_POLL_INTERVAL_MS) || 3600000,
          maxResultsPerPoll: parseInt(process.env.HACKERONE_MAX_RESULTS) || 20
        },
        // Read-only real Remote OK crypto/web3 job feed. No auth, no application
        // submission — surfaces real opportunities for the user to act on manually.
        cryptoGigHunter: {
          pollIntervalMs: parseInt(process.env.CRYPTO_GIG_HUNTER_POLL_INTERVAL_MS) || 3600000,
          maxResultsPerPoll: parseInt(process.env.CRYPTO_GIG_HUNTER_MAX_RESULTS) || 20
        },
        // Health monitor: restarts (in place, same agent ID) any agent stuck in
        // 'error' state for errorCyclesBeforeRestart consecutive checks. Never
        // touches real trading agents' budget-cap tracking since the ID is preserved.
        realAgentMonitor: {
          checkIntervalMs: parseInt(process.env.REAL_AGENT_MONITOR_CHECK_INTERVAL_MS) || 120000,
          errorCyclesBeforeRestart: parseInt(process.env.REAL_AGENT_MONITOR_ERROR_CYCLES) || 2
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
        maxEarningsPerAgentPerHour: parseFloat(process.env.MAX_EARNINGS_PER_AGENT_PER_HOUR) || 10000,
        maxOpportunitiesPerAgentPerHour: parseInt(process.env.MAX_OPPORTUNITIES_PER_AGENT_PER_HOUR) || 100,
        minAgentLifetime: parseInt(process.env.MIN_AGENT_LIFETIME) || 60000
      },

      // Logging configuration
      logging: {
        level: process.env.LOG_LEVEL || 'info',
        timestampFormat: 'ISO'
      },

      // Cryptocurrency Configuration
      cryptocurrency: {
        // Enable/disable cryptocurrency features
        enabled: process.env.CRYPTO_ENABLED === 'true',

        // Default cryptocurrency for payments (BTC, ETH, BNB, etc.)
        defaultCurrency: process.env.DEFAULT_CRYPTO_CURRENCY || 'BNB',

        // Wallet configuration
        wallets: {
          // Binance wallet
          binance: {
            apiKey: process.env.BINANCE_API_KEY || '',
            apiSecret: process.env.BINANCE_API_SECRET || '',
            enabled: process.env.BINANCE_ENABLED === 'true'
          }
        },

        // Transaction settings
        transaction: {
          // Minimum amount to send (in USD equivalent)
          minSendAmount: parseFloat(process.env.CRYPTO_MIN_SEND_AMOUNT) || 10,

          // Fee handling
          feeMode: process.env.CRYPTO_FEE_MODE || 'network', // 'network' or 'deduct_from_amount'

          // Confirmation requirements
          requiredConfirmations: parseInt(process.env.CRYPTO_REQUIRED_CONFIRMATIONS) || 1
        },

        // Simulation mode: we simulate UNLESS all three are true:
        //   1. CRYPTO_SIMULATION_MODE is not explicitly 'true' (a human hasn't forced simulation)
        //   2. Both BINANCE_API_KEY and BINANCE_API_SECRET look like real (non-placeholder) credentials
        //   3. LIVE_TRADING_CONFIRMED=true — an explicit human opt-in separate from just having keys set
        // This prevents placeholder .env values (which are non-empty strings) from ever being
        // mistaken for real credentials and unlocking live withdrawal/order code paths.
        simulation: {
          enabled: (() => {
            if (process.env.CRYPTO_SIMULATION_MODE === 'true') return true;
            const credentialsLookReal =
              isLikelyRealBinanceKey(process.env.BINANCE_API_KEY) &&
              isLikelyRealBinanceKey(process.env.BINANCE_API_SECRET);
            const liveConfirmed = process.env.LIVE_TRADING_CONFIRMED === 'true';
            return !(credentialsLookReal && liveConfirmed);
          })(),
          delayMs: parseInt(process.env.CRYPTO_SIMULATION_DELAY_MS) || 2000, // Simulate network delay
          successRate: parseFloat(process.env.CRYPTO_SIMULATION_SUCCESS_RATE) || 0.95 // 95% success rate in simulation
        }
      },

      // Real-money trading agents (DCA) are gated by this in addition to the crypto
      // simulation flag above — see realTradingService.js / binanceDcaAgent.js.
      liveTrading: {
        confirmed: process.env.LIVE_TRADING_CONFIRMED === 'true',
        // Shared cap across EVERY real futures agent/strategy combined, checked in
        // addition to each agent's own per-agent budgetCapUsd. Running more strategies
        // simultaneously must not silently multiply real exposure past this ceiling.
        globalFuturesBudgetCapUsd: parseFloat(process.env.GLOBAL_FUTURES_BUDGET_CAP_USD) || 50
      },

      // Payment Configuration
      payment: {
        // Enable/disable payment features
        enabled: process.env.PAYPAL_ENABLED === 'true',

        // PayPal configuration
        paypal: {
          clientId: process.env.PAYPAL_CLIENT_ID || '',
          clientSecret: process.env.PAYPAL_CLIENT_SECRET || '',
          mode: process.env.PAYPAL_MODE || 'sandbox', // 'sandbox' or 'live'
          enabled: process.env.PAYPAL_ENABLED === 'true'
        }
      }
    };

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
module.exports.isLikelyRealBinanceKey = isLikelyRealBinanceKey;
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

      // JWT Configuration. No placeholder fallback — a guessable default here would let
      // anyone forge a valid admin token against every /api/agents/* real-money route.
      // Must be set via JWT_SECRET in the environment; auth.js/authController.js both
      // refuse to operate (503, not a silent bypass) if this comes back undefined.
      jwtSecret: process.env.JWT_SECRET,

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
        // Real Binance spot-market DCA agent. Only places orders when
        // liveTrading.confirmed is true AND real (non-placeholder) API credentials
        // are configured; otherwise realTradingService blocks order placement.
        binanceDca: {
          symbol: process.env.BINANCE_DCA_SYMBOL || 'BTCUSDT',
          dailyBuyUsd: parseFloat(process.env.BINANCE_DCA_DAILY_USD) || 5,
          budgetCapUsd: parseFloat(process.env.BINANCE_DCA_BUDGET_CAP_USD) || Infinity,
          checkIntervalMs: parseInt(process.env.BINANCE_DCA_CHECK_INTERVAL_MS) || 3600000
        },
        // Real Binance Simple Earn (flexible) sweeper. No leverage, no directional
        // market exposure — subscribes idle spot balance above reserveUsd into the
        // highest-APY flexible product, redeemable back to spot at any time. Only
        // subscribes when LIVE_TRADING_CONFIRMED=true and real credentials are set.
        binanceEarn: {
          asset: process.env.BINANCE_EARN_ASSET || 'USDT',
          reserveUsd: parseFloat(process.env.BINANCE_EARN_RESERVE_USD) || 20,
          minSubscribeUsd: parseFloat(process.env.BINANCE_EARN_MIN_SUBSCRIBE_USD) || 5,
          checkIntervalMs: parseInt(process.env.BINANCE_EARN_CHECK_INTERVAL_MS) || 21600000
        },
        // Real, market-neutral funding-rate arbitrage (long spot + short perp of the
        // same notional). Only places orders when LIVE_TRADING_CONFIRMED=true AND
        // LIVE_FUTURES_TRADING_CONFIRMED=true and real credentials are set.
        fundingRateArbitrage: {
          perTradeNotionalUsd: parseFloat(process.env.FUNDING_ARB_PER_TRADE_NOTIONAL_USD) || 20,
          futuresLeverage: parseInt(process.env.FUNDING_ARB_FUTURES_LEVERAGE) || 3,
          marginMode: process.env.FUNDING_ARB_MARGIN_MODE || 'ISOLATED',
          minFundingRateToEnter: parseFloat(process.env.FUNDING_ARB_MIN_RATE_ENTER) || 0.0003,
          minFundingRateToExit: parseFloat(process.env.FUNDING_ARB_MIN_RATE_EXIT) || 0.0001,
          minQuoteVolumeUsd: parseFloat(process.env.FUNDING_ARB_MIN_VOLUME_USD) || 5000000,
          maxCandidatesPerCycle: parseInt(process.env.FUNDING_ARB_MAX_CANDIDATES_PER_CYCLE) || Infinity,
          scanIntervalMs: parseInt(process.env.FUNDING_ARB_SCAN_INTERVAL_MS) || 1800000
        },
        // Real spot (no leverage) grid trading — profits from range-bound sideways
        // price action, not directional moves. Only places orders when
        // LIVE_TRADING_CONFIRMED=true and real credentials are set. lowerPrice/
        // upperPrice are left unset (null) by default so the agent auto-computes them
        // from recent history on first run; set explicitly to override.
        gridTrading: {
          symbol: process.env.GRID_TRADING_SYMBOL || 'BTCUSDT',
          gridLevels: parseInt(process.env.GRID_TRADING_LEVELS) || 10,
          perLevelUsd: parseFloat(process.env.GRID_TRADING_PER_LEVEL_USD) || 5,
          lowerPrice: process.env.GRID_TRADING_LOWER_PRICE ? parseFloat(process.env.GRID_TRADING_LOWER_PRICE) : null,
          upperPrice: process.env.GRID_TRADING_UPPER_PRICE ? parseFloat(process.env.GRID_TRADING_UPPER_PRICE) : null,
          boundsLookbackDays: parseInt(process.env.GRID_TRADING_BOUNDS_LOOKBACK_DAYS) || 90,
          boundsPaddingPct: parseFloat(process.env.GRID_TRADING_BOUNDS_PADDING_PCT) || 0.05,
          scanIntervalMs: parseInt(process.env.GRID_TRADING_SCAN_INTERVAL_MS) || 300000
        },
        // Real, LEVERAGED Binance USDT-M futures DCA agent. Only places orders when
        // LIVE_TRADING_CONFIRMED=true AND LIVE_FUTURES_TRADING_CONFIRMED=true AND real
        // (non-placeholder) API credentials are configured; otherwise
        // realFuturesTradingService blocks order placement. budgetCapUsd is measured in
        // margin committed, not notional (leveraged) exposure.
        binanceFuturesDca: {
          symbol: process.env.BINANCE_FUTURES_DCA_SYMBOL || 'BTCUSDT',
          dailyMarginUsd: parseFloat(process.env.BINANCE_FUTURES_DCA_DAILY_MARGIN_USD) || 5,
          budgetCapUsd: parseFloat(process.env.BINANCE_FUTURES_DCA_BUDGET_CAP_USD) || Infinity,
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
          budgetCapUsd: parseFloat(process.env.BREAKOUT_FUTURES_BUDGET_CAP_USD) || Infinity,
          leverage: parseInt(process.env.BREAKOUT_FUTURES_LEVERAGE) || 50,
          marginMode: process.env.BREAKOUT_FUTURES_MARGIN_MODE || 'ISOLATED',
          stopLossPct: parseFloat(process.env.BREAKOUT_FUTURES_STOP_LOSS_PCT) || 0.01,
          takeProfitPct: parseFloat(process.env.BREAKOUT_FUTURES_TAKE_PROFIT_PCT) || 0.03,
          nearHighThresholdPct: parseFloat(process.env.BREAKOUT_FUTURES_NEAR_HIGH_PCT) || 0.001,
          momentumThresholdPct: parseFloat(process.env.BREAKOUT_FUTURES_MOMENTUM_PCT) || 5,
          minQuoteVolumeUsd: parseFloat(process.env.BREAKOUT_FUTURES_MIN_VOLUME_USD) || 5000000,
          maxCandidatesPerCycle: parseInt(process.env.BREAKOUT_FUTURES_MAX_CANDIDATES_PER_CYCLE) || Infinity,
          scanIntervalMs: parseInt(process.env.BREAKOUT_FUTURES_SCAN_INTERVAL_MS) || 300000
        },
        // Real, LEVERAGED mean-reversion (RSI oversold) scanner — distinct signal from
        // breakoutFutures (momentum). Same dual live-trading gates plus the shared
        // global cross-agent cap, enforced in realFuturesTradingService.
        meanReversionFutures: {
          perTradeMarginUsd: parseFloat(process.env.MEAN_REVERSION_FUTURES_PER_TRADE_MARGIN_USD) || 5,
          budgetCapUsd: parseFloat(process.env.MEAN_REVERSION_FUTURES_BUDGET_CAP_USD) || Infinity,
          leverage: parseInt(process.env.MEAN_REVERSION_FUTURES_LEVERAGE) || 50,
          marginMode: process.env.MEAN_REVERSION_FUTURES_MARGIN_MODE || 'ISOLATED',
          stopLossPct: parseFloat(process.env.MEAN_REVERSION_FUTURES_STOP_LOSS_PCT) || 0.01,
          takeProfitPct: parseFloat(process.env.MEAN_REVERSION_FUTURES_TAKE_PROFIT_PCT) || 0.03,
          rsiPeriod: parseInt(process.env.MEAN_REVERSION_FUTURES_RSI_PERIOD) || 14,
          rsiInterval: process.env.MEAN_REVERSION_FUTURES_RSI_INTERVAL || '1h',
          rsiOversoldThreshold: parseFloat(process.env.MEAN_REVERSION_FUTURES_RSI_OVERSOLD) || 30,
          minQuoteVolumeUsd: parseFloat(process.env.MEAN_REVERSION_FUTURES_MIN_VOLUME_USD) || 5000000,
          watchlistSize: parseInt(process.env.MEAN_REVERSION_FUTURES_WATCHLIST_SIZE) || Infinity,
          maxCandidatesPerCycle: parseInt(process.env.MEAN_REVERSION_FUTURES_MAX_CANDIDATES_PER_CYCLE) || Infinity,
          scanIntervalMs: parseInt(process.env.MEAN_REVERSION_FUTURES_SCAN_INTERVAL_MS) || 900000
        },
        // Read-only real HackerOne public-program feed. No auth, no order/report
        // submission — surfaces real opportunities for the user to act on manually.
        hackerOneBounty: {
          pollIntervalMs: parseInt(process.env.HACKERONE_POLL_INTERVAL_MS) || 3600000,
          maxResultsPerPoll: parseInt(process.env.HACKERONE_MAX_RESULTS) || 20
        },
        // Read-only real GitHub paid-bounty issue feed. No auth, no comment/PR
        // submission — surfaces real opportunities for the user to act on manually.
        githubBountyHunter: {
          pollIntervalMs: parseInt(process.env.GITHUB_BOUNTY_POLL_INTERVAL_MS) || 3600000,
          maxResultsPerPoll: parseInt(process.env.GITHUB_BOUNTY_MAX_RESULTS) || 20
        },
        // Read-only real Remote OK crypto/web3 job feed. No auth, no application
        // submission — surfaces real opportunities for the user to act on manually.
        cryptoGigHunter: {
          pollIntervalMs: parseInt(process.env.CRYPTO_GIG_HUNTER_POLL_INTERVAL_MS) || 3600000,
          maxResultsPerPoll: parseInt(process.env.CRYPTO_GIG_HUNTER_MAX_RESULTS) || 20
        },
        // Read-only real Hacker News company/project-lead feed ("Who is hiring?" +
        // "Seeking freelancer?" monthly threads). No auth, never posts/replies —
        // surfaces real leads plus a capped number of auto-drafted pitch responses
        // (real Claude API cost) for the user to review manually.
        companyLeadHunter: {
          pollIntervalMs: parseInt(process.env.COMPANY_LEAD_HUNTER_POLL_INTERVAL_MS) || 21600000,
          maxResultsPerPoll: parseInt(process.env.COMPANY_LEAD_HUNTER_MAX_RESULTS) || 10,
          maxAutoDraftsPerPoll: parseInt(process.env.COMPANY_LEAD_HUNTER_MAX_AUTO_DRAFTS) || 3
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
        // addition to each agent's own per-agent budgetCapUsd. Uncapped by default
        // (explicit user decision, accepting unlimited real leveraged exposure) — set
        // GLOBAL_FUTURES_BUDGET_CAP_USD to reinstate a hard ceiling.
        globalFuturesBudgetCapUsd: parseFloat(process.env.GLOBAL_FUTURES_BUDGET_CAP_USD) || Infinity
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
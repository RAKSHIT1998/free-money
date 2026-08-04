// Import required modules
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Load environment variables first
dotenv.config();

// Load environment variables (duplicate line removed)
// dotenv.config();

// A mongodb+srv:// URI (used by MongoDB Atlas) requires a DNS SRV record lookup before
// the driver can even open a connection. Some networks' default DNS resolvers (seen
// here: an ISP resolver that answers plain A/AAAA queries fine but refuses SRV
// queries, verified independently of this app via `dns.resolveSrv`) cause that lookup
// to fail outright with ECONNREFUSED, even though the connection string itself is
// valid. Pointing Node's resolver at public DNS sidesteps it — safe everywhere (not
// just this network), so left in rather than only diagnosed and skipped.
require('dns').setServers(['8.8.8.8', '1.1.1.1']);

// Function to get or generate a unique device ID
function getOrCreateDeviceId() {
  const idFile = path.join(process.cwd(), '.device-id');
  let deviceId;
  try {
    if (fs.existsSync(idFile)) {
      deviceId = fs.readFileSync(idFile, 'utf8').trim();
    } else {
      // Generate a semi-unique ID: hostname + random + timestamp
      const hostname = os.hostname().replace(/[^a-z0-9]/gi, '-').toLowerCase();
      const random = Math.random().toString(36).substring(2, 9);
      const timestamp = Date.now().toString(36);
      deviceId = `${hostname}-${random}-${timestamp}`;
      fs.writeFileSync(idFile, deviceId, { encoding: 'utf8' });
    }
  } catch (err) {
    console.warn('Could not read/write device ID file, falling back to random ID:', err);
    deviceId = `dev-${Math.random().toString(36).substring(2, 15)}-${Date.now()}`;
  }
  return deviceId;
}

// Initialize express app
const app = express();
const PORT = process.env.PORT || 5000;

// Generate/set device ID early so it's available throughout the app
const DEVICE_ID = getOrCreateDeviceId();
process.env.DEVICE_ID = DEVICE_ID;
console.log(`Device ID: ${DEVICE_ID}`);

// Middleware setup
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true
}));
app.use(express.json({ limit: process.env.MAX_FILE_SIZE || '10mb' }));
app.use(express.urlencoded({ extended: true, limit: process.env.MAX_FILE_SIZE || '10mb' }));
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      'script-src': ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
      'style-src': ["'self'", "'unsafe-inline'"],
      'connect-src': ["'self'"]
    }
  }
}));
app.use(morgan(process.env.LOG_LEVEL || 'combined'));
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Routes
app.use('/api/auth', require('./src/server/routes/authRoutes'));
app.use('/api/opportunities', require('./src/server/middleware/auth').authenticateToken, require('./src/server/routes/opportunityRoutes'));
app.use('/api/agents', require('./src/server/middleware/auth').authenticateToken, require('./src/server/routes/agentRoutes'));
app.use('/api/wallet', require('./src/server/routes/walletRoutes'));
app.use('/api/gigs', require('./src/server/middleware/auth').authenticateToken, require('./src/server/routes/gigRoutes'));

// Health check endpoint. Deliberately unauthenticated (matches the plain uptime check
// it replaces) and only ever makes PUBLIC/unsigned calls — no API keys used, no way to
// place an order through this route. Exists specifically to answer "can THIS deployed
// instance actually reach Binance" post-deploy, since some cloud/datacenter IP ranges
// get blocked or rate-limited differently than a home connection would be.
app.get('/health', async (req, res) => {
  const checks = { mongo: 'skipped', binance: 'skipped' };

  if (mongoose.connection.readyState === 1) {
    checks.mongo = 'ok';
  } else if (process.env.PERSISTENCE_ENABLED !== 'false') {
    checks.mongo = `not connected (state=${mongoose.connection.readyState})`;
  }

  try {
    const axios = require('axios');
    const start = Date.now();
    await axios.get('https://fapi.binance.com/fapi/v1/ping', { timeout: 5000 });
    checks.binance = `ok (${Date.now() - start}ms)`;
  } catch (error) {
    checks.binance = `unreachable: ${error.message}`;
  }

  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'Money Making API',
    version: '1.0.0',
    checks
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Something went wrong!',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Start server
const startServer = async () => {
  // Load configuration
  const Config = require('./src/config/config').Config;
  const configInstance = new Config();

  // Only connect to MongoDB if persistence is enabled
  const persistenceEnabled = configInstance.get('agentManager.persistenceEnabled', true);
  if (persistenceEnabled) {
    try {
      await mongoose.connect(configInstance.get('database.uri') || 'mongodb://localhost:27017/money-maker', {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      });
      console.log('Connected to MongoDB');
    } catch (error) {
      console.error('Failed to connect to MongoDB:', error);
      console.log('Continuing without MongoDB (using in-memory storage for opportunities)');
    }
  } else {
    console.log('MongoDB persistence disabled - using in-memory storage for opportunities');
  }

  // Schedule automatic opportunity sync every 6 hours (only if persistence is enabled)
  if (persistenceEnabled) {
    cron.schedule('0 */6 * * *', async () => {
      console.log('Running scheduled opportunity sync...');
      try {
        const opportunityService = require('./src/services/opportunityService');
        const opportunities = await opportunityService.syncOpportunities();
        console.log(`Scheduled sync completed: ${opportunities.length} opportunities synced`);
      } catch (error) {
        console.error('Error during scheduled opportunity sync:', error);
      }
    });
  }

  // Run initial sync on startup (only if persistence is enabled)
  if (persistenceEnabled) {
    console.log('Running initial opportunity sync...');
    const opportunityService = require('./src/services/opportunityService');
    opportunityService.syncOpportunities().then(result => {
      console.log(`Initial sync completed: ${result.length} opportunities synced`);
    }).catch(err => {
      console.error('Error during initial sync:', err);
    });
  } else {
    console.log('Skipping opportunity sync - persistence disabled');
  }

  // Start the agent management system
  console.log('Starting agent management system...');
  const AgentManager = require('./src/agents/agentManager');
  const agentManager = AgentManager.initialize({
    config: configInstance
  });

  // Start server and then spawn initial agents
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);

    // Spawn initial agents after server starts. Every spawn below is guarded by
    // spawnIfMissing so this is idempotent — if this ever runs more than once against
    // the same live AgentManager (observed in practice, root cause not fully pinned
    // down — possibly overlapping restarts), it no longer creates duplicate agents
    // that then each independently trade/poll with no relation to each other.
    const spawnIfMissing = async (type, options) => {
      if (agentManager.getAgentsByType(type).length > 0) {
        console.log(`Skipping auto-spawn of ${type} — one is already running`);
        return;
      }
      await agentManager.spawnAgent(type, options);
    };

    // For agent types that can run multiple diversified instances of the same type
    // against different symbols (e.g. binanceFuturesDca on BTC AND ETH AND SOL...),
    // "one already exists" isn't the right dedupe check — it would only ever let the
    // first symbol resume after a restart. Dedupe by (type, symbol) instead.
    const spawnIfMissingBySymbol = async (type, symbol, options) => {
      const existing = agentManager.getAgentsByType(type).some(a => a.config?.symbol === symbol);
      if (existing) {
        console.log(`Skipping auto-spawn of ${type} (${symbol}) — one is already running`);
        return;
      }
      await agentManager.spawnAgent(type, options);
    };

    // Wait for any persisted agents to actually finish restoring from the database
    // before running the dedup checks below — a flat setTimeout here (what this used
    // to be) assumed that restore would always be fast, which isn't reliable against a
    // remote database. See agentManager.js's readyPromise comment for what went wrong
    // in practice without this.
    (async () => {
      await agentManager.waitUntilReady();
      try {
        // Real, read-only HackerOne opportunity feed — zero financial risk (no orders,
        // no withdrawals), safe to auto-spawn by default.
        await spawnIfMissing('hackerOneBounty', {
          name: 'Initial HackerOne Bounty Feed',
          config: {
            pollIntervalMs: configInstance.get('agentTypes.hackerOneBounty.pollIntervalMs') || 3600000,
            maxResultsPerPoll: configInstance.get('agentTypes.hackerOneBounty.maxResultsPerPoll') || 20
          }
        });

        // Real, read-only Remote OK crypto/web3 job feed — zero financial risk (no
        // applications submitted), safe to auto-spawn by default.
        await spawnIfMissing('cryptoGigHunter', {
          name: 'Initial Crypto Gig Hunter',
          config: {
            pollIntervalMs: configInstance.get('agentTypes.cryptoGigHunter.pollIntervalMs') || 3600000,
            maxResultsPerPoll: configInstance.get('agentTypes.cryptoGigHunter.maxResultsPerPoll') || 20
          }
        });

        // Real, read-only GitHub paid-bounty issue feed — zero financial risk (no
        // comments posted, no PRs opened), safe to auto-spawn by default.
        await spawnIfMissing('githubBountyHunter', {
          name: 'Initial GitHub Bounty Hunter',
          config: {
            pollIntervalMs: configInstance.get('agentTypes.githubBountyHunter.pollIntervalMs') || 3600000,
            maxResultsPerPoll: configInstance.get('agentTypes.githubBountyHunter.maxResultsPerPoll') || 20
          }
        });

        // Real, read-only Hacker News company/project-lead feed — never posts, never
        // contacts anyone. Small, capped real Claude API cost for auto-drafted pitch
        // responses (never sent automatically); no orders, no payments. Safe to
        // auto-spawn by default.
        await spawnIfMissing('companyLeadHunter', {
          name: 'Initial Company Lead Hunter',
          config: {
            pollIntervalMs: configInstance.get('agentTypes.companyLeadHunter.pollIntervalMs') || 21600000,
            maxResultsPerPoll: configInstance.get('agentTypes.companyLeadHunter.maxResultsPerPoll') || 10,
            maxAutoDraftsPerPoll: configInstance.get('agentTypes.companyLeadHunter.maxAutoDraftsPerPoll') || 3
          }
        });

        // Health monitor for all other agents — restarts anything stuck in 'error'
        // state. Zero financial risk itself (no orders, no withdrawals), safe to
        // auto-spawn by default.
        await spawnIfMissing('realAgentMonitor', {
          name: 'Initial Real Agent Monitor',
          config: {
            checkIntervalMs: configInstance.get('agentTypes.realAgentMonitor.checkIntervalMs') || 120000,
            errorCyclesBeforeRestart: configInstance.get('agentTypes.realAgentMonitor.errorCyclesBeforeRestart') || 2
          }
        });

        // Real-money trading agents are NOT auto-spawned by default — they place real
        // orders with real money and must normally be started deliberately via
        // POST /api/agents/spawn. This flag is a THIRD, separate opt-in (on top of
        // LIVE_TRADING_CONFIRMED and LIVE_FUTURES_TRADING_CONFIRMED, which the trading
        // services still independently enforce) specifically for "resume real trading
        // automatically after a crash/reboot without a human re-triggering it" —
        // a meaningfully different risk than a one-time manual spawn.
        if (process.env.AUTO_SPAWN_REAL_TRADING_AGENTS === 'true') {
          console.log('AUTO_SPAWN_REAL_TRADING_AGENTS=true — auto-spawning real-money trading agents');
          // meanReversionFutures and breakoutFutures were previously excluded here:
          // meanReversionFutures backtested against 90 days of real BTC/ETH/SOL/BNB 1h
          // data at live risk settings and showed a historical loss (274 trades,
          // -$183.44, 20.8% win rate — see backtests/backtest_results.json).
          // breakoutFutures looked positive on a too-small 4-symbol/22-trade sample
          // (+$19.49), but expanding to 10 symbols/80 trades reversed that to a loss
          // (-$49.99, see backtests/backtest_breakout_extended_results.json).
          // Re-enabled 2026-08-04 as an explicit user decision (accepting that risk,
          // not a claim the negative expectancy was fixed), alongside removing the
          // global/per-agent budget caps and adding a short side to both strategies.
          // binanceFuturesDca: was briefly excluded (2026-08-03) after Binance's
          // 2025-12-09 migration of conditional orders to a dedicated Algo Order API
          // broke stop-loss/take-profit placement (error -4120) — a real position
          // opened fully unprotected as a result and was manually closed. Fixed
          // (openLeveragedLong now uses POST /fapi/v1/algoOrder) and re-verified
          // against a real live position with an independent query confirming both
          // orders exist on Binance's side before re-enabling.
          try {
            await spawnIfMissing('binanceDca', { name: 'Auto-resumed binanceDca' });
          } catch (error) {
            console.error('Error auto-spawning real trading agent binanceDca:', error.message);
          }

          // No leverage, no directional exposure — sweeps idle spot USDT above its
          // reserve into Binance's highest-APY flexible Earn product. Added 2026-08-04.
          try {
            await spawnIfMissing('binanceEarn', { name: 'Auto-resumed binanceEarn' });
          } catch (error) {
            console.error('Error auto-spawning real trading agent binanceEarn:', error.message);
          }

          // Market-neutral (long spot + short perp) — collects funding rate, not price
          // direction. Added 2026-08-04.
          try {
            await spawnIfMissing('fundingRateArbitrage', { name: 'Auto-resumed fundingRateArbitrage' });
          } catch (error) {
            console.error('Error auto-spawning real trading agent fundingRateArbitrage:', error.message);
          }

          // Spot, no leverage — profits from range-bound price action. Added 2026-08-04.
          try {
            await spawnIfMissing('gridTrading', { name: 'Auto-resumed gridTrading' });
          } catch (error) {
            console.error('Error auto-spawning real trading agent gridTrading:', error.message);
          }

          // Diversified DCA slots across multiple symbols (2026-08-03): same no-signal,
          // scheduled/protected accumulation approach as the original BTCUSDT-only
          // agent, spread across more liquid majors plus one small, lower-leverage
          // meme-coin slot (DOGE — chosen for being the most established/liquid meme
          // coin, not because any signal backtested well on it; DCA makes no such
          // claim either way). Dedupe by symbol so each instance independently
          // survives a restart.
          // PAXGUSDT added 2026-08-04 at the user's request for commodity-flavored
          // exposure — Binance has no actual crude oil/WTI futures product, PAXG
          // (a gold-backed token) is the closest thing it lists. Lower leverage than
          // the crypto majors since it's a different volatility profile (backed by a
          // physical commodity, not free-floating crypto).
          const FUTURES_DCA_SLOTS = [
            { symbol: 'BTCUSDT', leverage: 50, dailyMarginUsd: 5 },
            { symbol: 'ETHUSDT', leverage: 10, dailyMarginUsd: 2 },
            { symbol: 'SOLUSDT', leverage: 10, dailyMarginUsd: 2 },
            { symbol: 'BNBUSDT', leverage: 10, dailyMarginUsd: 2 },
            { symbol: 'ADAUSDT', leverage: 10, dailyMarginUsd: 2 },
            { symbol: 'XRPUSDT', leverage: 10, dailyMarginUsd: 2 },
            { symbol: 'DOGEUSDT', leverage: 5, dailyMarginUsd: 1 },
            { symbol: 'PAXGUSDT', leverage: 5, dailyMarginUsd: 2 }
          ];
          for (const slot of FUTURES_DCA_SLOTS) {
            try {
              await spawnIfMissingBySymbol('binanceFuturesDca', slot.symbol, {
                name: `Auto-resumed binanceFuturesDca (${slot.symbol})`,
                config: {
                  symbol: slot.symbol,
                  leverage: slot.leverage,
                  dailyMarginUsd: slot.dailyMarginUsd,
                  stopLossPct: 0.01,
                  takeProfitPct: 0.03,
                  budgetCapUsd: Infinity
                }
              });
            } catch (error) {
              console.error(`Error auto-spawning binanceFuturesDca (${slot.symbol}):`, error.message);
            }
          }

          try {
            await spawnIfMissing('breakoutFutures', {
              name: 'Auto-resumed breakoutFutures',
              config: { budgetCapUsd: Infinity }
            });
          } catch (error) {
            console.error('Error auto-spawning breakoutFutures:', error.message);
          }

          try {
            await spawnIfMissing('meanReversionFutures', {
              name: 'Auto-resumed meanReversionFutures',
              config: { budgetCapUsd: Infinity }
            });
          } catch (error) {
            console.error('Error auto-spawning meanReversionFutures:', error.message);
          }
        }

        console.log('Initial agents spawned from configuration');
      } catch (error) {
        console.error('Error spawning initial agents:', error);
      }
    })();
  });
};

// Start the server
startServer();

module.exports = app;
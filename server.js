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

// Render sits in front of this app as a single reverse-proxy hop. Without this,
// Express doesn't trust the X-Forwarded-For header Render sets, so req.ip resolves to
// the proxy's own internal address for every request — express-rate-limit was logging
// exactly this misconfiguration warning, and it means every distinct real client was
// being bucketed together under one effective "IP" for rate-limiting, not counted
// separately. `1` trusts exactly one hop (Render's own proxy), not the whole chain.
app.set('trust proxy', 1);

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

// Serves the built React dashboard (vite-react-ts-tailwind/dist) from this same
// Express process — added for single-port cloud deployment (2026-09-02). Locally,
// the dashboard is normally run separately via `vite --port 3000`, so `dist/` won't
// exist unless someone has run `npm run build` in vite-react-ts-tailwind; the
// fs.existsSync guard means local dev is completely unaffected either way. On a
// cloud VM, this lets one process/one open port serve both the API and the
// dashboard, instead of needing two separate services and CORS configuration.
// Registered BEFORE the legacy `public/` static folder below — public/index.html
// predates the React dashboard and is dead/unreferenced, but express.static resolves
// `/` to whichever mount matches first, so it would otherwise shadow the real app.
const frontendDistPath = path.join(__dirname, 'vite-react-ts-tailwind', 'dist');
const frontendBuildExists = fs.existsSync(path.join(frontendDistPath, 'index.html'));
if (frontendBuildExists) {
  app.use(express.static(frontendDistPath));
}
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
    // Routed through realFuturesTradingService's shared rate-limit gate (not a raw
    // axios call) so a health check during an active Binance ban doesn't itself send
    // a fresh request and extend it — see pingBinance's own comment for why this
    // matters.
    const realFuturesTradingService = require('./src/services/realFuturesTradingService');
    const start = Date.now();
    await realFuturesTradingService.pingBinance();
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

// SPA fallback — any GET that isn't /api/*, /health, or a real static file falls
// through to the dashboard's index.html so React Router's client-side routes (e.g.
// /real-money on a hard refresh) resolve instead of 404ing. Must come after the
// static middleware above (which already serves real files first) and before the
// JSON 404 handler below (which still covers API routes and non-GET requests).
if (frontendBuildExists) {
  app.get(/^(?!\/api\/|\/health).*/, (req, res) => {
    res.sendFile(path.join(frontendDistPath, 'index.html'));
  });
}

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

  // Auto-capture real PayPal payments the moment a client approves them — closes the
  // gap between "payment requested" and "money actually collected" without a human
  // needing to click "Confirm Payment Received" by hand. Never requests a payment or
  // invents an amount on its own; only advances orders a human already requested.
  if (persistenceEnabled && process.env.PAYPAL_ENABLED === 'true') {
    const gigPaymentAutopilotService = require('./src/services/gigPaymentAutopilotService');
    cron.schedule('*/10 * * * *', async () => {
      try {
        const result = await gigPaymentAutopilotService.pollAndCapturePendingPayments();
        if (result.checked > 0) {
          console.log(`[gigPaymentAutopilot] Checked ${result.checked} pending payment(s), captured ${result.captured}`);
        }
      } catch (error) {
        console.error('Error during gig payment autopilot poll:', error);
      }
    });
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
    // The performance governor permanently stops (and records via CulledAgent) any
    // real trading agent with a sustained real loss — a restart/redeploy must respect
    // that, not silently resurrect the same losing agent every time.
    const agentCullService = require('./src/services/agentCullService');

    const spawnIfMissing = async (type, options) => {
      if (agentManager.getAgentsByType(type).length > 0) {
        console.log(`Skipping auto-spawn of ${type} — one is already running`);
        return;
      }
      const culled = await agentCullService.isCulled(type, null);
      if (culled) {
        console.log(`Skipping auto-spawn of ${type} — permanently culled by the performance governor: ${culled.reason}`);
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
      const culled = await agentCullService.isCulled(type, symbol);
      if (culled) {
        console.log(`Skipping auto-spawn of ${type} (${symbol}) — permanently culled by the performance governor: ${culled.reason}`);
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

        // Real, read-only airdrops.io project feed — zero financial risk (never
        // checks a specific wallet, never connects a wallet, never claims anything),
        // safe to auto-spawn by default. See airdropClaimScannerAgent.js for why.
        await spawnIfMissing('airdropClaimScanner', {
          name: 'Initial Airdrop Claim Scanner',
          config: {
            pollIntervalMs: configInstance.get('agentTypes.airdropClaimScanner.pollIntervalMs') || 3600000,
            maxResultsPerPoll: configInstance.get('agentTypes.airdropClaimScanner.maxResultsPerPoll') || 20,
            maxEnrichPerPoll: configInstance.get('agentTypes.airdropClaimScanner.maxEnrichPerPoll') || 10
          }
        });

        // Real, read-only CoinGecko trending-coins feed — zero financial risk (never
        // trades on this signal, only surfaces it), safe to auto-spawn by default.
        // See cryptoUpdatesTrackerAgent.js for why this isn't a literal Twitter feed.
        await spawnIfMissing('cryptoUpdatesTracker', {
          name: 'Initial Crypto Updates Tracker',
          config: {
            pollIntervalMs: configInstance.get('agentTypes.cryptoUpdatesTracker.pollIntervalMs') || 1800000,
            maxResultsPerPoll: configInstance.get('agentTypes.cryptoUpdatesTracker.maxResultsPerPoll') || 15
          }
        });

        // Real, read-only, self-built "best meme coin traders" tracker — never
        // trades, never follows a wallet, only judges real on-chain early-buy
        // observations against real market-cap outcomes. Safe to auto-spawn by
        // default. See smartMoneyTrackerService.js for the full design.
        await spawnIfMissing('smartMoneyTracker', {
          name: 'Initial Smart Money Tracker',
          config: {
            reconcileIntervalMs: configInstance.get('agentTypes.smartMoneyTracker.reconcileIntervalMs') || 1800000,
            maxReconcilePerCycle: configInstance.get('agentTypes.smartMoneyTracker.maxReconcilePerCycle') || 20
          }
        });

        // Real Telegram push notifications — idle (not an error) until
        // TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID are configured. Zero financial risk
        // (never trades), safe to auto-spawn by default.
        await spawnIfMissing('telegramNotifier', {
          name: 'Initial Telegram Notifier',
          config: {
            digestIntervalMs: configInstance.get('agentTypes.telegramNotifier.digestIntervalMs') || 14400000
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

        // Real, read-only cross-exchange (Binance/Coinbase/Kraken) spot spread
        // scanner — zero financial risk (no orders on any exchange), safe to
        // auto-spawn by default. See crossExchangeArbitrageAgent.js for why it only
        // surfaces candidates rather than executing them.
        await spawnIfMissing('crossExchangeArbitrage', {
          name: 'Initial Cross-Exchange Arbitrage Scanner',
          config: {
            minNetSpreadPct: configInstance.get('agentTypes.crossExchangeArbitrage.minNetSpreadPct') || 0.003,
            maxCandidatesTracked: configInstance.get('agentTypes.crossExchangeArbitrage.maxCandidatesTracked') || 10,
            scanIntervalMs: configInstance.get('agentTypes.crossExchangeArbitrage.scanIntervalMs') || 2000,
            staleQuoteMs: configInstance.get('agentTypes.crossExchangeArbitrage.staleQuoteMs') || 15000,
            numberAssets: configInstance.get('agentTypes.crossExchangeArbitrage.numberAssets') || 15,
            minQuoteVolumeUsd: configInstance.get('agentTypes.crossExchangeArbitrage.minQuoteVolumeUsd') || 2000000,
            maxSpreadRatio: configInstance.get('agentTypes.crossExchangeArbitrage.maxSpreadRatio') || 0.005,
            pairlistRefreshMs: configInstance.get('agentTypes.crossExchangeArbitrage.pairlistRefreshMs') || 1800000
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
          // binanceDca (spot DCA) removed from auto-spawn 2026-08-05 — explicit user
          // policy: no spot trading on Binance, futures/derivatives only. The agent
          // was terminated and deleted from the database; if this block still called
          // spawnIfMissing, the very next restart would silently recreate and resume
          // it, undoing that policy without any further action needed to trigger it.

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

          // gridTrading (spot, no leverage) removed from auto-spawn 2026-08-05 — same
          // no-spot-trading policy as binanceDca above. Terminated and deleted from
          // the database; not re-added here so a restart can't silently resume it.

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

          // Real, HIGH-RISK pump.fun memecoin sniper. Unlike the Binance futures
          // agents above, this has no separate global-cap backstop, so it's spawned
          // with its own real, finite budgetCapUsd (PUMPFUN_SNIPER_BUDGET_CAP_USD,
          // default $10 — see config.js) rather than Infinity. Requires
          // LIVE_PUMPFUN_TRADING_CONFIRMED=true and a real SOLANA_PRIVATE_KEY,
          // enforced in pumpFunTradingService, not here.
          try {
            await spawnIfMissing('pumpFunSniper', { name: 'Auto-resumed pumpFunSniper' });
          } catch (error) {
            console.error('Error auto-spawning pumpFunSniper:', error.message);
          }

          // "Race to survival" performance governor — reviews the real directional
          // trading agents above on an interval and stops sustained real losers /
          // boosts sustained real winners. Only meaningful once there are real
          // trading agents to govern, hence gated behind the same flag.
          try {
            await spawnIfMissing('performanceGovernor', { name: 'Auto-resumed performanceGovernor' });
          } catch (error) {
            console.error('Error auto-spawning performanceGovernor:', error.message);
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
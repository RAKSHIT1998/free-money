// Agent management controller
const AgentManager = require('../../agents/agentManager');
const OpportunityService = require('../../services/opportunityService');
const realTradingService = require('../../services/realTradingService');
const realFuturesTradingService = require('../../services/realFuturesTradingService');
const pumpFunTradingService = require('../../services/pumpFunTradingService');
const agentCullService = require('../../services/agentCullService');
const transferArbPositionStore = require('../../services/transferArbPositionStore');
const currencyService = require('../../services/currencyService');

// Get agent manager instance (lazy initialization)
let agentManager = null;
const getAgentManager = () => {
  if (agentManager === null) {
    agentManager = AgentManager.getInstance();
  }
  return agentManager;
};

exports.getAllAgents = async (req, res) => {
  try {
    const agents = getAgentManager().getAllAgents();
    const agentData = agents.map(agent => ({
      id: agent.id,
      type: agent.type,
      state: agent.state,
      isRunning: agent.isRunning,
      createdAt: agent.createdAt,
      lastActive: agent.lastActive,
      performance: agent.performance,
      // Discovery agents (cryptoGigHunter, hackerOneBounty) track genuinely-new-vs-
      // already-seen listings per poll; surface it here when present.
      ...(agent.discoveryStats ? { discovery: agent.discoveryStats } : {}),
      // crossExchangeArbitrage tracks its latest scan's candidate spreads; surface
      // it here so the top opportunities are visible without a dedicated route.
      ...(agent.lastScanCandidates ? {
        arbitrage: { lastScanAt: agent.lastScanAt, candidates: agent.lastScanCandidates }
      } : {})
    }));

    const stats = getAgentManager().getStatistics();

    res.json({
      success: true,
      data: {
        agents: agentData,
        statistics: stats
      }
    });
  } catch (error) {
    console.error('Error getting agents:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get agents',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.getAgentById = async (req, res) => {
  try {
    const agentId = parseInt(req.params.id);
    const agent = getAgentManager().getAgent(agentId);

    if (!agent) {
      return res.status(404).json({
        success: false,
        message: 'Agent not found'
      });
    }

    res.json({
      success: true,
      data: {
        id: agent.id,
        type: agent.type,
        state: agent.state,
        isRunning: agent.isRunning,
        createdAt: agent.createdAt,
        lastActive: agent.lastActive,
        performance: agent.performance,
        config: agent.config
      }
    });
  } catch (error) {
    console.error('Error getting agent by ID:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get agent',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.spawnAgent = async (req, res) => {
  try {
    const { type, options, config, name } = req.body;

    if (!type) {
      return res.status(400).json({
        success: false,
        message: 'Agent type is required'
      });
    }

    // Accepts config/name either top-level ({type, config, name}) or nested under
    // options ({type, options: {config, name}}) — the mismatch between these two
    // shapes previously caused a real config override to be silently ignored
    // (agents spawned with default symbol/leverage instead of the requested ones).
    const mergedOptions = { ...options, config: { ...options?.config, ...config }, name: name || options?.name };

    const agent = await getAgentManager().spawnAgent(type, mergedOptions);

    res.status(201).json({
      success: true,
      message: `Agent spawned successfully`,
      data: {
        id: agent.id,
        type: agent.type,
        state: agent.state,
        isRunning: agent.isRunning
      }
    });
  } catch (error) {
    console.error('Error spawning agent:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to spawn agent',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.terminateAgent = async (req, res) => {
  try {
    const agentId = parseInt(req.params.id);
    const result = await getAgentManager().removeAgent(agentId);

    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Agent not found'
      });
    }

    res.json({
      success: true,
      message: 'Agent terminated successfully'
    });
  } catch (error) {
    console.error('Error terminating agent:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to terminate agent',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.updateAgentConfig = async (req, res) => {
  try {
    const agentId = parseInt(req.params.id);
    const config = req.body;

    const result = await getAgentManager().updateAgentConfig(agentId, config);

    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Agent not found'
      });
    }

    res.json({
      success: true,
      message: 'Agent configuration updated successfully'
    });
  } catch (error) {
    console.error('Error updating agent config:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update agent configuration',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.getAgentStatistics = async (req, res) => {
  try {
    const stats = getAgentManager().getStatistics();

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error getting agent statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get agent statistics',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.getBinanceDcaStatus = async (req, res) => {
  try {
    const agents = getAgentManager().getAllAgents().filter(agent => agent.type === 'binanceDca');
    const statuses = await Promise.all(agents.map(agent => agent.getStatusExtended()));

    res.json({
      success: true,
      data: statuses
    });
  } catch (error) {
    console.error('Error getting Binance DCA status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get Binance DCA status',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.getBinanceEarnStatus = async (req, res) => {
  try {
    const agents = getAgentManager().getAllAgents().filter(agent => agent.type === 'binanceEarn');
    const statuses = await Promise.all(agents.map(agent => agent.getStatusExtended()));

    res.json({
      success: true,
      data: statuses
    });
  } catch (error) {
    console.error('Error getting Binance Earn status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get Binance Earn status',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.getFundingRateArbitrageStatus = async (req, res) => {
  try {
    const agents = getAgentManager().getAllAgents().filter(agent => agent.type === 'fundingRateArbitrage');
    const statuses = await Promise.all(agents.map(agent => agent.getStatusExtended()));

    res.json({
      success: true,
      data: statuses
    });
  } catch (error) {
    console.error('Error getting funding-rate arbitrage status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get funding-rate arbitrage status',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.getGridTradingStatus = async (req, res) => {
  try {
    const agents = getAgentManager().getAllAgents().filter(agent => agent.type === 'gridTrading');
    const statuses = await Promise.all(agents.map(agent => agent.getStatusExtended()));

    res.json({
      success: true,
      data: statuses
    });
  } catch (error) {
    console.error('Error getting grid trading status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get grid trading status',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.getPumpFunSniperStatus = async (req, res) => {
  try {
    const agents = getAgentManager().getAllAgents().filter(agent => agent.type === 'pumpFunSniper');
    const statuses = await Promise.all(agents.map(agent => agent.getStatusExtended()));

    res.json({
      success: true,
      data: statuses
    });
  } catch (error) {
    console.error('Error getting pump.fun sniper status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get pump.fun sniper status',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.getCrossExchangeTransferArbitrageStatus = async (req, res) => {
  try {
    const agents = getAgentManager().getAllAgents().filter(agent => agent.type === 'crossExchangeTransferArbitrage');
    const statuses = await Promise.all(agents.map(agent => agent.getStatusExtended()));

    res.json({
      success: true,
      data: statuses
    });
  } catch (error) {
    console.error('Error getting cross-exchange transfer arbitrage status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get cross-exchange transfer arbitrage status',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.getBinanceFuturesDcaStatus = async (req, res) => {
  try {
    const agents = getAgentManager().getAllAgents().filter(agent => agent.type === 'binanceFuturesDca');
    const statuses = await Promise.all(agents.map(agent => agent.getStatusExtended()));

    res.json({
      success: true,
      data: statuses
    });
  } catch (error) {
    console.error('Error getting Binance Futures DCA status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get Binance Futures DCA status',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.getBreakoutFuturesStatus = async (req, res) => {
  try {
    const agents = getAgentManager().getAllAgents().filter(agent => agent.type === 'breakoutFutures');
    const statuses = await Promise.all(agents.map(agent => agent.getStatusExtended()));

    res.json({
      success: true,
      data: statuses
    });
  } catch (error) {
    console.error('Error getting breakout futures status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get breakout futures status',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.getRealAgentMonitorStatus = async (req, res) => {
  try {
    const agents = getAgentManager().getAllAgents().filter(agent => agent.type === 'realAgentMonitor');
    const statuses = agents.map(agent => agent.getStatusExtended());

    res.json({
      success: true,
      data: statuses
    });
  } catch (error) {
    console.error('Error getting real agent monitor status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get real agent monitor status',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.getMeanReversionFuturesStatus = async (req, res) => {
  try {
    const agents = getAgentManager().getAllAgents().filter(agent => agent.type === 'meanReversionFutures');
    const statuses = await Promise.all(agents.map(agent => agent.getStatusExtended()));

    res.json({
      success: true,
      data: statuses
    });
  } catch (error) {
    console.error('Error getting mean-reversion futures status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get mean-reversion futures status',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Account-level real-money summary, pulled directly from Binance (not just this
 * app's local ledgers) so it reflects reality even if a position was closed by a
 * stop-loss or liquidation the app didn't directly initiate. Any section that fails
 * (e.g. no real credentials configured yet) is reported as unavailable rather than
 * failing the whole request.
 */
/**
 * Extracted 2026-09-01 so telegramNotifierAgent.js can build the same real summary
 * for its periodic digest without duplicating (and risking drifting out of sync
 * with) this logic — the Express handler below is now a thin wrapper around this.
 * @returns {Promise<Object>}
 */
async function buildRealMoneySummary() {
  const summary = {
    spot: null,
    spotError: null,
    futuresPositions: null,
    futuresPositionsError: null,
    futuresToday: null,
    futuresTodayError: null,
    // All-time history, derived fresh from Binance's own records every request — this
    // is what makes "last profit/last loss" survive a restart without a separate,
    // driftable cache: the underlying trade ledger and Binance's income history were
    // already persistent, this just summarizes them.
    futuresHistory: null,
    futuresHistoryError: null,
    pumpFun: null,
    pumpFunError: null,
    transferArbitrage: null,
    transferArbitrageError: null,
    culledAgents: [],
    usdInrRate: null,
    // Single headline number: every real-money source that reports a genuinely
    // REALIZED (closed-trade) P&L, summed. Binance spot DCA isn't included — its
    // P&L there is unrealized (still-held inventory), not a closed number, and
    // mixing realized + unrealized into one figure would misrepresent both.
    totalRealizedPnlUsd: 0,
    agents: []
  };

  const realAgents = getAgentManager().getAllAgents()
    .filter(a => ['binanceDca', 'binanceFuturesDca', 'breakoutFutures', 'meanReversionFutures'].includes(a.type));

  summary.agents = realAgents.map(a => ({
    id: a.id,
    type: a.type,
    state: a.state,
    haltedReason: a.haltedReason || null
  }));

  const spotDcaAgent = realAgents.find(a => a.type === 'binanceDca');
  if (spotDcaAgent) {
    try {
      const pnl = await realTradingService.computeUnrealizedPnl(spotDcaAgent.id, spotDcaAgent.config.symbol);
      summary.spot = { symbol: spotDcaAgent.config.symbol, ...pnl };
    } catch (error) {
      summary.spotError = error.message;
    }
  }

  try {
    summary.futuresPositions = await realFuturesTradingService.getOpenPositions();
  } catch (error) {
    summary.futuresPositionsError = error.message;
  }

  try {
    const [realizedPnl, commission] = await Promise.all([
      realFuturesTradingService.getTodaysRealizedPnlUsd(),
      realFuturesTradingService.getTodaysCommissionUsd()
    ]);
    summary.futuresToday = { realizedPnlUsd: realizedPnl, commissionUsd: commission };
  } catch (error) {
    summary.futuresTodayError = error.message;
  }

  try {
    summary.futuresHistory = await realFuturesTradingService.getTradeHistorySummary();
  } catch (error) {
    summary.futuresHistoryError = error.message;
  }

  try {
    summary.pumpFun = await pumpFunTradingService.getAllTimeSummary();
  } catch (error) {
    summary.pumpFunError = error.message;
  }

  try {
    summary.transferArbitrage = await transferArbPositionStore.getAllTimeSummary();
  } catch (error) {
    summary.transferArbitrageError = error.message;
  }

  try {
    summary.culledAgents = await agentCullService.getAllCulled();
  } catch (error) {
    // Non-fatal — the rest of the summary is still useful without it.
  }

  summary.totalRealizedPnlUsd =
    (summary.futuresHistory?.totalRealizedPnlUsd || 0) +
    (summary.pumpFun?.totalRealizedPnlUsd || 0) +
    (summary.transferArbitrage?.totalRealizedPnlUsd || 0);

  // Real USD/INR rate for the dashboard to show alongside every $ P&L figure —
  // cached server-side (currencyService.js), so this adds no real per-request cost.
  summary.usdInrRate = await currencyService.getUsdToInrRate().catch(() => null);

  return summary;
}

exports.buildRealMoneySummary = buildRealMoneySummary;

exports.getRealMoneySummary = async (req, res) => {
  const summary = await buildRealMoneySummary();
  res.json({ success: true, data: summary });
};

/**
 * ALL-TIME real activity feed: every futures trade (Binance's own income history),
 * every pump.fun trade, every transfer-arbitrage close, and every cull event, merged
 * into one chronological stream. Unlike getRealMoneySummary's per-strategy cards,
 * this is what actually answers "what has every agent been doing" as a single
 * timeline instead of separate aggregates — real events, not a fabricated activity
 * log (contrast walletService's simulated "earnings" transactions elsewhere).
 */
exports.getRealMoneyFeed = async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const events = [];

  try {
    const incomeEntries = await realFuturesTradingService.getIncomeHistory({ incomeType: 'REALIZED_PNL' });
    for (const e of incomeEntries) {
      events.push({
        source: 'futures',
        kind: parseFloat(e.income) >= 0 ? 'win' : 'loss',
        symbol: e.symbol,
        pnlUsd: parseFloat(e.income),
        time: new Date(parseInt(e.time)).toISOString(),
        description: `Binance futures ${e.symbol} closed ${parseFloat(e.income) >= 0 ? '+' : ''}$${parseFloat(e.income).toFixed(2)}`
      });
    }
  } catch (error) {
    // A down/unauthenticated Binance futures connection shouldn't block the other
    // three sources from showing up — this source is just omitted for this request.
  }

  try {
    const trades = await pumpFunTradingService.getAllTrades();
    for (const t of trades) {
      if (t.action === 'sell' && t.realizedPnlUsd != null) {
        events.push({
          source: 'pumpfun',
          kind: t.realizedPnlUsd >= 0 ? 'win' : 'loss',
          symbol: t.tokenMint,
          pnlUsd: t.realizedPnlUsd,
          time: new Date(t.timestamp).toISOString(),
          description: `pump.fun ${t.tokenMint.slice(0, 8)}... sold ${t.realizedPnlUsd >= 0 ? '+' : ''}$${t.realizedPnlUsd.toFixed(2)}`
        });
      } else if (t.action === 'buy' && t.status === 'confirmed') {
        events.push({
          source: 'pumpfun',
          kind: 'buy',
          symbol: t.tokenMint,
          pnlUsd: null,
          time: new Date(t.timestamp).toISOString(),
          description: `pump.fun bought ${t.tokenMint.slice(0, 8)}... for ${t.solAmount.toFixed(4)} SOL`
        });
      } else if (t.status === 'failed') {
        events.push({
          source: 'pumpfun',
          kind: 'failed',
          symbol: t.tokenMint,
          pnlUsd: null,
          time: new Date(t.timestamp).toISOString(),
          description: `pump.fun ${t.action} failed for ${t.tokenMint.slice(0, 8)}...`
        });
      }
    }
  } catch (error) {
    // Same non-fatal treatment as above.
  }

  try {
    const positions = await transferArbPositionStore.getAllPositions();
    for (const p of positions) {
      if (p.status === 'closed' && p.realizedPnlUsd != null) {
        events.push({
          source: 'transferArbitrage',
          kind: p.realizedPnlUsd >= 0 ? 'win' : 'loss',
          symbol: p.asset,
          pnlUsd: p.realizedPnlUsd,
          time: new Date(p.closedAt).toISOString(),
          description: `Transfer-arb ${p.asset} closed ${p.realizedPnlUsd >= 0 ? '+' : ''}$${p.realizedPnlUsd.toFixed(2)}`
        });
      }
    }
  } catch (error) {
    // Same non-fatal treatment as above.
  }

  try {
    const culled = await agentCullService.getAllCulled();
    for (const c of culled) {
      events.push({
        source: 'governor',
        kind: 'culled',
        symbol: c.symbol,
        pnlUsd: c.netRealizedPnlUsd ?? null,
        time: new Date(c.culledAt).toISOString(),
        description: `Performance governor permanently stopped ${c.type}${c.symbol ? ` (${c.symbol})` : ''}: ${c.reason}`
      });
    }
  } catch (error) {
    // Same non-fatal treatment as above.
  }

  events.sort((a, b) => new Date(b.time) - new Date(a.time));

  res.json({ success: true, data: events.slice(0, limit) });
};

// Both real SPL token program IDs pump.fun mints under — confirmed live 2026-09-01
// that relying on an agent's in-memory openPosition to know what's held is
// unreliable (it doesn't survive a restart, and a restart doesn't touch the
// blockchain), and that checking only the classic Token program missed real
// holdings under Token-2022. Reading token accounts directly from the chain can't
// go stale or get lost the way in-memory agent state can.
const SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const SPL_TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

/**
 * Real wallet balances — actual on-chain/exchange state, not anything this app
 * tracks itself, so this can never drift from reality (or get lost across a
 * restart) the way an internal ledger/in-memory position could. Solana comes
 * straight from the RPC (both native SOL and every SPL/Token-2022 token account
 * actually held); Binance from the account endpoint. Both read-only.
 */
async function buildRealWallets() {
  const wallets = { solana: null, solanaError: null, binance: null, binanceError: null };

  try {
    const { Connection, PublicKey } = require('@solana/web3.js');
    const keypair = pumpFunTradingService.getKeypair();
    const connection = pumpFunTradingService.getConnection();
    const owner = keypair.publicKey;

    // The USD price is deliberately NOT allowed to fail this whole lookup. It used to
    // sit bare inside this Promise.all, so a CoinGecko 429 (which happens routinely —
    // free tier, and this polls every 20s) rejected everything and the dashboard showed
    // NO wallet at all: no address, no SOL balance, no holdings. All of that is
    // readable straight from the chain and doesn't need a price. Now a missing price
    // just means the USD columns are null while the actual balances still show.
    const [freeSol, solPrice, tokenAccounts, token2022Accounts] = await Promise.all([
      pumpFunTradingService.getWalletBalanceSol(),
      pumpFunTradingService.getSolUsdPrice().catch(() => null),
      connection.getParsedTokenAccountsByOwner(owner, { programId: new PublicKey(SPL_TOKEN_PROGRAM_ID) }),
      connection.getParsedTokenAccountsByOwner(owner, { programId: new PublicKey(SPL_TOKEN_2022_PROGRAM_ID) })
    ]);

    const heldTokens = [...tokenAccounts.value, ...token2022Accounts.value]
      .map(({ account }) => account.data.parsed.info)
      .filter(info => parseFloat(info.tokenAmount.uiAmountString) > 0);

    const tokenHoldings = await Promise.all(heldTokens.map(async (t) => {
      try {
        const coinInfo = await pumpFunTradingService.getTokenInfo(t.mint);
        if (!coinInfo) {
          return { mint: t.mint, symbol: null, amount: parseFloat(t.tokenAmount.uiAmountString), usdValue: null, note: 'Not found on pump.fun (delisted, or never a real launch)' };
        }
        const uiSupply = coinInfo.total_supply / (10 ** t.tokenAmount.decimals);
        const pricePerToken = uiSupply > 0 ? coinInfo.usd_market_cap / uiSupply : 0;
        return {
          mint: t.mint,
          symbol: coinInfo.symbol,
          amount: parseFloat(t.tokenAmount.uiAmountString),
          usdValue: parseFloat(t.tokenAmount.uiAmountString) * pricePerToken
        };
      } catch (error) {
        return { mint: t.mint, symbol: null, amount: parseFloat(t.tokenAmount.uiAmountString), usdValue: null, note: error.message };
      }
    }));

    const tokenHoldingsUsd = tokenHoldings.reduce((sum, t) => sum + (t.usdValue || 0), 0);

    wallets.solana = {
      address: owner.toBase58(),
      freeSol,
      freeSolUsd: solPrice != null ? freeSol * solPrice : null,
      solPrice,
      priceUnavailable: solPrice == null,
      tokenHoldings,
      tokenHoldingsUsd,
      totalUsd: solPrice != null ? (freeSol * solPrice) + tokenHoldingsUsd : null
    };
  } catch (error) {
    wallets.solanaError = error.message;
    // Even on a hard failure (RPC down, etc.) the deposit address is derived locally
    // from the configured key and is always knowable — surface it regardless, so the
    // dashboard can always tell the user where to send funds.
    try {
      wallets.solanaAddress = pumpFunTradingService.getKeypair().publicKey.toBase58();
    } catch (_) { /* no key configured at all */ }
  }

  try {
    const usdtBalance = await realTradingService.getAssetBalance('USDT');
    wallets.binance = { usdtFree: usdtBalance };
  } catch (error) {
    wallets.binanceError = error.message;
  }

  return wallets;
}

exports.buildRealWallets = buildRealWallets;

exports.getRealWallets = async (req, res) => {
  const wallets = await buildRealWallets();
  res.json({ success: true, data: wallets });
};

/**
 * Manually close a real open futures position: cancels any stale open orders (e.g. a
 * stop-loss left over from a broken fill) for the symbol, then market-closes whatever
 * position remains with a reduce-only order. Attributed to whichever real futures
 * agent is running (falls back to 'manual' if none), so it still shows up in that
 * agent's ledger/budget accounting.
 */
/**
 * Manually open a REAL leveraged futures position — long or short — for a discretionary
 * call the automated agents wouldn't make on their own (none of the currently-running
 * strategies generate short signals; breakout/mean-reversion are retired and DCA is a
 * fixed long). Attributed to whichever real futures agent is running so it still counts
 * against that agent's budget cap (falls back to 'manual' if none is running, still
 * subject to the global cross-agent cap via assertLiveFuturesTradingAllowed/margin checks
 * inside openLeveragedLong/openLeveragedShort).
 */
exports.openFuturesPosition = async (req, res) => {
  try {
    const { symbol } = req.params;
    const { direction, marginUsd, leverage, marginMode, stopLossPct, takeProfitPct } = req.body;

    if (!symbol) {
      return res.status(400).json({ success: false, message: 'symbol is required' });
    }
    if (direction !== 'long' && direction !== 'short') {
      return res.status(400).json({ success: false, message: "direction must be 'long' or 'short'" });
    }
    if (!marginUsd || !leverage || !marginMode) {
      return res.status(400).json({ success: false, message: 'marginUsd, leverage, and marginMode are required' });
    }

    const futuresAgent = getAgentManager().getAllAgents()
      .find(a => ['binanceFuturesDca', 'breakoutFutures', 'meanReversionFutures'].includes(a.type));
    const agentId = futuresAgent ? futuresAgent.id : 'manual';

    // Automated agents size their own trades off this same check before calling
    // openLeveragedLong/Short — a manual open must respect it too, or it's a way to
    // silently blow past the global cross-agent exposure cap.
    const perAgentCapUsd = futuresAgent ? futuresAgent.config.budgetCapUsd : marginUsd;
    const budget = await realFuturesTradingService.getEffectiveRemainingBudgetUsd(agentId, perAgentCapUsd);
    if (marginUsd > budget.remaining) {
      return res.status(400).json({
        success: false,
        message: `Requested marginUsd ($${marginUsd}) exceeds remaining budget ($${budget.remaining.toFixed(2)})`,
        data: budget
      });
    }

    const openFn = direction === 'long'
      ? realFuturesTradingService.openLeveragedLong
      : realFuturesTradingService.openLeveragedShort;

    const result = await openFn({ symbol, marginUsd, leverage, marginMode, stopLossPct, takeProfitPct, agentId });

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error opening futures position:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to open futures position',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.closeFuturesPosition = async (req, res) => {
  try {
    const { symbol } = req.params;
    if (!symbol) {
      return res.status(400).json({ success: false, message: 'symbol is required' });
    }

    const futuresAgent = getAgentManager().getAllAgents()
      .find(a => ['binanceFuturesDca', 'breakoutFutures', 'meanReversionFutures'].includes(a.type));
    const agentId = futuresAgent ? futuresAgent.id : 'manual';

    const result = await realFuturesTradingService.closePosition(symbol, agentId);

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error closing futures position:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to close futures position',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Exposes the shared agent memory service (added 2026-09-01) — every scope's
// rolling win/loss stats plus its recent journal entries, for the dashboard's
// "agent memory" card and for anyone checking whether the memory-based throttles
// (see pumpFunSniperAgent.attemptBuy) have actually kicked in.
exports.getAgentMemory = async (req, res) => {
  try {
    const agentMemoryService = require('../../services/agentMemoryService');
    const snapshot = agentMemoryService.getAllScopesSnapshot();
    res.json({ success: true, data: snapshot });
  } catch (error) {
    console.error('Error getting agent memory:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get agent memory',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Real, self-built "best meme coin traders" leaderboard (2026-09-01) — see
// smartMoneyTrackerService.js for the full design. Read-only; this endpoint never
// triggers a trade or a follow, only reports what's already been observed/judged.
exports.getSmartMoneyLeaderboard = async (req, res) => {
  try {
    const smartMoneyTrackerService = require('../../services/smartMoneyTrackerService');
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    res.json({
      success: true,
      data: {
        // This app's own, self-built, on-chain-observed leaderboard — starts cold,
        // grows only from what the sniper itself has actually seen.
        diyLeaderboard: smartMoneyTrackerService.getLeaderboard(limit),
        stats: smartMoneyTrackerService.getStats(),
        pumpMultipleThreshold: smartMoneyTrackerService.PUMP_MULTIPLE_THRESHOLD,
        // Established, multi-year, real leaderboard from data.solanatracker.io —
        // empty until SOLANA_TRACKER_API_KEY is configured and the first refresh
        // completes (up to FETCH_MIN_INTERVAL_MS after that).
        establishedLeaderboard: smartMoneyTrackerService.getEstablishedLeaderboard(limit)
      }
    });
  } catch (error) {
    console.error('Error getting smart money leaderboard:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get smart money leaderboard',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.getOpportunityStats = async (req, res) => {
  try {
    const stats = OpportunityService.getOpportunityStats();

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error getting opportunity statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get opportunity statistics',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

module.exports = exports;
/**
 * How much SOL can be withdrawn right now, plus whether withdrawals are configured at
 * all. Read-only — safe to expose on the currently-public dashboard.
 */
exports.getWithdrawable = async (req, res) => {
  try {
    const info = await pumpFunTradingService.getWithdrawableSol();
    res.json({ success: true, data: info });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * REAL, IRREVERSIBLE SOL withdrawal to an address the caller supplies. Requires the
 * WITHDRAWAL_PIN secret in the body (enforced in pumpFunTradingService.withdrawSol) —
 * the dashboard currently runs without login, so this endpoint would otherwise be a
 * public drain on the wallet.
 */
exports.withdrawSolana = async (req, res) => {
  try {
    const { toAddress, amountSol, pin } = req.body;
    if (!toAddress) {
      return res.status(400).json({ success: false, message: 'toAddress is required' });
    }
    if (amountSol === undefined || amountSol === null || amountSol === '') {
      return res.status(400).json({ success: false, message: "amountSol is required (a number, or 'max')" });
    }
    const result = await pumpFunTradingService.withdrawSol({ toAddress, amountSol, pin });
    res.json({ success: true, data: result });
  } catch (error) {
    // 403 for the auth-shaped failures so the UI can tell "wrong PIN" apart from a
    // genuine execution problem; 400 for everything else the caller can correct.
    const isAuthFailure = /PIN/i.test(error.message);
    res.status(isAuthFailure ? 403 : 400).json({ success: false, message: error.message });
  }
};

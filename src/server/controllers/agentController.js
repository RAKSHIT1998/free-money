// Agent management controller
const AgentManager = require('../../agents/agentManager');
const OpportunityService = require('../../services/opportunityService');
const realTradingService = require('../../services/realTradingService');
const realFuturesTradingService = require('../../services/realFuturesTradingService');

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
      performance: agent.performance
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
exports.getRealMoneySummary = async (req, res) => {
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

  res.json({ success: true, data: summary });
};

/**
 * Manually close a real open futures position: cancels any stale open orders (e.g. a
 * stop-loss left over from a broken fill) for the symbol, then market-closes whatever
 * position remains with a reduce-only order. Attributed to whichever real futures
 * agent is running (falls back to 'manual' if none), so it still shows up in that
 * agent's ledger/budget accounting.
 */
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
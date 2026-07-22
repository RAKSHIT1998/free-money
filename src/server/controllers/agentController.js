// Agent management controller
const AgentManager = require('../../agents/agentManager');
const OpportunityService = require('../../services/opportunityService');

// Get agent manager instance
const agentManager = AgentManager.getInstance();

exports.getAllAgents = async (req, res) => {
  try {
    const agents = agentManager.getAllAgents();
    const agentData = agents.map(agent => ({
      id: agent.id,
      type: agent.type,
      state: agent.state,
      isRunning: agent.isRunning,
      createdAt: agent.createdAt,
      lastActive: agent.lastActive,
      performance: agent.performance
    }));

    const stats = agentManager.getStatistics();

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
    const agent = agentManager.getAgent(agentId);

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
    const { type, options } = req.body;

    if (!type) {
      return res.status(400).json({
        success: false,
        message: 'Agent type is required'
      });
    }

    const agent = await agentManager.spawnAgent(type, options);

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
    const result = await agentManager.removeAgent(agentId);

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

    const result = await agentManager.updateAgentConfig(agentId, config);

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
    const stats = agentManager.getStatistics();

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
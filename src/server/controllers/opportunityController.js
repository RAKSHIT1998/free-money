// Opportunity controller
const OpportunityService = require('../../services/opportunityService');

exports.getOpportunities = async (req, res) => {
  try {
    const filters = {
      type: req.query.type,
      status: req.query.status,
      search: req.query.search,
      limit: req.query.limit,
      offset: req.query.offset
    };

    // Remove undefined filters
    Object.keys(filters).forEach(key => {
      if (filters[key] === undefined || filters[key] === '') {
        delete filters[key];
      }
    });

    const opportunities = await OpportunityService.getOpportunities(filters);
    res.json({
      success: true,
      data: opportunities
    });
  } catch (error) {
    console.error('Error getting opportunities:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get opportunities',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.getOpportunityById = async (req, res) => {
  try {
    const opportunityId = req.params.id;
    const opportunity = await OpportunityService.getOpportunityById(opportunityId);

    if (!opportunity) {
      return res.status(404).json({
        success: false,
        message: 'Opportunity not found'
      });
    }

    res.json({
      success: true,
      data: opportunity
    });
  } catch (error) {
    console.error('Error getting opportunity by ID:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get opportunity',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.syncOpportunities = async (req, res) => {
  try {
    const opportunities = await OpportunityService.syncOpportunities();
    res.json({
      success: true,
      message: 'Opportunity sync completed successfully',
      data: opportunities
    });
  } catch (error) {
    console.error('Error syncing opportunities:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to sync opportunities',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.getOpportunityStats = async (req, res) => {
  try {
    const stats = await OpportunityService.getOpportunityStats();
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
const OpportunityService = require('../../services/opportunityService');

exports.getOpportunities = async (req, res) => {
  try {
    const filters = {};

    // Filter by type if provided
    if (req.query.type) {
      filters.type = req.query.type;
    }

    // Filter by status if provided
    if (req.query.status) {
      filters.status = req.query.status;
    }

    // Filter by keyword search in title/description
    if (req.query.search) {
      filters.search = req.query.search;
    }

    const opportunities = await OpportunityService.getOpportunities(filters);
    res.json({
      success: true,
      count: opportunities.length,
      data: opportunities
    });
  } catch (error) {
    console.error('Error fetching opportunities:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch opportunities',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.getOpportunityById = async (req, res) => {
  try {
    const opportunity = await OpportunityService.getOpportunityById(req.params.id);
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
    console.error('Error fetching opportunity:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch opportunity',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.syncOpportunities = async (req, res) => {
  try {
    // In production, you might want to protect this endpoint or make it a scheduled job
    const opportunities = await OpportunityService.syncOpportunities();
    res.json({
      success: true,
      message: `Successfully synced ${opportunities.length} opportunities`,
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
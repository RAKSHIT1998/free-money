// Opportunity routes
const express = require('express');
const router = express.Router();
const opportunityController = require('../controllers/opportunityController');

// Get all opportunities with optional filtering
router.get('/', opportunityController.getOpportunities);

// Get opportunity statistics (must be registered before '/:id' so 'stats' isn't
// parsed as an opportunity ID)
router.get('/stats', opportunityController.getOpportunityStats);

// Get specific opportunity by ID
router.get('/:id', opportunityController.getOpportunityById);

// Manually trigger opportunity synchronization (admin use)
router.post('/sync', opportunityController.syncOpportunities);

module.exports = router;
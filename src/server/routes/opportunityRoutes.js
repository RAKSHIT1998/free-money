// Opportunity routes
const express = require('express');
const router = express.Router();
const opportunityController = require('../controllers/opportunityController');

// Get all opportunities with optional filtering
router.get('/', opportunityController.getOpportunities);

// Get specific opportunity by ID
router.get('/:id', opportunityController.getOpportunityById);

// Manually trigger opportunity synchronization (admin use)
router.post('/sync', opportunityController.syncOpportunities);

// Get opportunity statistics
router.get('/stats', opportunityController.getOpportunityStats);

module.exports = router;
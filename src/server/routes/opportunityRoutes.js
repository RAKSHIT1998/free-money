const express = require('express');
const router = express.Router();
const opportunityController = require('../controllers/opportunityController');

// Get all opportunities with optional filtering
router.get('/', opportunityController.getOpportunities);

// Get opportunity by ID
router.get('/:id', opportunityController.getOpportunityById);

// Manual sync endpoint (for testing/admin)
router.post('/sync', opportunityController.syncOpportunities);

module.exports = router;
const express = require('express');
const router = express.Router();
const agentController = require('../controllers/agentController');

// Agent management routes
router.get('/', agentController.getAllAgents);
router.get('/:id', agentController.getAgentById);
router.post('/spawn', agentController.spawnAgent);
router.delete('/:id', agentController.terminateAgent);
router.put('/:id/config', agentController.updateAgentConfig);
router.get('/stats/agents', agentController.getAgentStatistics);
router.get('/stats/opportunities', agentController.getOpportunityStats);

module.exports = router;
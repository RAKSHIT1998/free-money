const express = require('express');
const router = express.Router();
const agentController = require('../controllers/agentController');

// Agent management routes
router.get('/', agentController.getAllAgents);
// Must be registered before '/:id' so 'real' isn't parsed as an agent ID.
router.get('/real/binance-dca', agentController.getBinanceDcaStatus);
router.get('/real/binance-earn', agentController.getBinanceEarnStatus);
router.get('/real/funding-rate-arbitrage', agentController.getFundingRateArbitrageStatus);
router.get('/real/binance-futures-dca', agentController.getBinanceFuturesDcaStatus);
router.get('/real/breakout-futures', agentController.getBreakoutFuturesStatus);
router.get('/real/mean-reversion-futures', agentController.getMeanReversionFuturesStatus);
router.get('/real/monitor', agentController.getRealAgentMonitorStatus);
router.get('/real/summary', agentController.getRealMoneySummary);
router.post('/real/futures/:symbol/close', agentController.closeFuturesPosition);
router.post('/real/futures/:symbol/open', agentController.openFuturesPosition);
router.get('/:id', agentController.getAgentById);
router.post('/spawn', agentController.spawnAgent);
router.delete('/:id', agentController.terminateAgent);
router.put('/:id/config', agentController.updateAgentConfig);
router.get('/stats/agents', agentController.getAgentStatistics);
router.get('/stats/opportunities', agentController.getOpportunityStats);

module.exports = router;
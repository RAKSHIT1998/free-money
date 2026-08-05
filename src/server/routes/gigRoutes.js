const express = require('express');
const router = express.Router();
const gigController = require('../controllers/gigController');

router.post('/drafts', gigController.createDraft);
router.get('/drafts', gigController.getDrafts);
router.put('/drafts/:id', gigController.updateDraft);
router.post('/drafts/:id/request-payment', gigController.requestPayment);
router.post('/drafts/:id/confirm-payment', gigController.confirmPayment);
router.post('/drafts/:id/request-crypto-payment', gigController.requestCryptoPayment);
router.post('/drafts/:id/check-crypto-payment', gigController.checkCryptoPayment);

module.exports = router;

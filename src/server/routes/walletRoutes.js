// Wallet routes
const express = require('express');
const router = express.Router();
const walletController = require('../controllers/walletController');
const authMiddleware = require('../middleware/auth');

// Wallet routes - all require authentication
router.get('/', authMiddleware.authenticateToken, walletController.getWallet);
router.post('/deposit', authMiddleware.authenticateToken, walletController.deposit);
router.post('/withdraw', authMiddleware.authenticateToken, walletController.withdraw);
router.post('/withdraw/crypto', authMiddleware.authenticateToken, walletController.withdrawCryptocurrency);
router.get('/deposit/address/:coin', authMiddleware.authenticateToken, walletController.getDepositAddress);
router.post('/paypal/create-order', authMiddleware.authenticateToken, walletController.createPayPalOrder);
router.post('/paypal/capture-payment', authMiddleware.authenticateToken, walletController.capturePayPalPayment);
router.get('/transactions', authMiddleware.authenticateToken, walletController.getTransactions);
router.post('/earnings', authMiddleware.authenticateToken, walletController.addEarnings);

module.exports = router;
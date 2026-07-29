// Wallet controller for handling wallet operations
const Wallet = require('../../models/Wallet');
const paymentService = require('../../services/paymentService');
const walletService = require('../../services/walletService');

/**
 * Get wallet balance and info for device/user
 */
exports.getWallet = async (req, res) => {
  try {
    // Use device ID from env (set in server.js) or fallback to demo user
    const userId = process.env.DEVICE_ID || 'demo-user';
    const wallet = await walletService.getOrCreateWallet(userId);

    // Calculate total balance in USD for backward compatibility
    const totalBalanceInUSD = walletService.getTotalBalanceInUSD(wallet);

    res.status(200).json({
      success: true,
      data: {
        userId: wallet.userId,
        balances: wallet.balances,
        totalBalanceInUSD,
        transactions: wallet.transactions,
        createdAt: wallet.createdAt,
        updatedAt: wallet.updatedAt
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching wallet',
      error: error.message
    });
  }
};

/**
 * Deposit funds into wallet
 */
exports.deposit = async (req, res) => {
  try {
    const { amount, currency = 'USD', description } = req.body;

    // Validate input
    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid amount greater than 0'
      });
    }

    const userId = process.env.DEVICE_ID || 'demo-user';
    let wallet = await walletService.getOrCreateWallet(userId);

    // Create transaction record
    const transaction = {
      type: 'deposit',
      amount: parseFloat(amount),
      currency: currency,
      description: description || 'Manual deposit'
    };

    // Add transaction to wallet
    wallet.transactions.push(transaction);
    // Update balance for the specific currency using the helper method
    wallet.addBalance(currency, parseFloat(amount));

    await walletService.saveWallet(wallet);

    res.status(200).json({
      success: true,
      message: 'Funds deposited successfully',
      data: wallet
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error depositing funds',
      error: error.message
    });
  }
};

/**
 * Withdraw funds from wallet (fiat currencies)
 */
exports.withdraw = async (req, res) => {
  try {
    const { amount, currency = 'USD', description } = req.body;

    // Validate input
    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid amount greater than 0'
      });
    }

    const userId = process.env.DEVICE_ID || 'demo-user';
    let wallet = await walletService.getOrCreateWallet(userId);

    // Check sufficient balance in the specific currency
    const currentBalance = wallet.getBalance(currency);
    if (currentBalance < amount) {
      return res.status(400).json({
        success: false,
        message: `Insufficient ${currency} funds`
      });
    }

    // Create transaction record
    const transaction = {
      type: 'withdrawal',
      amount: parseFloat(amount),
      currency: currency,
      description: description || 'Manual withdrawal'
    };

    // Add transaction to wallet
    wallet.transactions.push(transaction);
    // Update balance for the specific currency using the helper method
    wallet.subtractBalance(currency, parseFloat(amount));

    await walletService.saveWallet(wallet);

    res.status(200).json({
      success: true,
      message: 'Funds withdrawn successfully',
      data: wallet
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error withdrawing funds',
      error: error.message
    });
  }
};

/**
 * Add earnings to wallet (used by agents when they earn money)
 */
exports.addEarnings = async (req, res) => {
  try {
    const { amount, currency = 'USD', description, opportunityId, agentId } = req.body;

    // Validate input
    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid amount greater than 0'
      });
    }

    const userId = process.env.DEVICE_ID || 'demo-user';
    let wallet = await walletService.getOrCreateWallet(userId);

    // If wallet doesn't exist, create it
    if (!wallet) {
      wallet = new Wallet({ userId });
    }

    // Create transaction record
    const transaction = {
      type: 'earning',
      amount: parseFloat(amount),
      currency: currency,
      description: description || 'Earnings from agent activity',
      ...(opportunityId && { opportunityId }),
      ...(agentId && { agentId })
    };

    // Add transaction to wallet
    wallet.transactions.push(transaction);
    // Update balance for the specific currency using the helper method
    wallet.addBalance(currency, parseFloat(amount));

    await walletService.saveWallet(wallet);

    res.status(200).json({
      success: true,
      message: 'Earnings added successfully',
      data: wallet
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error adding earnings',
      error: error.message
    });
  }
};

/**
 * Withdraw cryptocurrency from wallet
 */
exports.withdrawCryptocurrency = async (req, res) => {
  try {
    const { amount, currency, destinationAddress, description, opportunityId, agentId } = req.body;

    // Validate input
    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid amount greater than 0'
      });
    }

    if (!currency) {
      return res.status(400).json({
        success: false,
        message: 'Please specify a cryptocurrency (e.g., BTC, ETH, BNB)'
      });
    }

    if (!destinationAddress) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a destination address'
      });
    }

    // Import walletService locally to avoid potential issues
    const walletServiceLocal = require('../../services/walletService');

    const userId = process.env.DEVICE_ID || 'demo-user';

    let wallet = await walletServiceLocal.getOrCreateWallet(userId);

    // If wallet doesn't exist, create it
    if (!wallet) {
      wallet = new Wallet({ userId });
    }

    // Check if cryptocurrency is supported
    if (!walletServiceLocal.cryptoCurrencyConfig || !walletServiceLocal.cryptoCurrencyConfig.isCoinSupported(currency)) {
      return res.status(400).json({
        success: false,
        message: `Unsupported cryptocurrency: ${currency}. Supported currencies: ${walletServiceLocal.cryptoCurrencyConfig?.supportedCoins?.join(', ') || 'BTC, ETH, BNB, USDT, USDC'}`
      });
    }

    // Withdraw cryptocurrency
    const result = await walletServiceLocal.withdrawCryptocurrency(
      amount,
      currency,
      destinationAddress,
      description,
      opportunityId,
      agentId
    );

    if (result.success) {
      res.status(200).json({
        success: true,
        message: `Cryptocurrency withdrawal successful`,
        data: result
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'Cryptocurrency withdrawal failed',
        error: result.error
      });
    }
  } catch (error) {
    console.error('Error in withdrawCryptocurrency:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing cryptocurrency withdrawal',
      error: error.message
    });
  }
};

/**
 * Get transaction history
 */
exports.getTransactions = async (req, res) => {
  try {
    const userId = process.env.DEVICE_ID || 'demo-user';
    const wallet = await walletService.getOrCreateWallet(userId);

    if (!wallet) {
      return res.status(200).json({
        success: true,
        data: [] // No transactions if wallet doesn't exist
      });
    }

    // Sort transactions by timestamp descending (newest first)
    const sortedTransactions = wallet.transactions
      .slice()
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.status(200).json({
      success: true,
      data: sortedTransactions
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching transaction history',
      error: error.message
    });
  }
};

/**
 * Create a PayPal payment order
 */
exports.createPayPalOrder = async (req, res) => {
  try {
    const { amount, currency = 'USD', description } = req.body;

    // Validate input
    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid amount greater than 0'
      });
    }

    // Create PayPal payment order
    const paymentService = require('../../services/paymentService');
    const payment = await paymentService.createPaymentIntent(
      amount,
      currency,
      description || 'Payment to wallet'
    );

    res.status(200).json({
      success: true,
      message: 'PayPal order created successfully',
      data: payment
    });
  } catch (error) {
    console.error('Error creating PayPal order:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating PayPal order',
      error: error.message
    });
  }
};

/**
 * Capture a PayPal payment
 */
exports.capturePayPalPayment = async (req, res) => {
  try {
    const { orderId, paymentMethodId } = req.body;

    // Validate input
    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid order ID'
      });
    }

    // Capture PayPal payment
    const paymentService = require('../../services/paymentService');
    const payment = await paymentService.verifyPayment(orderId, {
      payment_method_id: paymentMethodId
    });

    if (payment.status === 'COMPLETED' || payment.status === 'succeeded') {
      // Add funds to wallet
      const userId = process.env.DEVICE_ID || 'demo-user';
      let wallet = await walletService.getOrCreateWallet(userId);

      // If wallet doesn't exist, create it
      if (!wallet) {
        wallet = new Wallet({ userId });
      }

      // Create transaction record
      const transaction = {
        type: 'deposit',
        amount: payment.amount,
        currency: 'USD', // Assuming PayPal payments are in USD
        description: `PayPal payment ${orderId}`
      };

      // Add transaction to wallet
      wallet.transactions.push(transaction);
      // Update balance for the specific currency using the helper method
      wallet.addBalance('USD', parseFloat(payment.amount));

      await walletService.saveWallet(wallet);

      res.status(200).json({
        success: true,
        message: 'PayPal payment captured and funds added to wallet',
        data: {
          wallet: wallet,
          payment: payment
        }
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'PayPal payment not completed',
        data: payment
      });
    }
  } catch (error) {
    console.error('Error capturing PayPal payment:', error);
    res.status(500).json({
      success: false,
      message: 'Error capturing PayPal payment',
      error: error.message
    });
  }
};
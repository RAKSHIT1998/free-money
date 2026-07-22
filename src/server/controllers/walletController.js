// Wallet controller for handling wallet operations
const Wallet = require('../../models/Wallet');

/**
 * Get wallet balance and info for device/user
 */
exports.getWallet = async (req, res) => {
  try {
    // Use device ID from env (set in server.js) or fallback to demo user
    const userId = process.env.DEVICE_ID || 'demo-user';
    let wallet = await Wallet.findOne({ userId });

    // If wallet doesn't exist, create a default one
    if (!wallet) {
      wallet = new Wallet({ userId });
      await wallet.save();
    }

    res.status(200).json({
      success: true,
      data: wallet
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
    const { amount, description } = req.body;

    // Validate input
    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid amount greater than 0'
      });
    }

    const userId = process.env.DEVICE_ID || 'demo-user';
    let wallet = await Wallet.findOne({ userId });

    // If wallet doesn't exist, create it
    if (!wallet) {
      wallet = new Wallet({ userId });
    }

    // Create transaction record
    const transaction = {
      type: 'deposit',
      amount: parseFloat(amount),
      description: description || 'Manual deposit'
    };

    // Add transaction to wallet
    wallet.transactions.push(transaction);
    // Update balance
    wallet.balance += parseFloat(amount);

    await wallet.save();

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
 * Withdraw funds from wallet
 */
exports.withdraw = async (req, res) => {
  try {
    const { amount, description } = req.body;

    // Validate input
    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid amount greater than 0'
      });
    }

    const userId = process.env.DEVICE_ID || 'demo-user';
    let wallet = await Wallet.findOne({ userId });

    // If wallet doesn't exist or has insufficient balance
    if (!wallet || wallet.balance < amount) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient funds'
      });
    }

    // Create transaction record
    const transaction = {
      type: 'withdrawal',
      amount: parseFloat(amount),
      description: description || 'Manual withdrawal'
    };

    // Add transaction to wallet
    wallet.transactions.push(transaction);
    // Update balance
    wallet.balance -= parseFloat(amount);

    await wallet.save();

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
 * Get transaction history
 */
exports.getTransactions = async (req, res) => {
  try {
    const userId = process.env.DEVICE_ID || 'demo-user';
    const wallet = await Wallet.findOne({ userId });

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
 * Add earnings to wallet (used by agents when they earn money)
 */
exports.addEarnings = async (req, res) => {
  try {
    const { amount, description, opportunityId, agentId } = req.body;

    // Validate input
    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid amount greater than 0'
      });
    }

    const userId = process.env.DEVICE_ID || 'demo-user';
    let wallet = await Wallet.findOne({ userId });

    // If wallet doesn't exist, create it
    if (!wallet) {
      wallet = new Wallet({ userId });
    }

    // Create transaction record
    const transaction = {
      type: 'earning',
      amount: parseFloat(amount),
      description: description || 'Earnings from agent activity',
      ...(opportunityId && { opportunityId }),
      ...(agentId && { agentId })
    };

    // Add transaction to wallet
    wallet.transactions.push(transaction);
    // Update balance
    wallet.balance += parseFloat(amount);

    await wallet.save();

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

module.exports = exports;
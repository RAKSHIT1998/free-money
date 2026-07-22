// Wallet service for handling wallet operations
const Wallet = require('../models/Wallet');

/**
 * Get or create a wallet for the device/user
 * @param {string} userId - The user ID (defaults to device ID or demo user)
 * @returns {Promise<Object>} Wallet document
 */
async function getOrCreateWallet(userId) {
  let wallet = await Wallet.findOne({ userId });
  if (!wallet) {
    wallet = new Wallet({ userId });
    await wallet.save();
  }
  return wallet;
}

/**
 * Add earnings to the wallet
 * @param {number} amount - Amount to add
 * @param {string} description - Description of the earnings
 * @param {string} opportunityId - Optional opportunity ID
 * @param {string} agentId - Optional agent ID
 * @returns {Promise<Object>} Updated wallet
 */
async function addEarnings(amount, description, opportunityId, agentId) {
  try {
    const userId = process.env.DEVICE_ID || 'demo-user';
    let wallet = await getOrCreateWallet(userId);

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
    return wallet;
  } catch (error) {
    console.error('Error adding earnings to wallet:', error);
    throw error;
  }
}

module.exports = {
  addEarnings
};
// Wallet service for handling wallet operations
const Wallet = require('../models/Wallet');
const { Config } = require('../config/config');
const fs = require('fs');
const path = require('path');

const config = new Config();
const persistenceEnabled = config.get('agentManager.persistenceEnabled', true);
const walletFilePath = path.join(process.cwd(), 'wallet.json');

/**
 * Load wallet from file storage
 * @param {string} userId - The user ID
 * @returns {Promise<Object>} Wallet object
 */
async function loadWalletFromFile(userId) {
  try {
    if (fs.existsSync(walletFilePath)) {
      const data = fs.readFileSync(walletFilePath, 'utf8');
      const walletData = JSON.parse(data);
      // Find wallet for this user
      let wallet = walletData.wallets.find(w => w.userId === userId);
      if (!wallet) {
        wallet = { userId, balance: 0, transactions: [], _id: new Date().getTime().toString() };
        walletData.wallets.push(wallet);
        await saveWalletFile(walletData);
      }
      return wallet;
    } else {
      // Create initial wallet structure
      const initialData = {
        wallets: [
          { userId, balance: 0, transactions: [], _id: new Date().getTime().toString() }
        ]
      };
      await saveWalletFile(initialData);
      return initialData.wallets[0];
    }
  } catch (error) {
    console.error('Error loading wallet from file:', error);
    // Fallback to in-memory wallet
    return { userId, balance: 0, transactions: [], _id: new Date().getTime().toString() };
  }
}

/**
 * Save wallet data to file
 * @param {Object} walletData - Wallet data to save
 * @returns {Promise<void>}
 */
async function saveWalletFile(walletData) {
  try {
    const data = JSON.stringify(walletData, null, 2);
    fs.writeFileSync(walletFilePath, data, 'utf8');
  } catch (error) {
    console.error('Error saving wallet to file:', error);
    throw error;
  }
}

/**
 * Get or create a wallet for the device/user
 * @param {string} userId - The user ID (defaults to device ID or demo user)
 * @returns {Promise<Object>} Wallet document
 */
async function getOrCreateWallet(userId) {
  if (!persistenceEnabled) {
    return await loadWalletFromFile(userId);
  }

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
    let wallet;

    if (!persistenceEnabled) {
      // Load wallet from file
      wallet = await loadWalletFromFile(userId);

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

      // Save updated wallet data
      // Read current data, update the specific wallet, then write back
      let walletData = { wallets: [] };
      if (fs.existsSync(walletFilePath)) {
        const data = fs.readFileSync(walletFilePath, 'utf8');
        walletData = JSON.parse(data);
      }
      // Find and update the wallet
      const walletIndex = walletData.wallets.findIndex(w => w.userId === userId);
      if (walletIndex >= 0) {
        walletData.wallets[walletIndex] = wallet;
      } else {
        walletData.wallets.push(wallet);
      }
      await saveWalletFile(walletData);
    } else {
      // Use MongoDB
      wallet = await getOrCreateWallet(userId);

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
    }
    return wallet;
  } catch (error) {
    console.error('Error adding earnings to wallet:', error);
    throw error;
  }
}

module.exports = {
  addEarnings
};
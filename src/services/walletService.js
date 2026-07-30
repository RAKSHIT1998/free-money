// Wallet service for handling wallet operations
const Wallet = require('../models/Wallet');
const { Config } = require('../config/config');
const { cryptoCurrencyConfig } = require('../config/cryptocurrency');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto'); // For generating transaction IDs in simulation mode
const axios = require('axios'); // For Binance API calls

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
      let walletData;
      try {
        walletData = JSON.parse(data);
      } catch (parseError) {
        console.warn('Wallet file contains invalid JSON, initializing with empty wallets array');
        walletData = { wallets: [] };
      }
      // Find wallet for this user
      let wallet = walletData.wallets.find(w => w.userId === userId);
      if (!wallet) {
        wallet = {
          userId,
          balances: {},
          transactions: [],
          _id: new Date().getTime().toString()
        };
        walletData.wallets.push(wallet);
        await saveWalletFile(walletData);
      }
      // Add wallet helper methods
      wallet.getBalance = function(currency) {
        return this.balances.get ? this.balances.get(currency) || 0 : this.balances[currency] || 0;
      };

      wallet.addBalance = function(currency, amount) {
        const current = this.getBalance(currency);
        if (this.balances.get) {
          this.balances.set(currency, current + amount);
        } else {
          this.balances[currency] = current + amount;
        }
      };

      wallet.subtractBalance = function(currency, amount) {
        const current = this.getBalance(currency);
        if (current < amount) {
          throw new Error(`Insufficient funds in ${currency}`);
        }
        if (this.balances.get) {
          this.balances.set(currency, current - amount);
        } else {
          this.balances[currency] = current - amount;
        }
      };

      return wallet;
    } else {
      // Create initial wallet structure
      const initialData = {
        wallets: [
          { userId, balances: {}, transactions: [], _id: new Date().getTime().toString() }
        ]
      };
      await saveWalletFile(initialData);

      // Add wallet helper methods to the new wallet
      const wallet = initialData.wallets[0];
      wallet.getBalance = function(currency) {
        return this.balances.get ? this.balances.get(currency) || 0 : this.balances[currency] || 0;
      };

      wallet.addBalance = function(currency, amount) {
        const current = this.getBalance(currency);
        if (this.balances.get) {
          this.balances.set(currency, current + amount);
        } else {
          this.balances[currency] = current + amount;
        }
      };

      wallet.subtractBalance = function(currency, amount) {
        const current = this.getBalance(currency);
        if (current < amount) {
          throw new Error(`Insufficient funds in ${currency}`);
        }
        if (this.balances.get) {
          this.balances.set(currency, current - amount);
        } else {
          this.balances[currency] = current - amount;
        }
      };

      return wallet;
    }
  } catch (error) {
    console.error('Error loading wallet from file:', error);
    // Fallback to in-memory wallet with methods
    const wallet = { userId, balances: {}, transactions: [], _id: new Date().getTime().toString() };
    wallet.getBalance = function(currency) {
      return this.balances.get ? this.balances.get(currency) || 0 : this.balances[currency] || 0;
    };

    wallet.addBalance = function(currency, amount) {
      const current = this.getBalance(currency);
      if (this.balances.get) {
        this.balances.set(currency, current + amount);
      } else {
        this.balances[currency] = current + amount;
      }
    };

    wallet.subtractBalance = function(currency, amount) {
      const current = this.getBalance(currency);
      if (current < amount) {
        throw new Error(`Insufficient funds in ${currency}`);
      }
      if (this.balances.get) {
        this.balances.set(currency, current - amount);
      } else {
        this.balances[currency] = current - amount;
      }
    };

    return wallet;
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
 * @param {string} currency - Currency code (USD, BTC, ETH, etc.)
 * @param {string} description - Description of the earnings
 * @param {string} opportunityId - Optional opportunity ID
 * @param {string} agentId - Optional agent ID
 * @returns {Promise<Object>} Updated wallet
 */
async function addEarnings(amount, currency = 'USD', description, opportunityId, agentId) {
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
        currency: currency,
        description: description || 'Earnings from agent activity',
        ...(opportunityId && { opportunityId }),
        ...(agentId && { agentId })
      };

      // Add transaction to wallet
      wallet.transactions.push(transaction);
      // Update balance for the specific currency
      const currentBalance = wallet.balances[currency] || 0;
      wallet.balances[currency] = currentBalance + parseFloat(amount);

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
        currency: currency,
        description: description || 'Earnings from agent activity',
        ...(opportunityId && { opportunityId }),
        ...(agentId && { agentId })
      };

      // Add transaction to wallet
      wallet.transactions.push(transaction);
      // Update balance for the specific currency using the helper method
      wallet.addBalance(currency, parseFloat(amount));

      await wallet.save();
    }
    return wallet;
  } catch (error) {
    console.error('Error adding earnings to wallet:', error);
    throw error;
  }
}

/**
 * Get total balance in USD equivalent
 * @param {Object} wallet - Wallet object
 * @returns {number} Total balance in USD
 */
function getTotalBalanceInUSD(wallet) {
  let totalUSD = 0;

  // Add fiat balance (USD)
  const usdBalance = wallet.balances?.['USD'] || 0;
  totalUSD += usdBalance;

  // Add crypto balances converted to USD
  const supportedCoins = ['BTC', 'ETH', 'BNB', 'USDT', 'USDC'];
  for (const coin of supportedCoins) {
    const coinBalance = wallet.balances?.[coin] || 0;
    if (coinBalance > 0) {
      const usdPerCoin = cryptoCurrencyConfig.getUsdPerCoin(coin);
      totalUSD += coinBalance * usdPerCoin;
    }
  }

  return totalUSD;
}

/**
 * Withdraw funds via cryptocurrency
 * @param {number} amountUsd - Amount to withdraw in USD
 * @param {string} cryptoCurrency - Cryptocurrency to withdraw (BTC, ETH, BNB, etc.)
 * @param {string} destinationAddress - Destination wallet address
 * @param {string} description - Description of the withdrawal
 * @param {string} opportunityId - Optional opportunity ID
 * @param {string} agentId - Optional agent ID
 * @returns {Promise<Object>} Result of the withdrawal
 */
async function withdrawCryptocurrency(amountUsd, cryptoCurrency, destinationAddress, description, opportunityId, agentId) {
  try {
    const userId = process.env.DEVICE_ID || 'demo-user';

    // Validate inputs
    if (!amountUsd || amountUsd <= 0) {
      throw new Error('Please provide a valid amount greater than 0');
    }

    if (!cryptoCurrency || !cryptoCurrencyConfig.isCoinSupported(cryptoCurrency)) {
      throw new Error(`Unsupported cryptocurrency: ${cryptoCurrency}`);
    }

    if (!destinationAddress) {
      throw new Error('Destination address is required');
    }

    // Check if cryptocurrency features are enabled
    const cryptoConfig = config.get('cryptocurrency');
    if (!cryptoConfig || !cryptoConfig.enabled) {
      throw new Error('Cryptocurrency features are disabled');
    }

    // Check minimum withdrawal amount (in USD)
    const minWithdrawalUsd = cryptoCurrencyConfig.getMinWithdrawalAmount(cryptoCurrency);
    if (amountUsd < minWithdrawalUsd) {
      throw new Error(`Minimum withdrawal amount for ${cryptoCurrency} is $${minWithdrawalUsd}`);
    }

    // Get wallet
    let wallet;
    if (!persistenceEnabled) {
      wallet = await loadWalletFromFile(userId);
    } else {
      wallet = await getOrCreateWallet(userId);
    }

    // Check sufficient balance in the specific cryptocurrency
    const cryptoBalance = wallet.balances?.[cryptoCurrency] || 0;
    if (cryptoBalance <= 0) {
      throw new Error(`Insufficient ${cryptoCurrency} balance`);
    }

    // Convert USD amount to cryptocurrency amount
    const usdPerCoin = cryptoCurrencyConfig.getUsdPerCoin(cryptoCurrency);
    const cryptoAmountNeeded = amountUsd / usdPerCoin;

    if (cryptoBalance < cryptoAmountNeeded) {
      throw new Error(`Insufficient ${cryptoCurrency} balance. Have ${cryptoBalance}, need ${cryptoAmountNeeded}`);
    }

    // Get transaction fee (in USD)
    const feeUsd = cryptoCurrencyConfig.getTransactionFee(cryptoCurrency);
    const feeInCrypto = feeUsd / usdPerCoin;
    const totalDeductionInCrypto = cryptoAmountNeeded + feeInCrypto;

    if (cryptoBalance < totalDeductionInCrypto) {
      throw new Error(`Insufficient funds to cover withdrawal amount (${cryptoAmountNeeded} ${cryptoCurrency}) and transaction fee (${feeInCrypto} ${cryptoCurrency})`);
    }

    // Process withdrawal based on mode
    let transactionId;
    let transactionStatus = 'pending';
    let transactionDetails = {};

    // Check if we're in simulation mode
    const simulationMode = cryptoConfig.simulation.enabled;

    if (simulationMode) {
      // Simulate cryptocurrency transaction
      await new Promise(resolve => setTimeout(resolve, cryptoConfig.simulation.delayMs));

      // Simulate success/failure based on success rate
      const isSuccessful = Math.random() < cryptoConfig.simulation.successRate;

      if (isSuccessful) {
        // Generate a mock transaction ID
        transactionId = `tx_${crypto.randomBytes(12).toString('hex')}`;
        transactionStatus = 'completed';
        transactionDetails = {
          transactionId,
          amount: amountUsd,
          currency: cryptoCurrency,
          cryptoAmount: parseFloat(cryptoAmountNeeded.toFixed(8)), // 8 decimal places for crypto
          destinationAddress,
          fee: feeUsd,
          feeCoin: parseFloat(feeInCrypto.toFixed(8)),
          totalDeductedUsd: amountUsd + feeUsd,
          totalDeductedCrypto: parseFloat(totalDeductionInCrypto.toFixed(8)),
          timestamp: new Date().toISOString(),
          status: 'confirmed',
          confirmations: Math.floor(Math.random() * 6) + 1 // 1-6 confirmations
        };
      } else {
        transactionStatus = 'failed';
        transactionDetails = {
          error: 'Simulated transaction failure',
          timestamp: new Date().toISOString()
        };
      }
    } else {
      // LIVE IMPLEMENTATION: Use Binance API for actual cryptocurrency withdrawal
      try {
        // Prepare Binance API request
        const timestamp = Date.now();
        const queryString = `asset=${cryptoCurrency}&amount=${cryptoAmountNeeded}&address=${destinationAddress}&timestamp=${timestamp}`;

        // Create signature
        const crypto = require('crypto');
        const signature = crypto.createHmac('sha256', process.env.BINANCE_API_SECRET)
                              .update(queryString)
                              .digest('hex');

        // Make withdrawal request to Binance
        const response = await axios.post(
          'https://api.binance.com/sapi/v1/capital/withdraw/apply',
          `${queryString}&signature=${signature}`,
          {
            headers: {
              'X-MBX-APIKEY': process.env.BINANCE_API_KEY,
              'Content-Type': 'application/x-www-form-urlencoded'
            }
          }
        );

        if (response.data && response.data.id) {
          transactionId = response.data.id;
          transactionStatus = 'processing'; // Binance returns processing initially
          transactionDetails = {
            id: response.data.id,
            coin: response.data.coin,
            address: response.data.address,
            amount: response.data.amount,
            transactionFee: response.data.transactionFee,
            confirmNo: response.data.confirmNo || '',
            txId: response.data.txId || '',
            status: response.data.status, // 0:Email Sent, 1:Cancelled, 2:Awaiting Approval, 3:Rejected, 4:Processing, 5:Failure, 6:Completed
            applyTime: response.data.applyTime,
            network: response.data.network,
            transferType: response.data.transferType || 0,
            info: response.data.info || {}
          };

          // For successful submission, we'll consider it pending until confirmed
          // In a production system, you'd want to poll for status updates
        } else {
          throw new Error('Invalid response from Binance API');
        }
      } catch (binanceError) {
        throw new Error(`Binance withdrawal failed: ${binanceError.response?.data?.msg || binanceError.message}`);
      }
    }

    // If transaction was successful, update wallet balance
    if (transactionStatus === 'completed') {
      if (!persistenceEnabled) {
        // File-based storage
        // Deduct from wallet balance (in cryptocurrency)
        const currentCryptoBalance = wallet.balances[cryptoCurrency] || 0;
        wallet.balances[cryptoCurrency] = currentCryptoBalance - totalDeductionInCrypto;

        // Create transaction record
        const transactionRecord = {
          type: 'withdrawal',
          amount: amountUsd,
          currency: 'USD', // Withdrawal amount is denominated in USD
          description: description || `Withdrawal of ${amountUsd} ${cryptoCurrency} to ${destinationAddress}`,
          ...(opportunityId && { opportunityId }),
          ...(agentId && { agentId })
        };

        wallet.transactions.push(transactionRecord);

        // Save updated wallet data
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
        // MongoDB storage
        wallet = await getOrCreateWallet(userId);

        // Deduct from wallet balance (in cryptocurrency) using helper method
        wallet.subtractBalance(cryptoCurrency, totalDeductionInCrypto);

        // Create transaction record
        const transactionRecord = {
          type: 'withdrawal',
          amount: amountUsd,
          currency: 'USD', // Withdrawal amount is denominated in USD
          description: description || `Withdrawal of ${amountUsd} ${cryptoCurrency} to ${destinationAddress}`,
          ...(opportunityId && { opportunityId }),
          ...(agentId && { agentId })
        };

        // Add transaction to wallet
        wallet.transactions.push(transactionRecord);

        await wallet.save();
      }
    }

    // Return result
    let result = {
      success: transactionStatus === 'completed',
      transactionId,
      status: transactionStatus,
      amount: amountUsd,
      currency: cryptoCurrency,
      cryptoAmount: parseFloat(cryptoAmountNeeded.toFixed(8)),
      destinationAddress,
      fee: feeUsd,
      feeCoin: parseFloat(feeInCrypto.toFixed(8)),
      totalDeductedUsd: amountUsd + feeUsd,
      totalDeductedCrypto: parseFloat(totalDeductionInCrypto.toFixed(8))
    };

    if (transactionStatus === 'completed') {
      result = {
        ...result,
        newBalance: {
          [cryptoCurrency]: wallet.balances?.[cryptoCurrency] || 0,
          ...(wallet.balances && Object.fromEntries(
            Object.entries(wallet.balances).filter(([key]) => key !== cryptoCurrency)
          ))
        },
        totalBalanceInUSD: getTotalBalanceInUSD(wallet),
        transaction: transactionDetails
      };
    } else {
      result = {
        ...result,
        error: transactionDetails.error || 'Transaction failed'
      };
    }

    return result;
  } catch (error) {
    console.error('Error processing cryptocurrency withdrawal:', error);
    throw error;
  }
}

// Export functions
module.exports = {
  addEarnings,
  getOrCreateWallet,
  getTotalBalanceInUSD,
  withdrawCryptocurrency,
  saveWallet: async (wallet) => {
    const userId = process.env.DEVICE_ID || 'demo-user';

    if (!persistenceEnabled) {
      // File-based storage
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
      // MongoDB storage
      await wallet.save();
    }
  }
};
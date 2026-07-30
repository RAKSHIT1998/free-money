// Withdraw cryptocurrency from the wallet
// Edit the values below before running
const AMOUNT_USD = 10; // Amount to withdraw in USD
const CRYPTO_CURRENCY = 'BTC'; // Cryptocurrency to withdraw (BTC, ETH, BNB, USDT, USDC)
const DESTINATION_ADDRESS = 'YOUR_DEPOSIT_ADDRESS_HERE'; // Replace with your deposit address from Binance or other wallet

// Load environment variables (already done by dotenv in server.js, but we need to load them for this script)
require('dotenv').config();

// Import required modules
const { Config } = require('./src/config/config');
const { cryptoCurrencyConfig } = require('./src/config/cryptocurrency');
const walletService = require('./src/services/walletService');

// Initialize config
const config = new Config();

// Check if cryptocurrency features are enabled
const cryptoConfig = config.get('cryptocurrency');
if (!cryptoConfig || !cryptoConfig.enabled) {
  console.error('Cryptocurrency features are disabled in config. Set CRYPTO_ENABLED=true in .env');
  process.exit(1);
}

// Check if the specified cryptocurrency is supported
if (!cryptoCurrencyConfig.isCoinSupported(CRYPTO_CURRENCY)) {
  console.error(`Cryptocurrency ${CRYPTO_CURRENCY} is not supported. Supported coins: ${cryptoCurrencyConfig.supportedCoins.join(', ')}`);
  process.exit(1);
}

// Check if Binance is enabled (if using Binance)
const binanceConfig = config.get('cryptocurrency.wallets.binance');
if (!binanceConfig || !binanceConfig.enabled) {
  console.warn('Binance wallet is disabled. Withdrawal may fail if Binance is the only enabled wallet.');
}

// Get user ID from environment (same as used in the server)
const userId = process.env.DEVICE_ID || 'demo-user';

async function withdraw() {
  try {
    console.log(`Attempting to withdraw $${AMOUNT_USD} worth of ${CRYPTO_CURRENCY} to address: ${DESTINATION_ADDRESS}`);

    // First, let's check the wallet balance
    let wallet;
    if (!config.get('agentManager.persistenceEnabled')) {
      // File-based storage
      wallet = await walletService.loadWalletFromFile(userId);
    } else {
      // MongoDB storage
      wallet = await walletService.getOrCreateWallet(userId);
    }

    const usdBalance = walletService.getTotalBalanceInUSD(wallet);
    console.log(`Current wallet balance: $${usdUSD.toFixed(2)}`);

    // Check if we have enough balance in the specific cryptocurrency (converted to USD)
    const cryptoBalance = wallet.balances[CRYPTO_CURRENCY] || 0;
    const usdPerCoin = cryptoCurrencyConfig.getUsdPerCoin(CRYPTO_CURRENCY);
    const cryptoValueInUsd = cryptoBalance * usdPerCoin;

    console.log(`Current ${CRYPTO_CURRENCY} balance: ${cryptoBalance} (worth $${cryptoValueInUsd.toFixed(2)})`);

    if (cryptoValueInUsd < AMOUNT_USD) {
      console.error(`Insufficient ${CRYPTO_CURRENCY} balance. You have $${cryptoValueInUsd.toFixed(2)} but need $${AMOUNT_USD}`);
      return;
    }

    // Perform the withdrawal
    const result = await walletService.withdrawCryptocurrency(
      AMOUNT_USD,
      CRYPTO_CURRENCY,
      DESTINATION_ADDRESS,
      `Withdrawal via script`,
      null, // opportunityId
      null  // agentId
    );

    console.log('Withdrawal result:', JSON.stringify(result, null, 2));

    if (result.success) {
      console.log(`Withdrawal successful! New ${CRYPTO_CURRENCY} balance: ${result.newBalance[CRYPTO_CURRENCY] || 0}`);
      console.log(`New total balance in USD: $${result.totalBalanceInUSD.toFixed(2)}`);
    } else {
      console.error('Withdrawal failed:', result.error);
    }
  } catch (error) {
    console.error('Error during withdrawal:', error.message);
    process.exit(1);
  }
}

withdraw();
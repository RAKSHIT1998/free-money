// Cryptocurrency configuration for wallet integrations
class CryptoCurrencyConfig {
  constructor() {
    // Supported cryptocurrencies
    this.supportedCoins = ['BTC', 'ETH', 'BNB', 'USDT', 'USDC'];

    // Default wallet configurations (these would normally come from environment variables)
    this.wallets = {
      // Binance wallet configuration
      binance: {
        apiKey: process.env.BINANCE_API_KEY || '',
        apiSecret: process.env.BINANCE_API_SECRET || '',
        testnet: process.env.BINANCE_TESTNET === 'true',
        enabled: process.env.BINANCE_ENABLED === 'true'
      },

      // Generic wallet configuration (for other wallets or direct blockchain)
      wallet: {
        // For HD wallets or direct blockchain interaction
        mnemonic: process.env.WALLET_MNEMONIC || '',
        privateKey: process.env.WALLET_PRIVATE_KEY || '',
        address: process.env.WALLET_ADDRESS || '',
        network: process.env.WALLET_NETWORK || 'mainnet', // mainnet, testnet, etc.
        enabled: process.env.WALLET_ENABLED === 'true'
      }
    };

    // Transaction fees (in USD - would be calculated dynamically in real implementation)
    this.transactionFees = {
      BTC: 5.00,   // ~$5 fee
      ETH: 10.00,  // ~$10 fee (gas)
      BNB: 0.50,   // ~$0.50 fee
      USDT: 1.00,  // ~$1 fee
      USDC: 1.00   // ~$1 fee
    };

    // Minimum withdrawal amounts (in USD)
    this.minWithdrawalAmounts = {
      BTC: 10.00,   // $10 minimum
      ETH: 10.00,   // $10 minimum
      BNB: 5.00,    // $5 minimum
      USDT: 5.00,   // $5 minimum
      USDC: 5.00    // $5 minimum
    };

    // Conversion rates (USD to crypto) - 1 unit of crypto = X USD
    // These can be overridden via environment variables (e.g., BTC_USD=30000)
    this.conversionRates = {
      BTC: parseFloat(process.env.BTC_USD) || 30000,
      ETH: parseFloat(process.env.ETH_USD) || 2000,
      BNB: parseFloat(process.env.BNB_USD) || 300,
      USDT: 1, // 1 USDT = 1 USD
      USDC: 1  // 1 USDC = 1 USD
    };
  }

  /**
   * Get wallet configuration for a specific exchange/wallet type
   * @param {string} type - Wallet type ('binance', 'wallet')
   * @returns {Object} Wallet configuration
   */
  getWalletConfig(type) {
    return this.wallets[type] || null;
  }

  /**
   * Check if a cryptocurrency is supported
   * @param {string} coin - Cryptocurrency symbol (BTC, ETH, etc.)
   * @returns {boolean} True if supported
   */
  isCoinSupported(coin) {
    return this.supportedCoins.includes(coin.toUpperCase());
  }

  /**
   * Get transaction fee for a cryptocurrency (in USD)
   * @param {string} coin - Cryptocurrency symbol
   * @returns {number} Transaction fee in USD
   */
  getTransactionFee(coin) {
    return this.transactionFees[coin.toUpperCase()] || 0;
  }

  /**
   * Get minimum withdrawal amount for a cryptocurrency (in USD)
   * @param {string} coin - Cryptocurrency symbol
   * @returns {number} Minimum withdrawal amount in USD
   */
  getMinWithdrawalAmount(coin) {
    return this.minWithdrawalAmounts[coin.toUpperCase()] || 0;
  }

  /**
   * Get conversion rate (USD to crypto): how much USD equals 1 unit of crypto
   * @param {string} coin - Cryptocurrency symbol
   * @returns {number} USD per 1 unit of crypto
   */
  getUsdPerCoin(coin) {
    return this.conversionRates[coin.toUpperCase()] || 1;
  }

  /**
   * Get conversion rate (crypto to USD): how much crypto equals 1 USD
   * @param {string} coin - Cryptocurrency symbol
   * @returns {number} Amount of crypto per 1 USD
   */
  getCoinPerUsd(coin) {
    const usdPerCoin = this.getUsdPerCoin(coin);
    return usdPerCoin ? 1 / usdPerCoin : 0;
  }

  /**
   * Check if any wallet is enabled
   * @returns {boolean} True if at least one wallet is enabled
   */
  isAnyWalletEnabled() {
    return Object.values(this.wallets).some(wallet => wallet.enabled);
  }

  /**
   * Get enabled wallets
   * @returns {Array} Array of enabled wallet types
   */
  getEnabledWallets() {
    return Object.entries(this.wallets)
      .filter(([, config]) => config.enabled)
      .map(([type, _]) => type);
  }
}

// Create and export singleton instance
const cryptoCurrencyConfig = new CryptoCurrencyConfig();
module.exports = { CryptoCurrencyConfig, cryptoCurrencyConfig };
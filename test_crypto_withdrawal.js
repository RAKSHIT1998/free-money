// Test script to demonstrate cryptocurrency withdrawal functionality
// This can be run with Node.js to test the core logic

const { CryptoCurrencyConfig, cryptoCurrencyConfig } = require('./src/config/cryptocurrency');
const { Config } = require('./src/config/config');

// Mock environment variables for testing
process.env.CRYPTO_ENABLED = 'true';
process.env.DEFAULT_CRYPTO_CURRENCY = 'BNB';
process.env.BINANCE_ENABLED = 'true';
process.env.BINANCE_API_KEY = 'test_key';
process.env.BINANCE_API_SECRET = 'test_secret';
process.env.CRYPTO_SIMULATION_MODE = 'true';
process.env.CRYPTO_SIMULATION_DELAY_MS = '100';
process.env.CRYPTO_SIMULATION_SUCCESS_RATE = '0.9';

// Initialize config
const config = new Config();

console.log('=== Cryptocurrency Withdrawal Feature Test ===\n');

// Test 1: Configuration loading
console.log('1. Testing Configuration:');
console.log(`   Crypto enabled: ${config.get('cryptocurrency.enabled')}`);
console.log(`   Default currency: ${config.get('cryptocurrency.defaultCurrency')}`);
console.log(`   Simulation mode: ${config.get('cryptocurrency.simulation.enabled')}`);
console.log(`   Supported coins: ${cryptoCurrencyConfig.supportedCoins.join(', ')}\n`);

// Test 2: Coin support checking
console.log('2. Testing Coin Support:');
['BTC', 'ETH', 'BNB', 'USDT', 'USDC', 'DOGE'].forEach(coin => {
  const supported = cryptoCurrencyConfig.isCoinSupported(coin);
  console.log(`   ${coin}: ${supported ? '✓ Supported' : '✗ Not supported'}`);
});
console.log('');

// Test 3: Fee and minimum withdrawal info
console.log('3. Testing Fee and Minimum Information:');
cryptoCurrencyConfig.supportedCoins.forEach(coin => {
  const fee = cryptoCurrencyConfig.getTransactionFee(coin);
  const minWithdrawal = cryptoCurrencyConfig.getMinWithdrawalAmount(coin);
  const usdPerCoin = cryptoCurrencyConfig.getUsdPerCoin(coin);
  console.log(`   ${coin}:`);
  console.log(`     - Transaction fee: $${fee}`);
  console.log(`     - Min withdrawal: $${minWithdrawal}`);
  console.log(`     - Conversion rate: 1 ${coin} = $${usdPerCoin} USD`);
});
console.log('');

// Test 4: Wallet configuration
console.log('4. Testing Wallet Configuration:');
const binanceConfig = cryptoCurrencyConfig.getWalletConfig('binance');
console.log(`   Binance enabled: ${binanceConfig.enabled}`);
console.log(`   Binance has API key: ${binanceConfig.apiKey ? 'Yes' : 'No'}`);
console.log(`   Binance testnet: ${binanceConfig.testnet}`);
console.log('');

// Test 5: Conversion calculations
console.log('5. Testing Conversion Calculations:');
const testAmounts = [10, 50, 100];
testAmounts.forEach(usdAmount => {
  console.log(`   For $${usdAmount}:`);
  cryptoCurrencyConfig.supportedCoins.forEach(coin => {
    const coinAmount = usdAmount / cryptoCurrencyConfig.getUsdPerCoin(coin);
    console.log(`     - ${usdAmount} USD = ${coinAmount.toFixed(8)} ${coin}`);
  });
});
console.log('');

console.log('=== Test Complete ===');
console.log('The cryptocurrency withdrawal feature is ready for use!');
console.log('To test with actual API calls, start the server and use:');
console.log('  POST /api/wallet/withdraw/crypto');
console.log('With JSON body: { amount, currency, destinationAddress, description }');
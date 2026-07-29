# Cryptocurrency Withdrawal Feature Implementation

## Overview

This implementation adds cryptocurrency withdrawal capabilities to the Free Money App, allowing users to withdraw their earnings in various cryptocurrencies (BTC, ETH, BNB, USDT, USDC) to external wallets or exchanges like Binance.

## Files Modified

1. `src/config/cryptocurrency.js` - Cryptocurrency configuration module
2. `src/config/config.js` - Updated to include cryptocurrency settings
3. `src/services/walletService.js` - Added cryptocurrency withdrawal functionality
4. `src/server/controllers/walletController.js` - Added cryptocurrency withdrawal endpoint
5. `src/server/routes/walletRoutes.js` - Added route for cryptocurrency withdrawal
6. `.env` - Added cryptocurrency configuration environment variables

## Features

### Supported Cryptocurrencies
- Bitcoin (BTC)
- Ethereum (ETH)
- Binance Coin (BNB)
- Tether (USDT)
- USD Coin (USDC)

### Wallet Support
- Binance Exchange (via API)
- Generic wallet addresses (for other exchanges or personal wallets)

### Configuration Options
The feature can be configured via environment variables in `.env`:

```
# Cryptocurrency Settings
CRYPTO_ENABLED=true
DEFAULT_CRYPTO_CURRENCY=BNB

# Binance Wallet Configuration
BINANCE_ENABLED=true
BINANCE_API_KEY=your_binance_api_key_here
BINANCE_API_SECRET=your_binance_api_secret_here
BINANCE_TESTNET=false

# Default Wallet Address (for non-exchange wallets)
DEFAULT_WALLET_ADDRESS=0x742d35Cc6634C0532925a3b8D4C0532950532950

# Cryptocurrency Transaction Settings
CRYPTO_MIN_SEND_AMOUNT=10
CRYPTO_FEE_MODE=network
CRYPTO_REQUIRED_CONFIRMATIONS=1

# Cryptocurrency Simulation Mode (set to true if you don't have real API keys)
CRYPTO_SIMULATION_MODE=true
CRYPTO_SIMULATION_DELAY_MS=2000
CRYPTO_SIMULATION_SUCCESS_RATE=0.95
```

### How It Works

1. **Configuration System**: 
   - Added cryptocurrency configuration to the config system
   - Supports both live exchange API integration and simulation mode

2. **Wallet Service Enhancements**:
   - Added `withdrawCryptocurrency()` function that handles:
     - Input validation
     - Cryptocurrency support checking
     - Minimum withdrawal amount validation
     - Balance checking
     - Transaction fee calculation
     - Simulation mode (for testing without real API keys)
     - Balance deduction upon successful withdrawal
     - Transaction record creation

3. **API Endpoint**:
   - Added `POST /api/wallet/withdraw/crypto` endpoint
   - Requires authentication
   - Accepts parameters: amount, currency, destinationAddress, description, opportunityId, agentId
   - Returns transaction details upon success

4. **Simulation Mode**:
   - When API keys are not provided or simulation mode is enabled
   - Simulates network delay
   - Simulates success/failure based on configurable success rate
   - Generates mock transaction IDs and details
   - Perfect for testing and development

### Usage Example

To withdraw 50 USD worth of BNB to a Binance wallet:

```javascript
const response = await fetch('/api/wallet/withdraw/crypto', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer <your-jwt-token>'
  },
  body: JSON.stringify({
    amount: 50,
    currency: 'BNB',
    destinationAddress: '0x742d35Cc6634C0532925a3b8D4C0532950532950',
    description: 'Withdrawal to Binance wallet'
  })
});

const result = await response.json();
// Returns transaction details including transactionId, status, etc.
```

### Security Considerations

1. All wallet endpoints require authentication via JWT
2. API keys are stored in environment variables (not in code)
3. Simulation mode prevents accidental real transactions during development
4. Input validation prevents malformed requests
5. Balance checking prevents overdrafts

### Future Improvements

1. Implement actual exchange API integrations (Binance, Coinbase, etc.)
2. Add support for more cryptocurrencies and wallets
3. Implement dynamic fee calculation based on network conditions
4. Add transaction broadcasting and confirmation tracking
5. Implement address validation for each cryptocurrency
6. Add withdrawal limits and daily caps
7. Implement email/SMS notifications for withdrawals
8. Add transaction history filtering by type (deposit/withdrawal/earning)

## Testing

To test the cryptocurrency withdrawal feature:

1. Set `CRYPTO_SIMULATION_MODE=true` in `.env`
2. Start the application: `npm run dev`
3. Authenticate to get a JWT token
4. Make a POST request to `/api/wallet/withdraw/crypto` with the required parameters
5. Observe the simulated transaction response

In simulation mode, you can adjust:
- `CRYPTO_SIMULATION_DELAY_MS` to simulate different network speeds
- `CRYPTO_SIMULATION_SUCCESS_RATE` to test failure scenarios

## Conclusion

This implementation provides a robust foundation for cryptocurrency withdrawals in the Free Money App. It separates concerns properly, follows existing code patterns, and provides both a simulation mode for development/testing and a clear path for integrating with real exchange APIs in production.
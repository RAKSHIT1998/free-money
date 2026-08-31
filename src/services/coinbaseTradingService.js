// Real Coinbase spot trading + deposit-tracking service — REAL MONEY, the Coinbase
// side of crossExchangeTransferArbitrageAgent.js's buy-on-Binance/sell-on-Coinbase
// flow. Built on ccxt's authenticated Coinbase client (the same library already used
// for this project's market-data layer) rather than hand-rolled signed requests.
//
// This module ONLY sells and reads balances/deposits on Coinbase — it never
// withdraws FROM Coinbase and never touches Binance. The withdrawal leg (Binance →
// Coinbase) lives in realTradingService.js's withdraw(); this module is what
// receives that transfer and closes the loop.
//
// Safety properties (do not remove without updating the plan/tests):
// - Gated behind LIVE_TRADING_CONFIRMED=true AND LIVE_TRANSFER_ARBITRAGE_CONFIRMED=true
//   AND validated (non-placeholder) COINBASE_API_KEY/SECRET — three independent
//   opt-ins, checked on every call, not just at startup.
// - No withdrawal capability at all in this module. If crossExchangeTransferArbitrageAgent
//   ever needs to move funds back off Coinbase, that's a deliberate separate decision,
//   not something this file does implicitly.
const ccxt = require('ccxt');
const { isLikelyRealCoinbaseKey } = require('../config/config');

let exchange = null;
function getExchange() {
  if (!exchange) {
    exchange = new ccxt.coinbase({
      apiKey: process.env.COINBASE_API_KEY,
      secret: process.env.COINBASE_API_SECRET,
      enableRateLimit: true
    });
  }
  return exchange;
}

/**
 * Defense-in-depth guard, mirroring realTradingService.js's assertLiveTradingAllowed
 * — checked on every call, not just at startup, so a runtime env change takes effect
 * immediately rather than only after a restart.
 */
function assertLiveCoinbaseTradingAllowed() {
  const liveConfirmed = process.env.LIVE_TRADING_CONFIRMED === 'true';
  const transferArbConfirmed = process.env.LIVE_TRANSFER_ARBITRAGE_CONFIRMED === 'true';
  const keysReal =
    isLikelyRealCoinbaseKey(process.env.COINBASE_API_KEY) &&
    isLikelyRealCoinbaseKey(process.env.COINBASE_API_SECRET);

  if (!liveConfirmed || !transferArbConfirmed || !keysReal) {
    throw new Error(
      'Real Coinbase trading blocked: requires LIVE_TRADING_CONFIRMED=true AND ' +
      'LIVE_TRANSFER_ARBITRAGE_CONFIRMED=true AND validated (non-placeholder) ' +
      'COINBASE_API_KEY/SECRET.'
    );
  }
}

/**
 * Current Coinbase bid/ask for an asset — read-only public data, not gated behind
 * the live-trading confirmation flags (same philosophy as crossExchangeMarketDataService's
 * market data: reading a price is not a money-moving action). Used to make the
 * sell-or-flag-for-review decision with a fresh price at the moment a deposit lands,
 * rather than trusting a possibly-stale/absent scanner cache entry.
 * @param {string} asset e.g. 'BTC'
 * @returns {Promise<{bid: number, ask: number}>}
 */
async function getCurrentQuote(asset) {
  const ex = getExchange();
  const ticker = await ex.fetchTicker(`${asset}/USD`);
  return { bid: ticker.bid, ask: ticker.ask };
}

/**
 * Places a REAL Coinbase market sell for an exact base-asset quantity — the leg that
 * realizes (or fails to realize) the arbitrage after a Binance-withdrawn deposit lands.
 * @param {Object} params
 * @param {string} params.asset e.g. 'BTC'
 * @param {number} params.quantity base-asset quantity to sell
 * @param {string} [params.agentId]
 * @returns {Promise<Object>}
 */
async function placeMarketSellOrder({ asset, quantity, agentId }) {
  assertLiveCoinbaseTradingAllowed();
  const ex = getExchange();
  const symbol = `${asset}/USD`;

  const order = await ex.createOrder(symbol, 'market', 'sell', quantity);

  return {
    agentId,
    symbol,
    side: 'sell',
    requestedQty: quantity,
    filledQty: order.filled != null ? order.filled : quantity,
    fillPrice: order.average != null ? order.average : order.price,
    coinbaseOrderId: order.id,
    status: order.status,
    raw: order
  };
}

/**
 * Fetches (creating one if none exists yet) a real Coinbase deposit address for
 * `asset` on `network` — this is where realTradingService.withdraw() should send
 * Binance-sourced funds.
 * @param {string} asset e.g. 'BTC'
 * @param {string} [network] ccxt/Coinbase network id, e.g. 'bitcoin', 'ethereum', 'solana'
 * @returns {Promise<{address: string, tag: string|undefined, network: string, raw: Object}>}
 */
async function getOrCreateDepositAddress(asset, network) {
  assertLiveCoinbaseTradingAllowed();
  const ex = getExchange();
  const params = network ? { network } : {};
  const addr = await ex.fetchDepositAddress(asset, params);
  return { address: addr.address, tag: addr.tag, network: addr.network || network, raw: addr };
}

/**
 * Real Coinbase free balance for one asset.
 * @param {string} asset e.g. 'BTC'
 * @returns {Promise<number>}
 */
async function getAssetBalance(asset) {
  assertLiveCoinbaseTradingAllowed();
  const ex = getExchange();
  const balance = await ex.fetchBalance();
  return balance[asset]?.free || 0;
}

/**
 * Single, non-blocking check for whether a deposit has landed — does NOT loop or
 * sleep internally (unlike a naive "wait for deposit" helper would). Callers are
 * expected to call this once per their own periodic cycle (see
 * crossExchangeTransferArbitrageAgent.js's scanCycle) so a long wait for on-chain
 * confirmation never blocks the agent's event loop, logging, or ability to stop.
 * @param {Object} params
 * @param {string} params.asset
 * @param {number} params.baselineBalance Coinbase balance immediately before the withdrawal was initiated
 * @param {number} params.minAmount Expected deposit amount (net of network fee, so use a slightly conservative estimate)
 * @returns {Promise<{arrived: boolean, currentBalance: number}>}
 */
async function hasDepositArrived({ asset, baselineBalance, minAmount }) {
  const currentBalance = await getAssetBalance(asset);
  // 1% tolerance: the network itself can shave a small amount off in fees depending
  // on the asset, independent of Coinbase's own handling.
  const arrived = currentBalance >= baselineBalance + minAmount * 0.99;
  return { arrived, currentBalance };
}

module.exports = {
  assertLiveCoinbaseTradingAllowed,
  getCurrentQuote,
  placeMarketSellOrder,
  getOrCreateDepositAddress,
  getAssetBalance,
  hasDepositArrived
};

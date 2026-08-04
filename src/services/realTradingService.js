// Real Binance spot trading service — REAL MONEY. This is the only module that talks
// to Binance for placing real orders. Intentionally has NO shared code path with
// walletService.js / wallet.json / the Wallet model, which track fabricated in-app
// "earnings" currency for the simulated agents. The only shared code is the
// isLikelyRealBinanceKey credential validator from config.js, used here as an
// independent defense-in-depth check (not a dependency on walletService's gate).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const { Config, isLikelyRealBinanceKey } = require('../config/config');

const config = new Config();
const persistenceEnabled = config.get('agentManager.persistenceEnabled', true);
const realTradesFilePath = path.join(process.cwd(), 'real_trades.json');

const BINANCE_BASE = 'https://api.binance.com';

// Binance rejects a signed request if its `timestamp` is ahead of Binance's own server
// clock by more than ~1000ms (error -1021), regardless of recvWindow — this is about
// the LOCAL machine's clock being ahead, not request latency. Rather than trust
// Date.now() directly, periodically measure the offset against Binance's own /time
// endpoint and apply it, so real clock drift on the host doesn't silently break every
// signed request (this exact failure mode was firing on every single spot DCA cycle).
let timeOffsetMs = 0;
let timeOffsetSyncedAt = 0;
const TIME_OFFSET_TTL_MS = 30 * 60 * 1000; // 30 minutes — drift accumulates slowly

async function getSyncedTimestamp() {
  const now = Date.now();
  if (now - timeOffsetSyncedAt > TIME_OFFSET_TTL_MS) {
    try {
      const { data } = await axios.get(`${BINANCE_BASE}/api/v3/time`);
      timeOffsetMs = data.serverTime - Date.now();
      timeOffsetSyncedAt = now;
    } catch (error) {
      // If the sync call itself fails, fall back to whatever offset (possibly 0) is
      // already known rather than blocking the caller on a clock-sync failure.
    }
  }
  return Date.now() + timeOffsetMs;
}

let RealTrade;
function getRealTradeModel() {
  if (!RealTrade) {
    RealTrade = require('../models/RealTrade');
  }
  return RealTrade;
}

function loadTradesFromFile() {
  try {
    if (fs.existsSync(realTradesFilePath)) {
      const data = fs.readFileSync(realTradesFilePath, 'utf8');
      try {
        const parsed = JSON.parse(data);
        return Array.isArray(parsed.trades) ? parsed.trades : [];
      } catch (parseError) {
        console.warn('real_trades.json contains invalid JSON, starting with empty ledger');
        return [];
      }
    }
    return [];
  } catch (error) {
    console.error('Error loading real trades file:', error);
    return [];
  }
}

function saveTradesToFile(trades) {
  try {
    fs.writeFileSync(realTradesFilePath, JSON.stringify({ trades }, null, 2), 'utf8');
  } catch (error) {
    console.error('Error saving real trades file:', error);
    throw error;
  }
}

async function appendTrade(tradeRecord) {
  if (persistenceEnabled) {
    const Model = getRealTradeModel();
    const doc = await Model.create(tradeRecord);
    return doc.toObject();
  }

  const trades = loadTradesFromFile();
  const record = { ...tradeRecord, timestamp: tradeRecord.timestamp || new Date() };
  trades.push(record);
  saveTradesToFile(trades);
  return record;
}

/**
 * Get all real trades for an agent, sorted oldest -> newest.
 * @param {string} agentId
 * @returns {Promise<Array>}
 */
async function getLedger(agentId) {
  if (persistenceEnabled) {
    const Model = getRealTradeModel();
    const docs = await Model.find({ agentId }).sort({ timestamp: 1 }).lean();
    return docs;
  }

  const trades = loadTradesFromFile();
  return trades
    .filter(t => t.agentId === agentId)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

/**
 * Real (unauthenticated, public) current market price for a symbol.
 * @param {string} symbol e.g. 'BTCUSDT'
 * @returns {Promise<number>}
 */
async function getCurrentPrice(symbol) {
  const { data } = await axios.get(`${BINANCE_BASE}/api/v3/ticker/price`, {
    params: { symbol }
  });
  return parseFloat(data.price);
}

/**
 * Total real USD spent (BUY orders) minus proceeds from SELL orders, for an agent.
 * @param {string} agentId
 * @param {string} symbol
 * @returns {Promise<number>}
 */
async function getTotalSpentUsd(agentId, symbol) {
  const ledger = await getLedger(agentId);
  return ledger
    .filter(trade => trade.symbol === symbol)
    .reduce((sum, trade) => {
      const cost = trade.filledQty * trade.fillPrice;
      return trade.side === 'BUY' ? sum + cost : sum - cost;
    }, 0);
}

/**
 * Net quantity held of a symbol's base asset, for an agent.
 * @param {string} agentId
 * @param {string} symbol
 * @returns {Promise<number>}
 */
async function getTotalQtyHeld(agentId, symbol) {
  const ledger = await getLedger(agentId);
  return ledger
    .filter(trade => trade.symbol === symbol)
    .reduce((sum, trade) => sum + (trade.side === 'BUY' ? trade.filledQty : -trade.filledQty), 0);
}

/**
 * Real, live-computed unrealized P&L: (qty held * current market price) - total USD spent.
 * Never fabricated — always derived from the actual ledger and a live price fetch.
 * @param {string} agentId
 * @param {string} symbol
 */
async function computeUnrealizedPnl(agentId, symbol) {
  const [qty, spent, currentPrice] = await Promise.all([
    getTotalQtyHeld(agentId, symbol),
    getTotalSpentUsd(agentId, symbol),
    getCurrentPrice(symbol)
  ]);
  const currentValue = qty * currentPrice;
  return {
    qty,
    spent,
    currentPrice,
    currentValue,
    unrealizedPnl: currentValue - spent
  };
}

/**
 * Defense-in-depth guard: real orders can only be placed with an explicit human
 * opt-in AND real-looking (non-placeholder) Binance credentials. Independent of
 * walletService's own gate — this module never calls into walletService.
 */
function assertLiveTradingAllowed() {
  const liveConfirmed = process.env.LIVE_TRADING_CONFIRMED === 'true';
  const keysReal =
    isLikelyRealBinanceKey(process.env.BINANCE_API_KEY) &&
    isLikelyRealBinanceKey(process.env.BINANCE_API_SECRET);

  if (!liveConfirmed || !keysReal) {
    throw new Error(
      'Real trading blocked: requires LIVE_TRADING_CONFIRMED=true and validated (non-placeholder) BINANCE_API_KEY/SECRET.'
    );
  }
}

/**
 * Place a REAL Binance spot market buy order using quoteOrderQty (spend exactly this
 * many USD-equivalent quote-asset units, regardless of price).
 * @param {Object} params
 * @param {string} params.symbol e.g. 'BTCUSDT'
 * @param {number} params.quoteOrderQtyUsd
 * @param {string} params.agentId
 * @returns {Promise<Object>} the recorded trade
 */
async function placeMarketBuyOrder({ symbol, quoteOrderQtyUsd, agentId }) {
  assertLiveTradingAllowed();

  const timestamp = await getSyncedTimestamp();
  const queryString = `symbol=${symbol}&side=BUY&type=MARKET&quoteOrderQty=${quoteOrderQtyUsd}&timestamp=${timestamp}`;
  const signature = crypto
    .createHmac('sha256', process.env.BINANCE_API_SECRET)
    .update(queryString)
    .digest('hex');

  let response;
  try {
    response = await axios.post(
      `${BINANCE_BASE}/api/v3/order?${queryString}&signature=${signature}`,
      null,
      { headers: { 'X-MBX-APIKEY': process.env.BINANCE_API_KEY } }
    );
  } catch (error) {
    // Binance's actual reason (e.g. -2010 insufficient balance, -1013 NOTIONAL filter
    // failure) lives in error.response.data, not error.message — axios only gives the
    // generic "Request failed with status code 400" there. Without this, every caller
    // (agent cycle logs, this function's callers) only ever sees "400" with no way to
    // tell WHY, which is what let this exact order silently fail the same way for days.
    if (error.response?.data) {
      error.message = `${error.message}: ${JSON.stringify(error.response.data)}`;
    }
    throw error;
  }

  return recordFill(response.data, { symbol, quoteOrderQtyUsd, agentId });
}

async function recordFill(binanceOrderResponse, { symbol, quoteOrderQtyUsd, agentId }) {
  const fills = binanceOrderResponse.fills || [];
  const filledQty = fills.reduce((sum, f) => sum + parseFloat(f.qty), 0) ||
    parseFloat(binanceOrderResponse.executedQty) || 0;
  const totalCost = fills.reduce((sum, f) => sum + parseFloat(f.qty) * parseFloat(f.price), 0);
  const fillPrice = filledQty > 0 ? totalCost / filledQty : 0;
  const commission = fills.reduce((sum, f) => sum + parseFloat(f.commission || 0), 0);
  const commissionAsset = fills.length > 0 ? fills[0].commissionAsset : '';

  const status = binanceOrderResponse.status === 'FILLED'
    ? 'filled'
    : (binanceOrderResponse.status === 'PARTIALLY_FILLED' ? 'partially_filled' : 'error');

  const tradeRecord = {
    agentId,
    timestamp: new Date(),
    side: 'BUY',
    symbol,
    requestedUsd: quoteOrderQtyUsd,
    filledQty,
    fillPrice,
    commission,
    commissionAsset,
    binanceOrderId: binanceOrderResponse.orderId ? String(binanceOrderResponse.orderId) : undefined,
    status,
    raw: binanceOrderResponse
  };

  return appendTrade(tradeRecord);
}

module.exports = {
  getCurrentPrice,
  placeMarketBuyOrder,
  getLedger,
  getTotalSpentUsd,
  getTotalQtyHeld,
  computeUnrealizedPnl,
  assertLiveTradingAllowed
};

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
const ProactiveThrottle = require('../utils/proactiveThrottle');

const config = new Config();
const persistenceEnabled = config.get('agentManager.persistenceEnabled', true);
const realTradesFilePath = path.join(process.cwd(), 'real_trades.json');

const BINANCE_BASE = 'https://api.binance.com';

// Proactive half of this module's Binance protection — see proactiveThrottle.js.
// Shared across every module that reuses assertSpotNotRateLimited (this file,
// binanceEarnService.js, pumpFunTradingService.js), since they all hit the same
// api.binance.com ban bucket. Binance's real spot ceiling is 6000 request-weight/
// minute per IP; 300 requests/minute self-imposed leaves very generous headroom
// across all three callers combined.
const spotThrottle = new ProactiveThrottle({ maxRequests: 300, windowMs: 60000, name: 'binanceSpot' });

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
      // already known rather than blocking the caller on a clock-sync failure. Still
      // record a 429/418 here so the shared gate knows about a ban even if it was
      // first detected via this endpoint rather than a trading call.
      noteSpotRateLimitResponse(error);
    }
  }
  return Date.now() + timeOffsetMs;
}

// Shared rate-limit cooldown gate, mirroring realFuturesTradingService.js's — added
// 2026-08-05 after this exact module had zero protection and a burst of unthrottled
// calls (from the pump.fun agent's price-fetch bug, ironically hitting Binance's spot
// endpoint rather than this file directly, but the lesson generalizes) triggered a
// real IP ban on api.binance.com. Persisted to Mongo so a restart during an active
// ban doesn't forget it and immediately retry into a longer one — the same mistake
// already made and fixed once on the futures side.
let spotRateLimitedUntil = 0;
let spotRateLimitStateLoadedFromDb = false;

let RateLimitState;
function getRateLimitStateModel() {
  if (!RateLimitState) {
    RateLimitState = require('../models/RateLimitState');
  }
  return RateLimitState;
}

async function loadPersistedSpotRateLimitState() {
  if (spotRateLimitStateLoadedFromDb || !persistenceEnabled) return;
  spotRateLimitStateLoadedFromDb = true;
  try {
    const Model = getRateLimitStateModel();
    const doc = await Model.findOne({ key: 'binanceSpot' }).lean();
    if (doc && doc.rateLimitedUntil > spotRateLimitedUntil) {
      spotRateLimitedUntil = doc.rateLimitedUntil;
    }
  } catch (error) {
    // Mongo not reachable yet — proceed in-memory only.
  }
}

function persistSpotRateLimitState(until) {
  if (!persistenceEnabled) return;
  try {
    const Model = getRateLimitStateModel();
    Model.findOneAndUpdate(
      { key: 'binanceSpot' },
      { rateLimitedUntil: until, updatedAt: new Date() },
      { upsert: true }
    ).catch(() => {});
  } catch (error) {
    // Best-effort.
  }
}

/**
 * Hard, explicit kill switch — the spot wallet holds $0, so there is nothing for any
 * spot call to usefully act on, and every spot call is pure downside risk (rate-limit/
 * ban exposure) for zero possible upside right now. Checked first and cheaply, before
 * even touching the ban-state DB read or the throttle, so a disabled call fails
 * immediately with a clear, specific reason rather than a generic rate-limit message.
 * Sibling to assertLiveTradingAllowed (that one gates real orders specifically; this
 * one gates the whole spot surface, including read-only account/balance calls).
 */
function assertSpotCallsAllowed() {
  if (process.env.BINANCE_SPOT_DISABLED === 'true') {
    throw new Error(
      'Binance spot calls are disabled (BINANCE_SPOT_DISABLED=true) — no spot balance ' +
      'to act on, so no spot call is useful right now. Set BINANCE_SPOT_DISABLED=false ' +
      'to re-enable once the spot wallet is actually funded again.'
    );
  }
}

async function assertSpotNotRateLimited() {
  assertSpotCallsAllowed();

  await loadPersistedSpotRateLimitState();
  if (Date.now() < spotRateLimitedUntil) {
    const waitSec = Math.ceil((spotRateLimitedUntil - Date.now()) / 1000);
    throw new Error(`Binance rate limit/ban in effect, retry in ${waitSec}s`);
  }
  // Not banned — still pace ourselves proactively rather than only reacting after
  // Binance says stop. Every caller (this file, binanceEarnService.js) already goes
  // through this one function. pumpFunTradingService.js's price lookup deliberately
  // does NOT — it uses CoinGecko instead, since it's a public price read with no
  // dependency on our spot balance and shouldn't be taken down by this switch.
  await spotThrottle.acquire();
}

function noteSpotRateLimitResponse(error) {
  const status = error.response?.status;
  if (status === 429 || status === 418) {
    const retryAfterSec = parseInt(error.response.headers['retry-after'], 10);
    const cooldownMs = Number.isFinite(retryAfterSec) ? retryAfterSec * 1000 : 60000;
    spotRateLimitedUntil = Date.now() + cooldownMs;
    persistSpotRateLimitState(spotRateLimitedUntil);
  }
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
  await assertSpotNotRateLimited();
  try {
    const { data } = await axios.get(`${BINANCE_BASE}/api/v3/ticker/price`, {
      params: { symbol }
    });
    return parseFloat(data.price);
  } catch (error) {
    noteSpotRateLimitResponse(error);
    throw error;
  }
}

let exchangeInfoCache = null;
let exchangeInfoCacheAt = 0;
const EXCHANGE_INFO_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours — symbol listings rarely change

async function getExchangeInfo() {
  const now = Date.now();
  if (exchangeInfoCache && (now - exchangeInfoCacheAt) < EXCHANGE_INFO_TTL_MS) {
    return exchangeInfoCache;
  }
  await assertSpotNotRateLimited();
  try {
    const { data } = await axios.get(`${BINANCE_BASE}/api/v3/exchangeInfo`);
    exchangeInfoCache = data;
    exchangeInfoCacheAt = now;
    return data;
  } catch (error) {
    noteSpotRateLimitResponse(error);
    throw error;
  }
}

/**
 * Set of symbols actually tradable on Binance SPOT right now. Used by strategies that
 * hold a spot leg (e.g. fundingRateArbitrage) to filter out futures-only perpetuals
 * before attempting a spot order — without this, a candidate like a futures-only
 * meme perpetual (no spot pair at all) reaches placeMarketBuyOrder and is rejected
 * with a 400 "Invalid symbol", wasting the cycle on an opportunity that was never
 * actually tradable as a spot+futures pair.
 * @returns {Promise<Set<string>>}
 */
async function getSpotTradableSymbols() {
  const data = await getExchangeInfo();
  return new Set(
    data.symbols
      .filter(s => s.status === 'TRADING' && s.isSpotTradingAllowed !== false)
      .map(s => s.symbol)
  );
}

/**
 * Fetch the quantity step size (LOT_SIZE filter) for a spot symbol, so a sell quantity
 * can be rounded to a value Binance will accept — without this, placeMarketSellOrder
 * would need a caller to already know the exact precision Binance expects, which
 * varies per symbol.
 * @param {string} symbol
 * @returns {Promise<number>} step size, e.g. 0.00001
 */
async function getQuantityStepSize(symbol) {
  const data = await getExchangeInfo();
  const symbolInfo = data.symbols.find(s => s.symbol === symbol);
  if (!symbolInfo) {
    throw new Error(`Symbol ${symbol} not found in spot exchange info`);
  }
  const lotSizeFilter = symbolInfo.filters.find(f => f.filterType === 'LOT_SIZE');
  return lotSizeFilter ? parseFloat(lotSizeFilter.stepSize) : 0.00001;
}

function roundDownToStep(quantity, stepSize) {
  const precision = Math.max(0, Math.round(-Math.log10(stepSize)));
  const factor = Math.pow(10, precision);
  return Math.floor(quantity * factor) / factor;
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
  await assertSpotNotRateLimited();

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
    noteSpotRateLimitResponse(error);
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

  return recordFill(response.data, { symbol, side: 'BUY', requestedUsd: quoteOrderQtyUsd, agentId });
}

/**
 * Place a REAL Binance spot market SELL order for an exact base-asset quantity (not a
 * USD amount) — the counterpart to placeMarketBuyOrder, needed to close/unwind a spot
 * position (e.g. the spot leg of funding-rate arbitrage) rather than only ever
 * accumulating.
 * @param {Object} params
 * @param {string} params.symbol e.g. 'BTCUSDT'
 * @param {number} params.quantity base-asset quantity to sell
 * @param {string} params.agentId
 * @returns {Promise<Object>} the recorded trade
 */
async function placeMarketSellOrder({ symbol, quantity, agentId }) {
  assertLiveTradingAllowed();
  await assertSpotNotRateLimited();

  const stepSize = await getQuantityStepSize(symbol);
  const roundedQuantity = roundDownToStep(quantity, stepSize);
  if (roundedQuantity <= 0) {
    throw new Error(`Sell quantity ${quantity} rounds down to 0 at step size ${stepSize} for ${symbol}`);
  }

  const timestamp = await getSyncedTimestamp();
  const queryString = `symbol=${symbol}&side=SELL&type=MARKET&quantity=${roundedQuantity}&timestamp=${timestamp}`;
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
    noteSpotRateLimitResponse(error);
    if (error.response?.data) {
      error.message = `${error.message}: ${JSON.stringify(error.response.data)}`;
    }
    throw error;
  }

  return recordFill(response.data, { symbol, side: 'SELL', requestedUsd: null, agentId });
}

async function recordFill(binanceOrderResponse, { symbol, side, requestedUsd, agentId }) {
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
    side,
    symbol,
    // A SELL closes a specific quantity rather than targeting a USD spend, so there's
    // no "requested" USD figure — record the actual proceeds instead, for ledger
    // consistency with BUY's requestedUsd (both end up representing the trade's size).
    requestedUsd: requestedUsd != null ? requestedUsd : filledQty * fillPrice,
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

/**
 * Real Binance deposit address for receiving a crypto payment — used for the gig
 * draft crypto payment option, not by any trading agent. Read-only (no signature scope
 * beyond what deposit-address/deposit-history already require); never withdraws or
 * moves funds.
 * @param {string} coin e.g. 'USDT', 'BTC'
 * @param {string} [network] e.g. 'TRX', 'BTC' — required for multi-network coins
 * @returns {Promise<{coin: string, address: string, tag: string, url: string}>}
 */
async function getDepositAddress(coin, network) {
  assertLiveTradingAllowed();
  await assertSpotNotRateLimited();

  const timestamp = await getSyncedTimestamp();
  const params = { coin, timestamp };
  if (network) params.network = network;
  const queryString = new URLSearchParams(params).toString();
  const signature = crypto
    .createHmac('sha256', process.env.BINANCE_API_SECRET)
    .update(queryString)
    .digest('hex');

  try {
    const { data } = await axios.get(
      `${BINANCE_BASE}/sapi/v1/capital/deposit/address?${queryString}&signature=${signature}`,
      { headers: { 'X-MBX-APIKEY': process.env.BINANCE_API_KEY } }
    );
    return data;
  } catch (error) {
    noteSpotRateLimitResponse(error);
    throw error;
  }
}

/**
 * Real Binance deposit history for a coin — used to detect whether a client has
 * actually sent a crypto payment yet. Read-only.
 * @param {string} coin e.g. 'USDT', 'BTC'
 * @returns {Promise<Array<{coin, address, amount, status, insertTime, txId}>>} status 1 = completed
 */
async function getRecentDeposits(coin) {
  assertLiveTradingAllowed();
  await assertSpotNotRateLimited();

  const timestamp = await getSyncedTimestamp();
  const queryString = new URLSearchParams({ coin, timestamp }).toString();
  const signature = crypto
    .createHmac('sha256', process.env.BINANCE_API_SECRET)
    .update(queryString)
    .digest('hex');

  let data;
  try {
    ({ data } = await axios.get(
      `${BINANCE_BASE}/sapi/v1/capital/deposit/hisrec?${queryString}&signature=${signature}`,
      { headers: { 'X-MBX-APIKEY': process.env.BINANCE_API_KEY } }
    ));
  } catch (error) {
    noteSpotRateLimitResponse(error);
    throw error;
  }
  return Array.isArray(data) ? data : [];
}

/**
 * Real Binance spot free balance for one asset.
 * @param {string} asset e.g. 'BTC'
 * @returns {Promise<number>}
 */
async function getAssetBalance(asset) {
  assertLiveTradingAllowed();
  await assertSpotNotRateLimited();

  const timestamp = await getSyncedTimestamp();
  const queryString = `timestamp=${timestamp}`;
  const signature = crypto
    .createHmac('sha256', process.env.BINANCE_API_SECRET)
    .update(queryString)
    .digest('hex');

  let data;
  try {
    ({ data } = await axios.get(
      `${BINANCE_BASE}/api/v3/account?${queryString}&signature=${signature}`,
      { headers: { 'X-MBX-APIKEY': process.env.BINANCE_API_KEY } }
    ));
  } catch (error) {
    noteSpotRateLimitResponse(error);
    throw error;
  }
  const balance = (data.balances || []).find(b => b.asset === asset);
  return balance ? parseFloat(balance.free) : 0;
}

/**
 * Defense-in-depth guard for the withdraw() function specifically — deliberately
 * stricter than assertLiveTradingAllowed(). Every other function in this file moves
 * money between assets INSIDE the same Binance account (reversible by trading back);
 * withdraw() sends real crypto to an external address/network and is NOT reversible
 * if that address or network is wrong. Requires its own explicit opt-in
 * (LIVE_WITHDRAWAL_CONFIRMED=true) on top of ordinary live trading being confirmed —
 * the same "extra-dangerous capability needs an extra explicit flag" pattern as
 * LIVE_FUTURES_TRADING_CONFIRMED for leverage.
 */
function assertLiveWithdrawalAllowed() {
  assertLiveTradingAllowed();
  if (process.env.LIVE_WITHDRAWAL_CONFIRMED !== 'true') {
    throw new Error(
      'Real withdrawal blocked: requires LIVE_WITHDRAWAL_CONFIRMED=true in addition to ' +
      'LIVE_TRADING_CONFIRMED=true. A withdrawal sends real funds to an external address/network ' +
      'and cannot be reversed if either is wrong — this is a deliberately separate, stricter opt-in.'
    );
  }
}

/**
 * Real Binance withdrawal — sends `amount` of `asset` to `address` on `network`.
 * IRREVERSIBLE if the address or network is wrong. Only ever reachable through
 * assertLiveWithdrawalAllowed()'s extra gate (see its comment); callers (e.g.
 * crossExchangeTransferArbitrageAgent) are still responsible for picking a network
 * that's actually valid for both the sending and receiving exchange.
 * @param {Object} params
 * @param {string} params.asset e.g. 'BTC'
 * @param {number} params.amount
 * @param {string} params.address destination address
 * @param {string} [params.network] e.g. 'BTC', 'ETH', 'SOL' — required for multi-network assets
 * @param {string} [params.agentId]
 * @returns {Promise<{binanceWithdrawId: string, raw: Object}>}
 */
async function withdraw({ asset, amount, address, network, agentId }) {
  assertLiveWithdrawalAllowed();
  await assertSpotNotRateLimited();

  const timestamp = await getSyncedTimestamp();
  const params = { coin: asset, amount, address, timestamp };
  if (network) params.network = network;
  const queryString = new URLSearchParams(params).toString();
  const signature = crypto
    .createHmac('sha256', process.env.BINANCE_API_SECRET)
    .update(queryString)
    .digest('hex');

  let response;
  try {
    response = await axios.post(
      `${BINANCE_BASE}/sapi/v1/capital/withdraw/apply?${queryString}&signature=${signature}`,
      null,
      { headers: { 'X-MBX-APIKEY': process.env.BINANCE_API_KEY } }
    );
  } catch (error) {
    noteSpotRateLimitResponse(error);
    if (error.response?.data) {
      error.message = `${error.message}: ${JSON.stringify(error.response.data)}`;
    }
    throw error;
  }

  return {
    agentId,
    asset,
    amount,
    address,
    network,
    binanceWithdrawId: response.data?.id,
    raw: response.data
  };
}

module.exports = {
  getCurrentPrice,
  getQuantityStepSize,
  getSpotTradableSymbols,
  placeMarketBuyOrder,
  placeMarketSellOrder,
  getLedger,
  getTotalSpentUsd,
  getTotalQtyHeld,
  computeUnrealizedPnl,
  assertLiveTradingAllowed,
  getDepositAddress,
  getRecentDeposits,
  getAssetBalance,
  assertLiveWithdrawalAllowed,
  withdraw,
  // Exported so other modules that independently call Binance's spot API
  // (binanceEarnService.js) share this exact cooldown/throttle/kill-switch state
  // instead of each tracking their own.
  assertSpotNotRateLimited,
  noteSpotRateLimitResponse,
  // Exported separately (not just folded into assertSpotNotRateLimited) so a caller
  // can check "is spot even allowed right now" up front and skip its whole cycle
  // quietly, instead of attempting a call just to catch the same error every time.
  assertSpotCallsAllowed
};

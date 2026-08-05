// Real Binance USDT-M futures trading service — REAL MONEY, LEVERAGED. This is the
// only module that talks to Binance Futures. Physically separate from
// realTradingService.js (spot) and walletService.js/wallet.json (fabricated in-app
// "earnings"). No shared code paths beyond the isLikelyRealBinanceKey validator,
// used here as an independent defense-in-depth check.
//
// Leverage risk: at high leverage a small adverse price move can liquidate the
// entire margin for a position. This module never widens risk on its own — it only
// ever opens the exact position size the caller requests and (if configured) attaches
// a stop-loss order at open time.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const { Config, isLikelyRealBinanceKey } = require('../config/config');

const config = new Config();
const persistenceEnabled = config.get('agentManager.persistenceEnabled', true);
const realFuturesTradesFilePath = path.join(process.cwd(), 'real_futures_trades.json');

const FAPI_BASE = 'https://fapi.binance.com';

let RealFuturesTrade;
function getRealFuturesTradeModel() {
  if (!RealFuturesTrade) {
    RealFuturesTrade = require('../models/RealFuturesTrade');
  }
  return RealFuturesTrade;
}

function loadTradesFromFile() {
  try {
    if (fs.existsSync(realFuturesTradesFilePath)) {
      const data = fs.readFileSync(realFuturesTradesFilePath, 'utf8');
      try {
        const parsed = JSON.parse(data);
        return Array.isArray(parsed.trades) ? parsed.trades : [];
      } catch (parseError) {
        console.warn('real_futures_trades.json contains invalid JSON, starting with empty ledger');
        return [];
      }
    }
    return [];
  } catch (error) {
    console.error('Error loading real futures trades file:', error);
    return [];
  }
}

function saveTradesToFile(trades) {
  try {
    fs.writeFileSync(realFuturesTradesFilePath, JSON.stringify({ trades }, null, 2), 'utf8');
  } catch (error) {
    console.error('Error saving real futures trades file:', error);
    throw error;
  }
}

async function appendTrade(tradeRecord) {
  if (persistenceEnabled) {
    const Model = getRealFuturesTradeModel();
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
 * Patch fields onto an already-persisted trade record (e.g. stopOrderId/stopPrice
 * determined after the initial fill was recorded). Without this, in-memory mutations
 * to a trade object after appendTrade() has already written it are silently lost —
 * this previously caused stop-loss attachment failures to vanish without a trace in
 * the ledger, making a real risk gap invisible.
 * @param {string} binanceOrderId the entry order's binanceOrderId, used to find the record
 * @param {Object} updates fields to merge in
 */
async function updateTradeByOrderId(binanceOrderId, updates) {
  if (persistenceEnabled) {
    const Model = getRealFuturesTradeModel();
    await Model.updateOne({ binanceOrderId: String(binanceOrderId) }, { $set: updates });
    return;
  }

  const trades = loadTradesFromFile();
  const index = trades.findIndex(t => t.binanceOrderId === String(binanceOrderId));
  if (index !== -1) {
    trades[index] = { ...trades[index], ...updates };
    saveTradesToFile(trades);
  }
}

/**
 * Get all real futures trades for an agent, sorted oldest -> newest.
 * @param {string} agentId
 * @returns {Promise<Array>}
 */
async function getLedger(agentId) {
  if (persistenceEnabled) {
    const Model = getRealFuturesTradeModel();
    const docs = await Model.find({ agentId }).sort({ timestamp: 1 }).lean();
    return docs;
  }

  const trades = loadTradesFromFile();
  return trades
    .filter(t => t.agentId === agentId)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

/**
 * Total real USD margin committed (BUY orders) minus margin freed by SELL/close orders,
 * for an agent. This is what the budget cap is measured against — not notional value.
 * @param {string} agentId
 * @returns {Promise<number>}
 */
// Whether a margin+SELL trade is opening a short (uses margin) or closing a long
// (frees margin) can't be told apart from `side` alone once shorts exist. Trades
// recorded going forward carry an explicit `action`; older ledger entries (recorded
// before shorts existed, all long-only) have none, so for those the pre-existing
// inference — anything that isn't a BUY is a close — still applies unchanged.
function isCloseTrade(trade) {
  return trade.action ? trade.action === 'close' : trade.side !== 'BUY';
}

async function getTotalMarginUsd(agentId) {
  const ledger = await getLedger(agentId);
  return ledger.reduce((sum, trade) => {
    return isCloseTrade(trade) ? sum - trade.marginUsd : sum + trade.marginUsd;
  }, 0);
}

/**
 * Full real futures trade ledger across EVERY agent, not just one — the basis for the
 * global cross-agent exposure cap. Running multiple leveraged strategies at once must
 * not silently multiply real risk just because each agent only checks its own budget.
 * @returns {Promise<Array>}
 */
async function getFullLedger() {
  if (persistenceEnabled) {
    const Model = getRealFuturesTradeModel();
    return Model.find({}).sort({ timestamp: 1 }).lean();
  }
  return loadTradesFromFile();
}

/**
 * Total real USD margin committed across ALL agents/strategies combined. This is what
 * GLOBAL_FUTURES_BUDGET_CAP_USD is measured against — every real futures agent must
 * check this (in addition to its own per-agent cap) before opening a new position, so
 * running N strategies simultaneously never allows more than one strategy's worth of
 * real exposure at a time unless the cap is deliberately raised.
 * @returns {Promise<number>}
 */
async function getTotalMarginUsdAllAgents() {
  const ledger = await getFullLedger();
  return ledger.reduce((sum, trade) => {
    return isCloseTrade(trade) ? sum - trade.marginUsd : sum + trade.marginUsd;
  }, 0);
}

/**
 * Real closed-trade performance for one symbol, straight from Binance's own income
 * history (REALIZED_PNL events) — the basis for letting an agent "learn from its
 * trades": if a specific symbol has a real, accumulating pattern of losses across
 * enough closed trades to not just be noise, that's a fact an agent can act on
 * automatically, the same way meanReversionFutures and breakoutFutures were retired
 * manually after their own real trade/backtest histories showed the same thing.
 * @param {string} symbol
 * @returns {Promise<{closedTradeCount: number, netRealizedPnlUsd: number, winCount: number, lossCount: number}>}
 */
async function getSymbolPerformance(symbol) {
  const income = await getIncomeHistory({ incomeType: 'REALIZED_PNL' });
  const symbolEntries = income.filter(e => e.symbol === symbol).map(e => parseFloat(e.income));

  return {
    closedTradeCount: symbolEntries.length,
    netRealizedPnlUsd: symbolEntries.reduce((sum, pnl) => sum + pnl, 0),
    winCount: symbolEntries.filter(pnl => pnl > 0).length,
    lossCount: symbolEntries.filter(pnl => pnl <= 0).length
  };
}

/**
 * Remaining real margin an agent is allowed to spend right now, respecting BOTH its
 * own per-agent budgetCapUsd AND the shared cross-agent globalFuturesBudgetCapUsd —
 * whichever is tighter wins. Every real futures agent should size its next trade off
 * this, not off its own per-agent budget alone, so running multiple strategies at once
 * can never silently multiply real exposure past the global ceiling.
 * @param {string} agentId
 * @param {number} perAgentCapUsd this agent's own budgetCapUsd
 * @returns {Promise<{remaining: number, spentByAgent: number, spentAllAgents: number, globalCapUsd: number}>}
 */
async function getEffectiveRemainingBudgetUsd(agentId, perAgentCapUsd) {
  const globalCapUsd = config.get('liveTrading.globalFuturesBudgetCapUsd', 50);
  const [spentByAgent, spentAllAgents] = await Promise.all([
    getTotalMarginUsd(agentId),
    getTotalMarginUsdAllAgents()
  ]);

  const remainingPerAgent = perAgentCapUsd - spentByAgent;
  const remainingGlobal = globalCapUsd - spentAllAgents;

  return {
    remaining: Math.max(0, Math.min(remainingPerAgent, remainingGlobal)),
    spentByAgent,
    spentAllAgents,
    globalCapUsd
  };
}

/**
 * Real, currently-open futures positions with live unrealized P&L, straight from
 * Binance (catches positions closed/reduced by a stop-loss fill, liquidation, or
 * anything else — not dependent on this app's local ledger).
 * @returns {Promise<Array<{symbol, positionAmt, entryPrice, unrealizedProfit, leverage}>>}
 */
let openPositionsCache = null;
let openPositionsCacheAt = 0;
const OPEN_POSITIONS_CACHE_TTL_MS = 3000; // the dashboard polls this every 5s (possibly from
// multiple open tabs) — a short cache collapses concurrent/overlapping polls into one call.

async function getOpenPositions() {
  const now = Date.now();
  if (openPositionsCache && (now - openPositionsCacheAt) < OPEN_POSITIONS_CACHE_TTL_MS) {
    return openPositionsCache;
  }
  const data = await signedRequest('GET', '/fapi/v2/positionRisk', {});
  const mapped = data
    .filter(p => parseFloat(p.positionAmt) !== 0)
    .map(p => ({
      symbol: p.symbol,
      positionAmt: parseFloat(p.positionAmt),
      entryPrice: parseFloat(p.entryPrice),
      markPrice: parseFloat(p.markPrice),
      unrealizedProfit: parseFloat(p.unRealizedProfit),
      leverage: parseFloat(p.leverage)
    }));
  openPositionsCache = mapped;
  openPositionsCacheAt = now;
  return mapped;
}

/**
 * Real account income history (realized P&L, commissions, funding fees) straight
 * from Binance — the authoritative source for "how much did this account actually
 * make/lose today", independent of this app's local trade ledger.
 * @param {Object} params
 * @param {number} [params.startTime] ms epoch
 * @param {string} [params.incomeType] e.g. 'REALIZED_PNL', 'COMMISSION', 'FUNDING_FEE'
 * @returns {Promise<Array>}
 */
// The dashboard polls the real-money summary every few seconds, and each poll was
// firing off up to 4 separate /fapi/v1/income requests (weight 30 each). Income
// history doesn't change faster than trades close, so a short TTL cache collapses
// bursts of identical requests into one Binance call — this is what keeps the app
// from tripping Binance's rate limiter into a 418 IP ban under normal dashboard use.
const INCOME_CACHE_TTL_MS = 20000;
const incomeCache = new Map();

async function getIncomeHistory({ startTime, incomeType } = {}) {
  const params = { limit: 1000 };
  if (startTime) params.startTime = startTime;
  if (incomeType) params.incomeType = incomeType;

  const cacheKey = JSON.stringify(params);
  const cached = incomeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const data = await signedRequest('GET', '/fapi/v1/income', params);
  incomeCache.set(cacheKey, { data, expiresAt: Date.now() + INCOME_CACHE_TTL_MS });
  return data;
}

function startOfTodayUtcMs() {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/**
 * Sum of real realized P&L (closed/reduced positions) since the start of the current
 * UTC day, straight from Binance's own income ledger.
 * @returns {Promise<number>}
 */
async function getTodaysRealizedPnlUsd() {
  const income = await getIncomeHistory({ startTime: startOfTodayUtcMs(), incomeType: 'REALIZED_PNL' });
  return income.reduce((sum, entry) => sum + parseFloat(entry.income), 0);
}

/**
 * Sum of real commissions paid since the start of the current UTC day (negative =
 * cost to the account).
 * @returns {Promise<number>}
 */
async function getTodaysCommissionUsd() {
  const income = await getIncomeHistory({ startTime: startOfTodayUtcMs(), incomeType: 'COMMISSION' });
  return income.reduce((sum, entry) => sum + parseFloat(entry.income), 0);
}

/**
 * All-time real trading history summary, derived from Binance's own income ledger —
 * not a separate cache that could drift out of sync, and not dependent on any
 * in-memory agent state (which resets to zero on every restart). This is what
 * actually answers "what was our last profit/loss" and "are we winning overall"
 * without having to manually reconstruct it after every restart.
 * @returns {Promise<Object>}
 */
async function getTradeHistorySummary() {
  const realizedEntries = await getIncomeHistory({ incomeType: 'REALIZED_PNL' });
  const commissionEntries = await getIncomeHistory({ incomeType: 'COMMISSION' });

  const sorted = realizedEntries
    .map(e => ({ ...e, income: parseFloat(e.income), time: parseInt(e.time) }))
    .sort((a, b) => a.time - b.time);

  const totalRealizedPnlUsd = sorted.reduce((sum, e) => sum + e.income, 0);
  const totalCommissionUsd = commissionEntries.reduce((sum, e) => sum + parseFloat(e.income), 0);
  const wins = sorted.filter(e => e.income > 0);
  const losses = sorted.filter(e => e.income < 0);
  const lastTrade = sorted[sorted.length - 1] || null;
  const bestTrade = sorted.length > 0 ? sorted.reduce((a, b) => (b.income > a.income ? b : a)) : null;
  const worstTrade = sorted.length > 0 ? sorted.reduce((a, b) => (b.income < a.income ? b : a)) : null;

  return {
    totalRealizedPnlUsd,
    totalCommissionUsd,
    netUsd: totalRealizedPnlUsd + totalCommissionUsd,
    closedTradeCount: sorted.length,
    winCount: wins.length,
    lossCount: losses.length,
    winRatePct: sorted.length > 0 ? (wins.length / sorted.length) * 100 : null,
    lastTrade: lastTrade ? { symbol: lastTrade.symbol, pnlUsd: lastTrade.income, time: new Date(lastTrade.time) } : null,
    bestTrade: bestTrade ? { symbol: bestTrade.symbol, pnlUsd: bestTrade.income, time: new Date(bestTrade.time) } : null,
    worstTrade: worstTrade ? { symbol: worstTrade.symbol, pnlUsd: worstTrade.income, time: new Date(worstTrade.time) } : null
  };
}

/**
 * Real current available USDT balance in the futures wallet (i.e. actually free to
 * use as margin for a new position, not locked in existing positions/orders).
 * @returns {Promise<number>}
 */
async function getAvailableFuturesBalanceUsd() {
  const data = await signedRequest('GET', '/fapi/v2/balance', {});
  const usdt = data.find(b => b.asset === 'USDT');
  return usdt ? parseFloat(usdt.availableBalance) : 0;
}

/**
 * Set of symbols this agent has already opened a position in today (UTC date), to
 * enforce a one-open-per-symbol-per-day cooldown and prevent repeatedly re-entering
 * the same symbol on a noisy signal.
 * @param {string} agentId
 * @returns {Promise<Set<string>>}
 */
async function getSymbolsTradedToday(agentId) {
  const ledger = await getLedger(agentId);
  const today = new Date().toISOString().slice(0, 10);
  return new Set(
    ledger
      .filter(t => new Date(t.timestamp).toISOString().slice(0, 10) === today)
      .map(t => t.symbol)
  );
}

/**
 * Real (unauthenticated, public) current market price for a futures symbol.
 * @param {string} symbol e.g. 'BTCUSDT'
 * @returns {Promise<number>}
 */
async function getCurrentPrice(symbol) {
  const data = await publicRequest('/fapi/v1/ticker/price', { symbol });
  return parseFloat(data.price);
}

let exchangeInfoCache = null;
let exchangeInfoCacheAt = 0;
const EXCHANGE_INFO_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours — symbol listings rarely change

async function getExchangeInfo() {
  const now = Date.now();
  if (exchangeInfoCache && (now - exchangeInfoCacheAt) < EXCHANGE_INFO_TTL_MS) {
    return exchangeInfoCache;
  }
  const data = await publicRequest('/fapi/v1/exchangeInfo');
  exchangeInfoCache = data;
  exchangeInfoCacheAt = now;
  return data;
}

/**
 * Fetch the quantity step size (LOT_SIZE filter) for a symbol, so order quantities
 * can be rounded to a value Binance will accept.
 * @param {string} symbol
 * @returns {Promise<number>} step size, e.g. 0.001
 */
async function getQuantityStepSize(symbol) {
  const data = await getExchangeInfo();
  const symbolInfo = data.symbols.find(s => s.symbol === symbol);
  if (!symbolInfo) {
    throw new Error(`Symbol ${symbol} not found in futures exchange info`);
  }
  const lotSizeFilter = symbolInfo.filters.find(f => f.filterType === 'LOT_SIZE');
  return lotSizeFilter ? parseFloat(lotSizeFilter.stepSize) : 0.001;
}

/**
 * Fetch the price tick size (PRICE_FILTER filter) for a symbol — the precision Binance
 * requires for prices like a STOP_MARKET order's stopPrice. This is DIFFERENT from
 * getQuantityStepSize's LOT_SIZE (which governs order quantity, not price) — conflating
 * the two previously caused stop-loss prices to be rounded to the wrong precision
 * (e.g. 2 decimal places for a coin priced at $0.02233, which Binance silently
 * rejected, leaving real positions with no stop-loss at all).
 * @param {string} symbol
 * @returns {Promise<number>} tick size, e.g. 0.0001
 */
async function getPriceTickSize(symbol) {
  const data = await getExchangeInfo();
  const symbolInfo = data.symbols.find(s => s.symbol === symbol);
  if (!symbolInfo) {
    throw new Error(`Symbol ${symbol} not found in futures exchange info`);
  }
  const priceFilter = symbolInfo.filters.find(f => f.filterType === 'PRICE_FILTER');
  return priceFilter ? parseFloat(priceFilter.tickSize) : 0.01;
}

/**
 * Format a price to the decimal precision implied by a tick size (e.g. tickSize
 * 0.0001 -> 4 decimal places), the way roundDownToStep does for quantities. Needed
 * because toFixed(2) on a sub-cent price silently produces a wildly wrong stop price.
 * @param {number} price
 * @param {number} tickSize
 * @returns {string}
 */
function formatPriceForTickSize(price, tickSize) {
  const precision = Math.max(0, Math.round(-Math.log10(tickSize)));
  return roundDownToStep(price, tickSize).toFixed(precision);
}

/**
 * List of actively tradable USDT-margined perpetual symbols (excludes stablecoin
 * pairs like USDCUSDT, which never meaningfully "breakout", and anything not
 * currently TRADING).
 * @returns {Promise<string[]>}
 */
async function getUsdtPerpetualSymbols() {
  const data = await getExchangeInfo();
  const STABLE_BASES = new Set(['USDC', 'BUSD', 'FDUSD', 'TUSD', 'USDP', 'DAI', 'EUR']);
  return data.symbols
    .filter(s =>
      s.quoteAsset === 'USDT' &&
      s.contractType === 'PERPETUAL' &&
      s.status === 'TRADING' &&
      !STABLE_BASES.has(s.baseAsset)
    )
    .map(s => s.symbol);
}

/**
 * Bulk 24hr ticker stats for every futures symbol in a single API call (cheap on
 * rate limits compared to per-symbol requests). Used as the input to breakout detection.
 * @returns {Promise<Array<{symbol, lastPrice, highPrice, priceChangePercent, quoteVolume}>>}
 */
let tickersCache = null;
let tickersCacheAt = 0;
const TICKERS_CACHE_TTL_MS = 30000; // both breakoutFutures (5min) and meanReversionFutures
// (15min) scan cycles call this weight-40 endpoint independently — a short cache means
// two scanners that happen to fire close together share one Binance call instead of two.

async function getAll24hrTickers() {
  const now = Date.now();
  if (tickersCache && (now - tickersCacheAt) < TICKERS_CACHE_TTL_MS) {
    return tickersCache;
  }
  const data = await publicRequest('/fapi/v1/ticker/24hr');
  const mapped = data.map(t => ({
    symbol: t.symbol,
    lastPrice: parseFloat(t.lastPrice),
    highPrice: parseFloat(t.highPrice),
    lowPrice: parseFloat(t.lowPrice),
    priceChangePercent: parseFloat(t.priceChangePercent),
    quoteVolume: parseFloat(t.quoteVolume)
  }));
  tickersCache = mapped;
  tickersCacheAt = now;
  return mapped;
}

/**
 * Real historical candlestick data for a symbol, straight from Binance Futures.
 * @param {string} symbol
 * @param {string} interval e.g. '1h', '4h'
 * @param {number} limit number of candles (max 1500)
 * @returns {Promise<Array<{closeTime, open, high, low, close, volume}>>}
 */
async function getKlines(symbol, interval, limit = 100) {
  const data = await publicRequest('/fapi/v1/klines', { symbol, interval, limit });
  return data.map(k => ({
    closeTime: k[6],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5])
  }));
}

/**
 * Real current funding rate for a perpetual, straight from Binance's premium index —
 * the basis for funding-rate arbitrage (short the perp + hold spot when funding is
 * paid BY longs TO shorts, i.e. lastFundingRate > 0). Funding is settled every 8h;
 * this returns the currently-accruing rate, not a historical average.
 * @param {string} symbol e.g. 'BTCUSDT'
 * @returns {Promise<{symbol: string, lastFundingRate: number, nextFundingTime: number, markPrice: number}>}
 */
async function getFundingRate(symbol) {
  const data = await publicRequest('/fapi/v1/premiumIndex', { symbol });
  return {
    symbol: data.symbol,
    lastFundingRate: parseFloat(data.lastFundingRate),
    nextFundingTime: data.nextFundingTime,
    markPrice: parseFloat(data.markPrice)
  };
}

function roundDownToStep(quantity, stepSize) {
  const precision = Math.max(0, Math.round(-Math.log10(stepSize)));
  const factor = Math.pow(10, precision);
  return Math.floor(quantity * factor) / factor;
}

function signedQuery(params) {
  const queryString = Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
  const signature = crypto
    .createHmac('sha256', process.env.BINANCE_API_SECRET)
    .update(queryString)
    .digest('hex');
  return `${queryString}&signature=${signature}`;
}

// Binance responds 429 (soft limit) then 418 (IP banned) to callers that keep
// sending requests after being told to slow down. Once either happens, honor the
// Retry-After it sends and refuse ALL further Binance calls — signed AND public,
// since Binance bans by IP, not by endpoint or credential — until it elapses.
// Retrying immediately during a ban only extends it, and previously only
// signedRequest respected this, so getCurrentPrice/getAll24hrTickers/getKlines/
// getExchangeInfo (all unsigned) kept hitting Binance during an active ban and
// could each independently trigger Binance to extend it further.
//
// Persisted to Mongo (2026-08-05), not just in-memory: this variable used to reset to
// 0 on every process restart, so a deploy during an active ban made the app forget it
// and immediately retry — which just earns a fresh, often longer, ban from Binance's
// own escalating-repeat-offender behavior. Every redeploy was silently making an
// active ban worse. Best-effort — if Mongo is briefly unavailable this falls back to
// in-memory-only behavior exactly like before, never blocks a request on its own.
let rateLimitedUntil = 0;
let rateLimitStateLoadedFromDb = false;

let RateLimitState;
function getRateLimitStateModel() {
  if (!RateLimitState) {
    RateLimitState = require('../models/RateLimitState');
  }
  return RateLimitState;
}

async function loadPersistedRateLimitState() {
  if (rateLimitStateLoadedFromDb || !persistenceEnabled) return;
  rateLimitStateLoadedFromDb = true;
  try {
    const Model = getRateLimitStateModel();
    const doc = await Model.findOne({ key: 'binanceFutures' }).lean();
    if (doc && doc.rateLimitedUntil > rateLimitedUntil) {
      rateLimitedUntil = doc.rateLimitedUntil;
    }
  } catch (error) {
    // Mongo not reachable yet (e.g. very early in boot) — proceed in-memory only.
  }
}

function persistRateLimitState(until) {
  if (!persistenceEnabled) return;
  try {
    const Model = getRateLimitStateModel();
    Model.findOneAndUpdate(
      { key: 'binanceFutures' },
      { rateLimitedUntil: until, updatedAt: new Date() },
      { upsert: true }
    ).catch(() => {});
  } catch (error) {
    // Best-effort — an in-memory-only cooldown still applies for this process's lifetime.
  }
}

async function assertNotRateLimited() {
  await loadPersistedRateLimitState();
  if (Date.now() < rateLimitedUntil) {
    const waitSec = Math.ceil((rateLimitedUntil - Date.now()) / 1000);
    throw new Error(`Binance rate limit/ban in effect, retry in ${waitSec}s`);
  }
}

function noteRateLimitResponse(error) {
  const status = error.response?.status;
  if (status === 429 || status === 418) {
    const retryAfterSec = parseInt(error.response.headers['retry-after'], 10);
    const cooldownMs = Number.isFinite(retryAfterSec) ? retryAfterSec * 1000 : 60000;
    rateLimitedUntil = Date.now() + cooldownMs;
    persistRateLimitState(rateLimitedUntil);
  }
}

// Binance rejects a signed request if its `timestamp` is ahead of Binance's own server
// clock by more than ~1000ms (error -1021) — about the LOCAL machine's clock drifting,
// not request latency. Measured against realTradingService's identical fix (spot side
// was hitting this on every single DCA cycle); synced independently here since futures
// uses its own base URL/server-time endpoint.
let timeOffsetMs = 0;
let timeOffsetSyncedAt = 0;
const TIME_OFFSET_TTL_MS = 30 * 60 * 1000;

async function getSyncedTimestamp() {
  const now = Date.now();
  if (now - timeOffsetSyncedAt > TIME_OFFSET_TTL_MS) {
    try {
      const { data } = await axios.get(`${FAPI_BASE}/fapi/v1/time`);
      timeOffsetMs = data.serverTime - Date.now();
      timeOffsetSyncedAt = now;
    } catch (error) {
      // Fall back to whatever offset is already known rather than blocking the caller.
    }
  }
  return Date.now() + timeOffsetMs;
}

async function signedRequest(method, endpoint, params) {
  await assertNotRateLimited();

  const query = signedQuery({ ...params, timestamp: await getSyncedTimestamp() });
  const url = `${FAPI_BASE}${endpoint}?${query}`;
  try {
    const { data } = await axios({
      method,
      url,
      headers: { 'X-MBX-APIKEY': process.env.BINANCE_API_KEY }
    });
    return data;
  } catch (error) {
    noteRateLimitResponse(error);
    throw error;
  }
}

/**
 * Unsigned/public Binance Futures GET, sharing the same rate-limit cooldown as
 * signedRequest — Binance bans the IP regardless of which endpoint tripped it.
 * @param {string} endpoint e.g. '/fapi/v1/ticker/price'
 * @param {Object} [params]
 * @returns {Promise<*>}
 */
async function publicRequest(endpoint, params = {}) {
  await assertNotRateLimited();

  try {
    const { data } = await axios.get(`${FAPI_BASE}${endpoint}`, { params });
    return data;
  } catch (error) {
    noteRateLimitResponse(error);
    throw error;
  }
}

/**
 * Lightweight connectivity check for the /health endpoint. Routed through the same
 * shared rate-limit gate as every other call (assertNotRateLimited/publicRequest)
 * specifically so a health check fired during an active ban doesn't itself send a
 * fresh request to Binance and extend it — a raw, ungated ping call was doing exactly
 * that (discovered 2026-08-05: repeated /health polling was independently triggering/
 * prolonging 418s that had nothing to do with the trading agents' own request volume).
 */
async function pingBinance() {
  await publicRequest('/fapi/v1/ping');
}

/**
 * Defense-in-depth guard: real leveraged futures orders require BOTH the general
 * live-trading opt-in AND a second, separate futures-specific opt-in, plus real
 * (non-placeholder) Binance credentials. Independent of realTradingService's (spot)
 * gate and walletService's gate — this module never calls into either.
 */
function assertLiveFuturesTradingAllowed() {
  const liveConfirmed = process.env.LIVE_TRADING_CONFIRMED === 'true';
  const futuresConfirmed = process.env.LIVE_FUTURES_TRADING_CONFIRMED === 'true';
  const keysReal =
    isLikelyRealBinanceKey(process.env.BINANCE_API_KEY) &&
    isLikelyRealBinanceKey(process.env.BINANCE_API_SECRET);

  if (!liveConfirmed || !futuresConfirmed || !keysReal) {
    throw new Error(
      'Real futures trading blocked: requires LIVE_TRADING_CONFIRMED=true, ' +
      'LIVE_FUTURES_TRADING_CONFIRMED=true, and validated (non-placeholder) BINANCE_API_KEY/SECRET.'
    );
  }
}

async function setLeverage(symbol, leverage) {
  return signedRequest('POST', '/fapi/v1/leverage', { symbol, leverage });
}

async function setMarginType(symbol, marginType) {
  try {
    return await signedRequest('POST', '/fapi/v1/marginType', { symbol, marginType });
  } catch (error) {
    // Binance returns "No need to change margin type" if it's already set — not a real error.
    if (error.response && error.response.data && error.response.data.code === -4046) {
      return { alreadySet: true };
    }
    throw error;
  }
}

async function getOrderStatus(symbol, orderId) {
  return signedRequest('GET', '/fapi/v1/order', { symbol, orderId });
}

/**
 * Binance Futures MARKET orders can return their initial ACK with status "NEW" and
 * executedQty "0.0" even though the order fills moments later — unlike spot, which
 * synchronously returns a `fills` array. Polling GET /fapi/v1/order until a terminal
 * status is the only reliable way to know whether an order actually filled. Getting
 * this wrong previously caused a real position to open with NO stop-loss attached
 * (because the code treated a since-filled order as failed) — do not revert to
 * trusting the initial order-placement response alone.
 * @param {string} symbol
 * @param {string|number} orderId
 * @returns {Promise<Object>} final order state
 */
async function waitForOrderFill(symbol, orderId, { maxAttempts = 10, delayMs = 300 } = {}) {
  // FILLED/CANCELED/EXPIRED/REJECTED are all terminal — stop polling immediately.
  // PARTIALLY_FILLED is NOT terminal (more fill may still arrive) but IS usable if
  // polling runs out of attempts, so it's handled by simply returning whatever the
  // last poll saw once the loop ends, rather than being special-cased here.
  const TERMINAL_STATUSES = new Set(['FILLED', 'CANCELED', 'EXPIRED', 'REJECTED']);
  let lastOrder = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    lastOrder = await getOrderStatus(symbol, orderId);
    if (TERMINAL_STATUSES.has(lastOrder.status)) {
      return lastOrder;
    }
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  return lastOrder;
}

/**
 * Real per-fill trade detail (price, qty, commission) for an order, straight from
 * Binance — the futures equivalent of spot's `fills` array, which futures order
 * responses don't include.
 * @param {string} symbol
 * @param {string|number} orderId
 * @returns {Promise<Array>}
 */
async function getOrderTrades(symbol, orderId) {
  return signedRequest('GET', '/fapi/v1/userTrades', { symbol, orderId });
}

/**
 * Open a REAL leveraged position (long or short) via market order, sized so that
 * marginUsd * leverage is spent at the current market price, then attach a
 * STOP_MARKET order (if stopLossPct given) and/or a TAKE_PROFIT_MARKET order (if
 * takeProfitPct given) to close the position automatically. Without a take-profit,
 * a large favorable move has nothing that locks in the gain — the position just sits
 * until it either keeps climbing (rare) or gives it all back and beyond (the failure
 * mode that actually happened: a position showing several hundred percent unrealized
 * gain was never closed and was later liquidated on the way back down).
 * @param {Object} params
 * @param {string} params.symbol e.g. 'BTCUSDT'
 * @param {'BUY'|'SELL'} params.side entry side — BUY opens a long, SELL opens a short
 * @param {number} params.marginUsd USD margin to commit to this position
 * @param {number} params.leverage e.g. 50
 * @param {string} params.marginMode 'ISOLATED' or 'CROSSED'
 * @param {number} [params.stopLossPct] e.g. 0.01 for a 1% stop-loss
 * @param {number} [params.takeProfitPct] e.g. 0.03 for a 3% take-profit
 * @param {string} params.agentId
 * @returns {Promise<Object>} the recorded trade
 */
async function openLeveragedPosition({ symbol, side, marginUsd, leverage, marginMode, stopLossPct, takeProfitPct, agentId }) {
  assertLiveFuturesTradingAllowed();

  await setMarginType(symbol, marginMode);
  await setLeverage(symbol, leverage);

  const [currentPrice, stepSize] = await Promise.all([
    getCurrentPrice(symbol),
    getQuantityStepSize(symbol)
  ]);

  const notionalUsd = marginUsd * leverage;
  const rawQty = notionalUsd / currentPrice;
  const quantity = roundDownToStep(rawQty, stepSize);

  if (quantity <= 0) {
    throw new Error(
      `Computed order quantity rounds down to 0 (marginUsd=${marginUsd}, leverage=${leverage}, ` +
      `price=${currentPrice}, stepSize=${stepSize}). Increase marginUsd.`
    );
  }

  const placedOrder = await signedRequest('POST', '/fapi/v1/order', {
    symbol,
    side,
    type: 'MARKET',
    quantity
  });

  const finalOrder = await waitForOrderFill(symbol, placedOrder.orderId);
  const orderTrades = finalOrder.status === 'FILLED' || parseFloat(finalOrder.executedQty) > 0
    ? await getOrderTrades(symbol, placedOrder.orderId).catch(() => [])
    : [];

  const trade = await recordFill(finalOrder, orderTrades, { symbol, side, marginUsd, leverage, marginMode, agentId });

  // A short's stop-loss/take-profit close in the opposite direction of a long's: the
  // closing side is always the entry side's inverse, and stop/take-profit trigger
  // prices sit on opposite sides of the fill price (a short loses money as price
  // rises, so its stop-loss triggers ABOVE the fill price, not below).
  const closeSide = side === 'BUY' ? 'SELL' : 'BUY';
  const stopDirection = side === 'BUY' ? -1 : 1;
  const takeProfitDirection = side === 'BUY' ? 1 : -1;

  if (stopLossPct && trade.status === 'filled') {
    try {
      // Price precision (PRICE_FILTER.tickSize) is NOT the same as quantity precision
      // (LOT_SIZE.stepSize, `stepSize` above) — using the wrong one previously produced
      // stop prices Binance silently rejected, leaving real positions unprotected.
      const priceTickSize = await getPriceTickSize(symbol);
      const rawStopPrice = trade.fillPrice * (1 + stopDirection * stopLossPct);
      const stopPriceFormatted = formatPriceForTickSize(rawStopPrice, priceTickSize);
      // Binance migrated conditional orders (STOP_MARKET/TAKE_PROFIT_MARKET/etc.) off
      // /fapi/v1/order to a dedicated Algo Order API effective 2025-12-09 (error -4120
      // if the old endpoint is used). A real position was opened with NEITHER a
      // stop-loss NOR a take-profit as a direct result of this before the fix — do not
      // revert to POST /fapi/v1/order for conditional order types.
      const stopOrder = await signedRequest('POST', '/fapi/v1/algoOrder', {
        algoType: 'CONDITIONAL',
        symbol,
        side: closeSide,
        type: 'STOP_MARKET',
        triggerPrice: stopPriceFormatted,
        closePosition: 'true',
        workingType: 'MARK_PRICE'
      });
      trade.stopOrderId = stopOrder.algoId ? String(stopOrder.algoId) : undefined;
      trade.stopPrice = parseFloat(stopPriceFormatted);
      await updateTradeByOrderId(trade.binanceOrderId, { stopOrderId: trade.stopOrderId, stopPrice: trade.stopPrice });
    } catch (error) {
      trade.stopOrderError = error.response ? JSON.stringify(error.response.data) : error.message;
      await updateTradeByOrderId(trade.binanceOrderId, { stopOrderError: trade.stopOrderError });
    }
  } else if (trade.status === 'filled') {
    trade.stopOrderError = 'stopLossPct not set — position opened with NO stop-loss';
    await updateTradeByOrderId(trade.binanceOrderId, { stopOrderError: trade.stopOrderError });
  }

  if (takeProfitPct && trade.status === 'filled') {
    try {
      const priceTickSize = await getPriceTickSize(symbol);
      const rawTakeProfitPrice = trade.fillPrice * (1 + takeProfitDirection * takeProfitPct);
      const takeProfitPriceFormatted = formatPriceForTickSize(rawTakeProfitPrice, priceTickSize);
      const takeProfitOrder = await signedRequest('POST', '/fapi/v1/algoOrder', {
        algoType: 'CONDITIONAL',
        symbol,
        side: closeSide,
        type: 'TAKE_PROFIT_MARKET',
        triggerPrice: takeProfitPriceFormatted,
        closePosition: 'true',
        workingType: 'MARK_PRICE'
      });
      trade.takeProfitOrderId = takeProfitOrder.algoId ? String(takeProfitOrder.algoId) : undefined;
      trade.takeProfitPrice = parseFloat(takeProfitPriceFormatted);
      await updateTradeByOrderId(trade.binanceOrderId, { takeProfitOrderId: trade.takeProfitOrderId, takeProfitPrice: trade.takeProfitPrice });
    } catch (error) {
      trade.takeProfitOrderError = error.response ? JSON.stringify(error.response.data) : error.message;
      await updateTradeByOrderId(trade.binanceOrderId, { takeProfitOrderError: trade.takeProfitOrderError });
    }
  }

  return trade;
}

/**
 * Open a REAL leveraged long position. See openLeveragedPosition for full details.
 * @returns {Promise<Object>} the recorded trade
 */
async function openLeveragedLong(params) {
  return openLeveragedPosition({ ...params, side: 'BUY' });
}

/**
 * Open a REAL leveraged short position. See openLeveragedPosition for full details.
 * A short profits when price falls: entry is a SELL, and the resulting positionAmt
 * from /fapi/v2/positionRisk will be negative — closePosition() already handles that
 * sign correctly (it closes with BUY when positionAmt < 0), no changes needed there.
 * @returns {Promise<Object>} the recorded trade
 */
async function openLeveragedShort(params) {
  return openLeveragedPosition({ ...params, side: 'SELL' });
}

async function recordFill(finalOrder, orderTrades, { symbol, side, marginUsd, leverage, marginMode, agentId }) {
  const filledQty = orderTrades.reduce((sum, t) => sum + parseFloat(t.qty), 0) ||
    parseFloat(finalOrder.executedQty) || 0;
  const totalCost = orderTrades.reduce((sum, t) => sum + parseFloat(t.qty) * parseFloat(t.price), 0);
  const fillPrice = filledQty > 0
    ? (totalCost > 0 ? totalCost / filledQty : parseFloat(finalOrder.avgPrice) || 0)
    : parseFloat(finalOrder.avgPrice) || 0;
  const commission = orderTrades.reduce((sum, t) => sum + parseFloat(t.commission || 0), 0);
  const commissionAsset = orderTrades.length > 0 ? orderTrades[0].commissionAsset : '';

  const status = filledQty > 0
    ? (finalOrder.status === 'FILLED' ? 'filled' : 'partially_filled')
    : 'error';

  const tradeRecord = {
    agentId,
    timestamp: new Date(),
    action: 'open',
    side,
    symbol,
    leverage,
    marginMode,
    marginUsd,
    filledQty,
    fillPrice,
    commission,
    commissionAsset,
    binanceOrderId: finalOrder.orderId ? String(finalOrder.orderId) : undefined,
    status,
    raw: finalOrder
  };

  return appendTrade(tradeRecord);
}

/**
 * Cancel every open order (e.g. a stale stop-loss) for a symbol, then market-close
 * whatever position remains via a reduce-only order in the opposite direction. This
 * is the manual "undo" for openLeveragedLong — if the app can start a trade, it must
 * also be able to end one on request.
 * @param {string} symbol
 * @param {string} agentId agent this close should be attributed to in the ledger
 * @returns {Promise<Object>} { canceledOrders, closeTrade } — closeTrade is null if
 *   there was no open position to close
 */
async function closePosition(symbol, agentId) {
  assertLiveFuturesTradingAllowed();

  let canceledOrders = [];
  try {
    canceledOrders = await signedRequest('DELETE', '/fapi/v1/allOpenOrders', { symbol });
  } catch (error) {
    // No open orders to cancel is not an error condition worth failing the close over.
    canceledOrders = { note: error.response ? JSON.stringify(error.response.data) : error.message };
  }

  let canceledAlgoOrders = [];
  try {
    // Stop-loss/take-profit orders live in the separate Algo Order system since
    // Binance's 2025-12-09 migration — /fapi/v1/allOpenOrders does NOT cancel these,
    // so without this call a stale conditional order could be left behind after a
    // manual close, silently re-triggering later against whatever position exists then.
    canceledAlgoOrders = await signedRequest('DELETE', '/fapi/v1/algoOpenOrders', { symbol });
  } catch (error) {
    canceledAlgoOrders = { note: error.response ? JSON.stringify(error.response.data) : error.message };
  }

  const positions = await getOpenPositions();
  const position = positions.find(p => p.symbol === symbol);

  if (!position || position.positionAmt === 0) {
    return { canceledOrders, canceledAlgoOrders, closeTrade: null };
  }

  const stepSize = await getQuantityStepSize(symbol);
  const closeSide = position.positionAmt > 0 ? 'SELL' : 'BUY';
  const closeQty = roundDownToStep(Math.abs(position.positionAmt), stepSize);

  const placedOrder = await signedRequest('POST', '/fapi/v1/order', {
    symbol,
    side: closeSide,
    type: 'MARKET',
    quantity: closeQty,
    reduceOnly: true
  });

  const finalOrder = await waitForOrderFill(symbol, placedOrder.orderId);
  const orderTrades = finalOrder.status === 'FILLED' || parseFloat(finalOrder.executedQty) > 0
    ? await getOrderTrades(symbol, placedOrder.orderId).catch(() => [])
    : [];

  const filledQty = orderTrades.reduce((sum, t) => sum + parseFloat(t.qty), 0) ||
    parseFloat(finalOrder.executedQty) || 0;
  const totalCost = orderTrades.reduce((sum, t) => sum + parseFloat(t.qty) * parseFloat(t.price), 0);
  const fillPrice = filledQty > 0 && totalCost > 0 ? totalCost / filledQty : parseFloat(finalOrder.avgPrice) || 0;
  const commission = orderTrades.reduce((sum, t) => sum + parseFloat(t.commission || 0), 0);
  const commissionAsset = orderTrades.length > 0 ? orderTrades[0].commissionAsset : '';
  const realizedPnl = orderTrades.reduce((sum, t) => sum + parseFloat(t.realizedPnl || 0), 0);

  const closeTrade = await appendTrade({
    agentId,
    timestamp: new Date(),
    action: 'close',
    side: closeSide === 'SELL' ? 'SELL' : 'BUY',
    symbol,
    leverage: position.leverage,
    marginMode: 'N/A',
    marginUsd: Math.abs(position.positionAmt * position.entryPrice) / position.leverage,
    filledQty,
    fillPrice,
    commission,
    commissionAsset,
    binanceOrderId: finalOrder.orderId ? String(finalOrder.orderId) : undefined,
    status: filledQty > 0 ? (finalOrder.status === 'FILLED' ? 'filled' : 'partially_filled') : 'error',
    raw: { ...finalOrder, realizedPnl }
  });

  return { canceledOrders, canceledAlgoOrders, closeTrade };
}

module.exports = {
  getCurrentPrice,
  getQuantityStepSize,
  getPriceTickSize,
  getKlines,
  getFundingRate,
  getUsdtPerpetualSymbols,
  getAll24hrTickers,
  getSymbolsTradedToday,
  getAvailableFuturesBalanceUsd,
  getOpenPositions,
  getIncomeHistory,
  getTodaysRealizedPnlUsd,
  getTodaysCommissionUsd,
  getTradeHistorySummary,
  getSymbolPerformance,
  openLeveragedLong,
  openLeveragedShort,
  closePosition,
  getOrderStatus,
  getOrderTrades,
  waitForOrderFill,
  getLedger,
  getFullLedger,
  getTotalMarginUsd,
  getTotalMarginUsdAllAgents,
  getEffectiveRemainingBudgetUsd,
  assertLiveFuturesTradingAllowed,
  pingBinance
};

// Real Binance Simple Earn (flexible) service — REAL MONEY, but no leverage and no
// directional market exposure: subscribing moves an asset from "free spot balance"
// into a yield-bearing position in the SAME asset, redeemable back at any time. This
// is the only module that talks to Binance's Simple Earn (SAPI) endpoints. Shares the
// signed-request/time-sync pattern with realTradingService.js (spot trading) but is
// physically separate — no shared code path beyond isLikelyRealBinanceKey.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const { Config, isLikelyRealBinanceKey } = require('../config/config');

const config = new Config();
const persistenceEnabled = config.get('agentManager.persistenceEnabled', true);
const realEarnActionsFilePath = path.join(process.cwd(), 'real_earn_actions.json');

const BINANCE_BASE = 'https://api.binance.com';

// Same clock-skew protection as realTradingService.js — see that file's comment for
// why this exists (a real, repeatedly-hit failure mode, not defensive-only code).
let timeOffsetMs = 0;
let timeOffsetSyncedAt = 0;
const TIME_OFFSET_TTL_MS = 30 * 60 * 1000;

async function getSyncedTimestamp() {
  const now = Date.now();
  if (now - timeOffsetSyncedAt > TIME_OFFSET_TTL_MS) {
    try {
      const { data } = await axios.get(`${BINANCE_BASE}/api/v3/time`);
      timeOffsetMs = data.serverTime - Date.now();
      timeOffsetSyncedAt = now;
    } catch (error) {
      // Fall back to whatever offset is already known rather than blocking the caller.
      // Still record a 429/418 here so the shared gate knows about a ban even if this
      // was the first call to hit it.
      getSpotTradingService().noteSpotRateLimitResponse(error);
    }
  }
  return Date.now() + timeOffsetMs;
}

// Lazy require of the spot trading service, purely to reuse its Binance rate-limit
// gate — every call in this file hits api.binance.com, the exact same host/ban-bucket
// realTradingService.js already protects. This file previously had zero rate-limit
// protection of its own (found 2026-08-05 while auditing every Binance-calling module
// after a real IP ban) — sharing one gate instead of leaving this module to
// independently discover (or fail to discover) the same ban.
let spotTradingService;
function getSpotTradingService() {
  if (!spotTradingService) {
    spotTradingService = require('./realTradingService');
  }
  return spotTradingService;
}

let RealEarnAction;
function getRealEarnActionModel() {
  if (!RealEarnAction) {
    RealEarnAction = require('../models/RealEarnAction');
  }
  return RealEarnAction;
}

function loadActionsFromFile() {
  try {
    if (fs.existsSync(realEarnActionsFilePath)) {
      const data = fs.readFileSync(realEarnActionsFilePath, 'utf8');
      try {
        const parsed = JSON.parse(data);
        return Array.isArray(parsed.actions) ? parsed.actions : [];
      } catch (parseError) {
        console.warn('real_earn_actions.json contains invalid JSON, starting with empty ledger');
        return [];
      }
    }
    return [];
  } catch (error) {
    console.error('Error loading real earn actions file:', error);
    return [];
  }
}

function saveActionsToFile(actions) {
  fs.writeFileSync(realEarnActionsFilePath, JSON.stringify({ actions }, null, 2), 'utf8');
}

async function appendAction(actionRecord) {
  if (persistenceEnabled) {
    const Model = getRealEarnActionModel();
    const doc = await Model.create(actionRecord);
    return doc.toObject();
  }

  const actions = loadActionsFromFile();
  const record = { ...actionRecord, timestamp: actionRecord.timestamp || new Date() };
  actions.push(record);
  saveActionsToFile(actions);
  return record;
}

/**
 * Get all real Earn actions for an agent, sorted oldest -> newest.
 * @param {string} agentId
 * @returns {Promise<Array>}
 */
async function getLedger(agentId) {
  if (persistenceEnabled) {
    const Model = getRealEarnActionModel();
    const docs = await Model.find({ agentId }).sort({ timestamp: 1 }).lean();
    return docs;
  }

  const actions = loadActionsFromFile();
  return actions
    .filter(a => a.agentId === agentId)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

/**
 * Defense-in-depth guard, matching realTradingService.js's assertLiveTradingAllowed —
 * independent check, not a shared call, so a bug in one gate can't silently disable
 * the other.
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

async function signedRequest(method, endpoint, params) {
  await getSpotTradingService().assertSpotNotRateLimited();

  const timestamp = await getSyncedTimestamp();
  const query = signedQuery({ ...params, timestamp });
  const url = `${BINANCE_BASE}${endpoint}?${query}`;
  try {
    const { data } = await axios({
      method,
      url,
      headers: { 'X-MBX-APIKEY': process.env.BINANCE_API_KEY }
    });
    return data;
  } catch (error) {
    getSpotTradingService().noteSpotRateLimitResponse(error);
    if (error.response?.data) {
      error.message = `${error.message}: ${JSON.stringify(error.response.data)}`;
    }
    throw error;
  }
}

/**
 * Real free (available, unlocked) balance of an asset in the SPOT wallet — the pool
 * Earn subscriptions draw from. Distinct from futures margin balance and from any
 * amount already subscribed into an Earn position.
 * @param {string} asset e.g. 'USDT'
 * @returns {Promise<number>}
 */
async function getFreeSpotBalance(asset) {
  const data = await signedRequest('GET', '/api/v3/account', {});
  const entry = (data.balances || []).find(b => b.asset === asset);
  return entry ? parseFloat(entry.free) : 0;
}

/**
 * Real list of subscribable flexible Earn products for an asset, straight from
 * Binance — includes each product's current APY and subscription limits.
 * @param {string} asset e.g. 'USDT'
 * @returns {Promise<Array>}
 */
async function getFlexibleProducts(asset) {
  const data = await signedRequest('GET', '/sapi/v1/simple-earn/flexible/list', { asset });
  return data.rows || [];
}

/**
 * Real current flexible Earn positions for an asset — what's already subscribed and
 * earning, separate from getFreeSpotBalance (that's what ISN'T subscribed yet).
 * @param {string} asset e.g. 'USDT'
 * @returns {Promise<Array>}
 */
async function getFlexiblePositions(asset) {
  const data = await signedRequest('GET', '/sapi/v1/simple-earn/flexible/position', { asset });
  return data.rows || [];
}

/**
 * Subscribe a real amount of an asset from the spot wallet into a flexible Earn
 * product. Redeemable back to spot at any time (see redeemFlexible) — this is not a
 * locked/fixed-term product and carries no leverage or directional market risk, only
 * the (low but nonzero) counterparty/product risk inherent to any Earn product.
 * @param {Object} params
 * @param {string} params.productId
 * @param {string} params.asset
 * @param {number} params.amount
 * @param {string} params.agentId
 * @param {number} [params.latestAnnualPercentageRate]
 * @returns {Promise<Object>} the recorded action
 */
async function subscribeFlexible({ productId, asset, amount, agentId, latestAnnualPercentageRate }) {
  assertLiveTradingAllowed();

  let response;
  try {
    response = await signedRequest('POST', '/sapi/v1/simple-earn/flexible/subscribe', {
      productId,
      amount
    });
  } catch (error) {
    await appendAction({
      agentId,
      timestamp: new Date(),
      action: 'subscribe',
      asset,
      productId,
      amount,
      latestAnnualPercentageRate,
      status: 'error',
      raw: { error: error.message }
    });
    throw error;
  }

  return appendAction({
    agentId,
    timestamp: new Date(),
    action: 'subscribe',
    asset,
    productId,
    amount,
    latestAnnualPercentageRate,
    status: 'success',
    raw: response
  });
}

/**
 * Redeem a real amount (or the full position, via redeemAll) of a flexible Earn
 * product back to the spot wallet. The manual "undo" for subscribeFlexible.
 * @param {Object} params
 * @param {string} params.productId
 * @param {string} params.asset
 * @param {string} params.agentId
 * @param {number} [params.amount] required unless redeemAll is true
 * @param {boolean} [params.redeemAll]
 * @returns {Promise<Object>} the recorded action
 */
async function redeemFlexible({ productId, asset, amount, redeemAll, agentId }) {
  assertLiveTradingAllowed();

  const params = { productId };
  if (redeemAll) {
    params.redeemAll = true;
  } else {
    params.amount = amount;
  }

  let response;
  try {
    response = await signedRequest('POST', '/sapi/v1/simple-earn/flexible/redeem', params);
  } catch (error) {
    await appendAction({
      agentId,
      timestamp: new Date(),
      action: 'redeem',
      asset,
      productId,
      amount: amount || 0,
      status: 'error',
      raw: { error: error.message }
    });
    throw error;
  }

  return appendAction({
    agentId,
    timestamp: new Date(),
    action: 'redeem',
    asset,
    productId,
    amount: amount || 0,
    status: 'success',
    raw: response
  });
}

module.exports = {
  getFreeSpotBalance,
  getFlexibleProducts,
  getFlexiblePositions,
  subscribeFlexible,
  redeemFlexible,
  getLedger,
  assertLiveTradingAllowed
};

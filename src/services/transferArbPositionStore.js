// Storage abstraction for RealTransferArbPosition — REAL MONEY ledger for
// crossExchangeTransferArbitrageAgent.js. Falls back to a local JSON file when
// MongoDB persistence is disabled (agentManager.persistenceEnabled === false),
// mirroring the file-ledger pattern realTradingService.js already uses for RealTrade
// (real_trades.json). Without this, the agent's every scan cycle fails outright on
// the first query — confirmed live: `realtransferarbpositions.find()` buffering
// timed out after 10000ms, over and over, with PERSISTENCE_ENABLED=false. This
// ledger is exactly as real-money-critical as RealTrade's and deserves the same
// "don't just silently fail to track state" treatment, not a Mongo-only assumption.
const fs = require('fs');
const path = require('path');
const { Config } = require('../config/config');

const config = new Config();
const persistenceEnabled = config.get('agentManager.persistenceEnabled', true);
const filePath = path.join(process.cwd(), 'real_transfer_arb_positions.json');

let RealTransferArbPosition;
function getModel() {
  if (!RealTransferArbPosition) RealTransferArbPosition = require('../models/RealTransferArbPosition');
  return RealTransferArbPosition;
}

function loadFile() {
  try {
    if (fs.existsSync(filePath)) {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return Array.isArray(parsed.positions) ? parsed.positions : [];
    }
  } catch (error) {
    console.warn('real_transfer_arb_positions.json contains invalid JSON, starting fresh:', error.message);
  }
  return [];
}

function saveFile(positions) {
  fs.writeFileSync(filePath, JSON.stringify({ positions }, null, 2), 'utf8');
}

let fileIdCounter = 1;

// Gives a plain file-backed record the same async save() shape a Mongoose document
// has, so the agent's `position.status = X; await position.save();` pattern works
// identically regardless of which backend is active.
function attachSave(record) {
  record.save = async function save() {
    const positions = loadFile();
    const idx = positions.findIndex(p => p._id === record._id);
    const plain = { ...record };
    delete plain.save;
    if (idx >= 0) positions[idx] = plain; else positions.push(plain);
    saveFile(positions);
    return record;
  };
  return record;
}

/**
 * Creates a new position. Returned object has an async save() that persists
 * whatever fields have been mutated on it since — works identically whether
 * backed by Mongo or the local file.
 * @param {Object} data
 * @returns {Promise<Object>}
 */
async function createPosition(data) {
  if (persistenceEnabled) {
    const Model = getModel();
    return Model.create(data);
  }
  const positions = loadFile();
  const record = {
    _id: `local_${Date.now()}_${fileIdCounter++}`,
    openedAt: new Date().toISOString(),
    ...data
  };
  positions.push(record);
  saveFile(positions);
  return attachSave(record);
}

/**
 * Positions currently awaiting a Coinbase deposit — the set processPendingPositions()
 * checks and advances every scan cycle. Returned objects support save().
 * @param {string} agentId
 * @returns {Promise<Array<Object>>}
 */
async function getPendingDepositPositions(agentId) {
  if (persistenceEnabled) {
    const Model = getModel();
    return Model.find({ agentId, status: 'awaiting_deposit' });
  }
  return loadFile()
    .filter(p => p.agentId === agentId && p.status === 'awaiting_deposit')
    .map(attachSave);
}

const OPEN_STATUSES = ['buying', 'withdrawing', 'awaiting_deposit', 'selling'];
const STRANDED_STATUSES = ['stranded_after_buy', 'stranded_after_withdrawal'];

/**
 * Count of positions currently mid-flight — used to enforce maxConcurrentPositions.
 * @param {string} agentId
 * @returns {Promise<number>}
 */
async function countOpenPositions(agentId) {
  if (persistenceEnabled) {
    const Model = getModel();
    return Model.countDocuments({ agentId, status: { $in: OPEN_STATUSES } });
  }
  return loadFile().filter(p => p.agentId === agentId && OPEN_STATUSES.includes(p.status)).length;
}

/**
 * Read-only summary for getStatusExtended() — plain objects, no save() needed.
 * @param {string} agentId
 * @returns {Promise<{pending: Array, needsReview: Array, stranded: Array, recentClosed: Array}>}
 */
async function getStatusSummary(agentId) {
  if (persistenceEnabled) {
    const Model = getModel();
    const [pending, needsReview, stranded, recentClosed] = await Promise.all([
      Model.find({ agentId, status: { $in: OPEN_STATUSES } }).lean(),
      Model.find({ agentId, status: 'needs_manual_review' }).lean(),
      Model.find({ agentId, status: { $in: STRANDED_STATUSES } }).lean(),
      Model.find({ agentId, status: 'closed' }).sort({ closedAt: -1 }).limit(10).lean()
    ]);
    return { pending, needsReview, stranded, recentClosed };
  }
  const positions = loadFile().filter(p => p.agentId === agentId);
  return {
    pending: positions.filter(p => OPEN_STATUSES.includes(p.status)),
    needsReview: positions.filter(p => p.status === 'needs_manual_review'),
    stranded: positions.filter(p => STRANDED_STATUSES.includes(p.status)),
    recentClosed: positions
      .filter(p => p.status === 'closed')
      .sort((a, b) => new Date(b.closedAt) - new Date(a.closedAt))
      .slice(0, 10)
  };
}

/**
 * Real P&L across every transfer-arbitrage position ever recorded, any agentId —
 * same purpose as pumpFunTradingService.getAllTimeSummary(): a fresh agent spawn
 * gets a new incrementing ID, so this can't be scoped to "the current instance"
 * without silently dropping history from before the most recent restart.
 * @returns {Promise<Object>}
 */
async function getAllTimeSummary() {
  let allPositions;
  if (persistenceEnabled) {
    const Model = getModel();
    allPositions = await Model.find({}).lean();
  } else {
    allPositions = loadFile();
  }

  const closed = allPositions.filter(p => p.status === 'closed' && p.realizedPnlUsd != null);
  const totalRealizedPnlUsd = closed.reduce((sum, p) => sum + p.realizedPnlUsd, 0);

  return {
    totalRealizedPnlUsd,
    closedTradeCount: closed.length,
    winCount: closed.filter(p => p.realizedPnlUsd > 0).length,
    lossCount: closed.filter(p => p.realizedPnlUsd <= 0).length,
    pendingCount: allPositions.filter(p => OPEN_STATUSES.includes(p.status)).length,
    needsReviewCount: allPositions.filter(p => p.status === 'needs_manual_review').length,
    strandedCount: allPositions.filter(p => STRANDED_STATUSES.includes(p.status)).length
  };
}

module.exports = {
  createPosition,
  getPendingDepositPositions,
  countOpenPositions,
  getAllTimeSummary,
  getStatusSummary
};

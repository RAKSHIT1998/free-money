// Storage abstraction for RealFundingArbPosition — REAL MONEY ledger for
// fundingRateArbitrageAgent.js. Falls back to a local JSON file when MongoDB
// persistence is disabled, same pattern as transferArbPositionStore.js /
// pumpFunTradingService.js / agentCullService.js (all fixed 2026-09-01/09-01 after
// the same underlying bug: raw Mongoose calls with no fallback meant this agent's
// every scan cycle failed outright — `realfundingarbpositions.find()` buffering
// timed out after 10000ms — with PERSISTENCE_ENABLED=false, the whole session.
// Confirmed via the live dashboard: this agent has shown `state: "error"` the
// entire time, never once managing to check for a real funding-rate opportunity.
const fs = require('fs');
const path = require('path');
const { Config } = require('../config/config');

const config = new Config();
const persistenceEnabled = config.get('agentManager.persistenceEnabled', true);
const filePath = path.join(process.cwd(), 'real_funding_arb_positions.json');

let RealFundingArbPosition;
function getModel() {
  if (!RealFundingArbPosition) RealFundingArbPosition = require('../models/RealFundingArbPosition');
  return RealFundingArbPosition;
}

function loadFile() {
  try {
    if (fs.existsSync(filePath)) {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return Array.isArray(parsed.positions) ? parsed.positions : [];
    }
  } catch (error) {
    console.warn('real_funding_arb_positions.json contains invalid JSON, starting fresh:', error.message);
  }
  return [];
}

function saveFile(positions) {
  fs.writeFileSync(filePath, JSON.stringify({ positions }, null, 2), 'utf8');
}

let fileIdCounter = 1;

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
 * Creates a new hedged-pair position. Returned object has an async save() that
 * works identically whether backed by Mongo or the local file.
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
    totalFundingCollectedUsd: 0,
    ...data
  };
  positions.push(record);
  saveFile(positions);
  return attachSave(record);
}

/**
 * Every position for this agent with the given status. Returned objects support
 * save() when status === 'open' (the only status the agent mutates in place).
 * @param {string} agentId
 * @param {string} status
 * @returns {Promise<Array<Object>>}
 */
async function getPositionsByStatus(agentId, status) {
  if (persistenceEnabled) {
    const Model = getModel();
    return Model.find({ agentId, status });
  }
  return loadFile()
    .filter(p => p.agentId === agentId && p.status === status)
    .map(attachSave);
}

/**
 * Read-only summary for getStatusExtended() — plain objects, no save() needed.
 * @param {string} agentId
 * @returns {Promise<{openPositions: Array, unhedgedPositions: Array, recentClosed: Array}>}
 */
async function getStatusSummary(agentId) {
  if (persistenceEnabled) {
    const Model = getModel();
    const [openPositions, unhedgedPositions, recentClosed] = await Promise.all([
      Model.find({ agentId, status: 'open' }).lean(),
      Model.find({ agentId, status: 'unhedged' }).lean(),
      Model.find({ agentId, status: 'closed' }).sort({ closedAt: -1 }).limit(10).lean()
    ]);
    return { openPositions, unhedgedPositions, recentClosed };
  }
  const positions = loadFile().filter(p => p.agentId === agentId);
  return {
    openPositions: positions.filter(p => p.status === 'open'),
    unhedgedPositions: positions.filter(p => p.status === 'unhedged'),
    recentClosed: positions
      .filter(p => p.status === 'closed')
      .sort((a, b) => new Date(b.closedAt) - new Date(a.closedAt))
      .slice(0, 10)
  };
}

module.exports = {
  createPosition,
  getPositionsByStatus,
  getStatusSummary
};

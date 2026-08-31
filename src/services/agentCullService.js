// Tracks which real-money agents the performance governor has permanently stopped for
// sustained real losses, so server.js's auto-spawn-on-restart logic can respect that
// decision instead of silently recreating the same losing agent on every redeploy.
//
// File-based fallback added 2026-09-01 — this had the exact same bug as
// pumpFunTradingService.js's ledger and crossExchangeTransferArbitrageAgent's
// position store: with persistence disabled, recordCull() silently did nothing and
// isCulled() always returned null. That's worse than just "no record" here
// specifically, because isCulled() being wrong means a culled agent would get
// auto-resurrected on the very next restart, defeating the entire point of a
// permanent cull. Found while wiring up real-money reporting, not from an actual
// bad resurrection yet — but it was a live gap the moment PERSISTENCE_ENABLED=false.
const fs = require('fs');
const path = require('path');
const { Config } = require('../config/config');

const config = new Config();
const persistenceEnabled = config.get('agentManager.persistenceEnabled', true);
const filePath = path.join(process.cwd(), 'culled_agents.json');

let CulledAgent;
function getModel() {
  if (!CulledAgent) {
    CulledAgent = require('../models/CulledAgent');
  }
  return CulledAgent;
}

function loadFile() {
  try {
    if (fs.existsSync(filePath)) {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return Array.isArray(parsed.culled) ? parsed.culled : [];
    }
  } catch (error) {
    console.warn('culled_agents.json contains invalid JSON, starting fresh:', error.message);
  }
  return [];
}

function saveFile(culled) {
  fs.writeFileSync(filePath, JSON.stringify({ culled }, null, 2), 'utf8');
}

async function recordCull(type, symbol, reason, stats = {}) {
  const record = {
    type,
    symbol: symbol || null,
    reason,
    netRealizedPnlUsd: stats.netRealizedPnlUsd,
    closedTradeCount: stats.closedTradeCount,
    culledAt: new Date().toISOString()
  };

  if (persistenceEnabled) {
    const Model = getModel();
    await Model.findOneAndUpdate(
      { type, symbol: symbol || null },
      { type, symbol: symbol || null, reason, netRealizedPnlUsd: stats.netRealizedPnlUsd, closedTradeCount: stats.closedTradeCount, culledAt: new Date() },
      { upsert: true }
    );
    return;
  }

  const culled = loadFile();
  const idx = culled.findIndex(c => c.type === type && c.symbol === (symbol || null));
  if (idx >= 0) culled[idx] = record; else culled.push(record);
  saveFile(culled);
}

async function isCulled(type, symbol) {
  if (persistenceEnabled) {
    const Model = getModel();
    return Model.findOne({ type, symbol: symbol || null }).lean();
  }
  const culled = loadFile();
  return culled.find(c => c.type === type && c.symbol === (symbol || null)) || null;
}

/**
 * Every culled agent, for dashboard/reporting display.
 * @returns {Promise<Array>}
 */
async function getAllCulled() {
  if (persistenceEnabled) {
    const Model = getModel();
    return Model.find({}).sort({ culledAt: -1 }).lean();
  }
  return [...loadFile()].sort((a, b) => new Date(b.culledAt) - new Date(a.culledAt));
}

module.exports = { recordCull, isCulled, getAllCulled };

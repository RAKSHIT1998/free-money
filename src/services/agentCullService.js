// Tracks which real-money agents the performance governor has permanently stopped for
// sustained real losses, so server.js's auto-spawn-on-restart logic can respect that
// decision instead of silently recreating the same losing agent on every redeploy.
const { Config } = require('../config/config');

const config = new Config();
const persistenceEnabled = config.get('agentManager.persistenceEnabled', true);

let CulledAgent;
function getModel() {
  if (!CulledAgent) {
    CulledAgent = require('../models/CulledAgent');
  }
  return CulledAgent;
}

async function recordCull(type, symbol, reason, stats = {}) {
  if (!persistenceEnabled) return;
  const Model = getModel();
  await Model.findOneAndUpdate(
    { type, symbol: symbol || null },
    {
      type,
      symbol: symbol || null,
      reason,
      netRealizedPnlUsd: stats.netRealizedPnlUsd,
      closedTradeCount: stats.closedTradeCount,
      culledAt: new Date()
    },
    { upsert: true }
  );
}

async function isCulled(type, symbol) {
  if (!persistenceEnabled) return null;
  const Model = getModel();
  return Model.findOne({ type, symbol: symbol || null }).lean();
}

module.exports = { recordCull, isCulled };

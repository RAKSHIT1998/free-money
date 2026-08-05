// Persisted record of a real-money agent (type, optionally symbol-scoped) that the
// automated performance governor stopped for sustained real losses. Consulted by
// server.js's auto-spawn helpers so a culled agent doesn't silently resurrect itself
// on the next restart/redeploy — mirrors the earlier manual precedent (binanceDca,
// gridTrading removed from auto-spawn by hand) but for a runtime decision instead of
// a code edit.
const mongoose = require('mongoose');

const culledAgentSchema = new mongoose.Schema({
  type: {
    type: String,
    required: true
  },
  // null for single-instance agent types (breakoutFutures, meanReversionFutures,
  // pumpFunSniper); a specific symbol for per-symbol types (binanceFuturesDca).
  symbol: {
    type: String,
    default: null
  },
  reason: {
    type: String,
    required: true
  },
  netRealizedPnlUsd: Number,
  closedTradeCount: Number,
  culledAt: {
    type: Date,
    default: Date.now
  }
});

culledAgentSchema.index({ type: 1, symbol: 1 }, { unique: true });

module.exports = mongoose.model('CulledAgent', culledAgentSchema);

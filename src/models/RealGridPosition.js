// Ledger for REAL grid trading positions — one row per grid level currently holding a
// bought quantity, waiting for price to rise one grid step so it can be sold for the
// grid-spacing profit. Physically separate from RealTrade.js (which logs individual
// fills): this tracks which grid LEVEL each held quantity belongs to, since the
// strategy's logic (buy this level, sell when price reaches the level above) depends
// on that association, not just "we hold some quantity somewhere."
const mongoose = require('mongoose');

const realGridPositionSchema = new mongoose.Schema({
  agentId: {
    type: String,
    required: true
  },
  symbol: {
    type: String,
    required: true
  },
  levelIndex: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['open', 'closed'],
    required: true
  },
  buyPrice: {
    type: Number,
    required: true
  },
  qty: {
    type: Number,
    required: true
  },
  buyOrderId: {
    type: String
  },
  sellOrderId: {
    type: String
  },
  sellPrice: {
    type: Number
  },
  openedAt: {
    type: Date,
    default: Date.now
  },
  closedAt: {
    type: Date
  }
});

realGridPositionSchema.index({ agentId: 1, symbol: 1, status: 1, levelIndex: 1 });

module.exports = mongoose.model('RealGridPosition', realGridPositionSchema);

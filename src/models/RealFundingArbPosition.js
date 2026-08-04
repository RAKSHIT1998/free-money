// Ledger for REAL funding-rate arbitrage positions — a PAIR of legs (spot long +
// futures short) held together as one hedged unit. Distinct from RealTrade.js and
// RealFuturesTrade.js (which log individual fills): this tracks the pairing itself,
// since the whole point of the strategy is that both legs must be opened/closed
// together to stay hedged, and neither underlying trade log expresses that
// relationship on its own.
const mongoose = require('mongoose');

const realFundingArbPositionSchema = new mongoose.Schema({
  agentId: {
    type: String,
    required: true
  },
  symbol: {
    type: String,
    required: true
  },
  status: {
    // 'open': both legs live and hedged.
    // 'closed': both legs closed, position fully unwound.
    // 'unhedged': one leg opened but the other failed — the dangerous state this
    // whole model exists to make visible and let a human resolve, rather than have it
    // hide inside two disconnected trade logs.
    type: String,
    enum: ['open', 'closed', 'unhedged'],
    required: true
  },
  openedAt: {
    type: Date,
    default: Date.now
  },
  closedAt: {
    type: Date
  },
  notionalUsd: {
    type: Number,
    required: true
  },
  spotQty: {
    type: Number,
    required: true
  },
  spotEntryOrderId: {
    type: String
  },
  spotExitOrderId: {
    type: String
  },
  futuresEntryOrderId: {
    type: String
  },
  futuresExitOrderId: {
    type: String
  },
  fundingRateAtOpen: {
    type: Number,
    required: true
  },
  totalFundingCollectedUsd: {
    type: Number,
    default: 0
  },
  note: {
    type: String
  }
});

realFundingArbPositionSchema.index({ agentId: 1, status: 1 });

module.exports = mongoose.model('RealFundingArbPosition', realFundingArbPositionSchema);

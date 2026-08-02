// Ledger for REAL Binance spot trades (real money). Physically separate from Wallet.js,
// which tracks the fabricated in-app "earnings" currency used by the simulated agents.
// No code in walletService.js reads or writes this model, and no code here reads or
// writes Wallet.js — that separation is intentional and must not be merged.
const mongoose = require('mongoose');

const realTradeSchema = new mongoose.Schema({
  agentId: {
    type: String,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  side: {
    type: String,
    enum: ['BUY', 'SELL'],
    required: true
  },
  symbol: {
    type: String,
    required: true
  },
  requestedUsd: {
    type: Number,
    required: true
  },
  filledQty: {
    type: Number,
    required: true
  },
  fillPrice: {
    type: Number,
    required: true
  },
  commission: {
    type: Number,
    default: 0
  },
  commissionAsset: {
    type: String,
    default: ''
  },
  binanceOrderId: {
    type: String
  },
  status: {
    type: String,
    enum: ['filled', 'partially_filled', 'rejected', 'error'],
    required: true
  },
  raw: {
    type: mongoose.Schema.Types.Mixed
  }
});

realTradeSchema.index({ agentId: 1, timestamp: -1 });

module.exports = mongoose.model('RealTrade', realTradeSchema);

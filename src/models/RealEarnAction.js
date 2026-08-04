// Ledger for REAL Binance Simple Earn (flexible) subscribe/redeem actions — real money,
// but no leverage and no directional market risk (redeemable back to the original
// asset at any time, unlike a trade). Physically separate from RealTrade.js (spot
// trading) and RealFuturesTrade.js (leveraged futures) — this only ever moves an asset
// between "free spot balance" and "earning yield," never converts between assets.
const mongoose = require('mongoose');

const realEarnActionSchema = new mongoose.Schema({
  agentId: {
    type: String,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  action: {
    type: String,
    enum: ['subscribe', 'redeem'],
    required: true
  },
  asset: {
    type: String,
    required: true
  },
  productId: {
    type: String,
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  latestAnnualPercentageRate: {
    type: Number
  },
  status: {
    type: String,
    enum: ['success', 'error'],
    required: true
  },
  raw: {
    type: mongoose.Schema.Types.Mixed
  }
});

realEarnActionSchema.index({ agentId: 1, timestamp: -1 });

module.exports = mongoose.model('RealEarnAction', realEarnActionSchema);

// Ledger for REAL Binance USDT-M futures trades (real money, leveraged). Physically
// separate from RealTrade.js (spot) and Wallet.js (fabricated in-app earnings) — no
// code here reads/writes those, and no code there reads/writes this.
const mongoose = require('mongoose');

const realFuturesTradeSchema = new mongoose.Schema({
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
  // Distinguishes opening margin usage from closing margin release — cannot be
  // inferred from `side` alone once shorts exist (a short's open is a SELL, its
  // close is a BUY, the reverse of a long). Absent on records written before shorts
  // existed; getTotalMarginUsd/getTotalMarginUsdAllAgents fall back to inferring from
  // `side` for those legacy rows.
  action: {
    type: String,
    enum: ['open', 'close']
  },
  symbol: {
    type: String,
    required: true
  },
  leverage: {
    type: Number,
    required: true
  },
  marginMode: {
    type: String,
    enum: ['ISOLATED', 'CROSSED'],
    required: true
  },
  marginUsd: {
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
  stopOrderId: {
    type: String
  },
  stopPrice: {
    type: Number
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

realFuturesTradeSchema.index({ agentId: 1, timestamp: -1 });

module.exports = mongoose.model('RealFuturesTrade', realFuturesTradeSchema);

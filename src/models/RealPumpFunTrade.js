// Ledger for REAL pump.fun trades (real money, Solana). Physically separate from
// every Binance/PayPal ledger — no code here reads/writes those, and no code there
// reads/writes this. Distinct, much higher-risk category (permissionless memecoin
// speculation, not an exchange with real order books) — see pumpFunSniperAgent.js.
const mongoose = require('mongoose');

const realPumpFunTradeSchema = new mongoose.Schema({
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
    enum: ['buy', 'sell'],
    required: true
  },
  tokenMint: {
    type: String,
    required: true
  },
  tokenSymbol: {
    type: String
  },
  tokenName: {
    type: String
  },
  solAmount: {
    type: Number,
    required: true
  },
  tokenAmount: {
    type: Number
  },
  usdAmount: {
    type: Number
  },
  txSignature: {
    type: String
  },
  status: {
    type: String,
    enum: ['confirmed', 'failed'],
    required: true
  },
  // Only meaningful on a 'sell' row — realized P&L in USD for the round trip this
  // sell closes out, so the ledger doesn't require joining buy+sell rows to answer
  // "did this position make or lose money."
  realizedPnlUsd: {
    type: Number
  },
  raw: {
    type: mongoose.Schema.Types.Mixed
  }
});

realPumpFunTradeSchema.index({ agentId: 1, timestamp: -1 });
realPumpFunTradeSchema.index({ tokenMint: 1 });

module.exports = mongoose.model('RealPumpFunTrade', realPumpFunTradeSchema);

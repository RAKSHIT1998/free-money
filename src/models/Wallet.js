// Wallet model for storing wallet balance and transaction history
const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['deposit', 'withdrawal', 'earning'],
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    required: true,
    default: 'USD'
  },
  description: {
    type: String,
    default: ''
  },
  // Optional references
  opportunityId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Opportunity'
  },
  agentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Agent'
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
});

const walletSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    unique: true
  },
  balances: {
    type: Map,
    of: Number,
    default: {}
  },
  transactions: [transactionSchema]
}, {
  timestamps: true
});

// Index for faster user lookup
walletSchema.index({ userId: 1 });

// Helper method to get balance for a specific currency
walletSchema.methods.getBalance = function(currency) {
  return this.balances.get(currency) || 0;
};

// Helper method to add to balance for a specific currency
walletSchema.methods.addBalance = function(currency, amount) {
  const current = this.balances.get(currency) || 0;
  this.balances.set(currency, current + amount);
};

// Helper method to subtract from balance for a specific currency
walletSchema.methods.subtractBalance = function(currency, amount) {
  const current = this.balances.get(currency) || 0;
  if (current < amount) {
    throw new Error(`Insufficient funds in ${currency}`);
  }
  this.balances.set(currency, current - amount);
};

module.exports = mongoose.model('Wallet', walletSchema);
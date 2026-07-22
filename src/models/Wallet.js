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
  balance: {
    type: Number,
    default: 0
  },
  transactions: [transactionSchema]
}, {
  timestamps: true
});

// Index for faster user lookup
walletSchema.index({ userId: 1 });

module.exports = mongoose.model('Wallet', walletSchema);
// Agent model for storing agent information and performance metrics
const mongoose = require('mongoose');

const agentPerformanceSchema = new mongoose.Schema({
  // Performance metrics
  earningsPerHour: {
    type: Number,
    default: 0
  },
  opportunitiesPerHour: {
    type: Number,
    default: 0
  },
  successRate: {
    type: Number,
    default: 0
  },
  uptimePercentage: {
    type: Number,
    default: 0
  },
  totalEarnings: {
    type: Number,
    default: 0
  },
  totalOpportunitiesFound: {
    type: Number,
    default: 0
  },
  totalActionsTaken: {
    type: Number,
    default: 0
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  }
});

const agentSchema = new mongoose.Schema({
  agentId: {
    type: String,
    required: true,
    unique: true
  },
  type: {
    type: String,
    required: true,
    enum: ['cryptoHunter', 'opportunityScout', 'developer', 'manager']
  },
  name: {
    type: String,
    required: true
  },
  config: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  state: {
    type: String,
    enum: ['idle', 'active', 'resting', 'error', 'finished'],
    default: 'idle'
  },
  isRunning: {
    type: Boolean,
    default: false
  },
  performance: {
    type: agentPerformanceSchema,
    default: () => ({})
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  lastActive: {
    type: Date,
    default: Date.now
  },
  lastSeen: {
    type: Date,
    default: Date.now
  }
});

// Indexes for better query performance
agentSchema.index({ type: 1, state: 1 });
agentSchema.index({ isRunning: 1 });
agentSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Agent', agentSchema);
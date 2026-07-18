const mongoose = require('mongoose');

const opportunitySchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true
  },
  url: {
    type: String,
    required: true
  },
  source: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['airdrop', 'bounty', 'freelance', 'grant', 'contest', 'other'],
    default: 'other'
  },
  reward: {
    type: String, // Could be string to accommodate various formats (e.g., "$100", "0.5 ETH", "Up to $500")
    required: true
  },
  deadline: {
    type: Date
  },
  requirements: [{
    type: String
  }],
  tags: [{
    type: String
  }],
  status: {
    type: String,
    enum: ['active', 'expired', 'claimed', 'expired'],
    default: 'active'
  },
  postedAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes for faster querying
opportunitySchema.index({ type: 1, status: 1 });
opportunitySchema.index({ deadline: 1 });
opportunitySchema.index({ postedAt: -1 });

module.exports = mongoose.model('Opportunity', opportunitySchema);
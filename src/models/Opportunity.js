// Opportunity model for storing opportunity information
const mongoose = require('mongoose');

const opportunitySchema = new mongoose.Schema({
  title: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  url: {
    type: String,
    required: true,
    unique: true
  },
  source: {
    type: String,
    required: true
  },
  type: {
    type: String,
    required: true,
    enum: ['airdrop', 'bounty', 'freelance', 'grant', 'contest', 'other']
  },
  reward: {
    type: String
  },
  requirements: [{
    type: String
  }],
  tags: [{
    type: String
  }],
  postedAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  status: {
    type: String,
    enum: ['active', 'expired', 'claimed'],
    default: 'active'
  }
});

// Indexes for better query performance
opportunitySchema.index({ type: 1, status: 1 });
opportunitySchema.index({ postedAt: -1 });
opportunitySchema.index({ url: 1 });

module.exports = mongoose.model('Opportunity', opportunitySchema);
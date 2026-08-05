// Persists Binance's rate-limit/ban cooldown across process restarts. Without this,
// the cooldown lived only in an in-memory variable that reset to 0 on every deploy —
// meaning a restart during an active IP ban made the app forget it and immediately
// retry, which Binance's escalating-ban behavior turns into an even longer ban.
// One document per exchange/market (key), not per agent — Binance bans by IP.
const mongoose = require('mongoose');

const rateLimitStateSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true
  },
  rateLimitedUntil: {
    type: Number,
    default: 0
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('RateLimitState', rateLimitStateSchema);

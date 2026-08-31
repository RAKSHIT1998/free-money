// Local, self-built reputation store for pump.fun token CREATOR wallets — grows
// purely from what pumpFunSniperAgent.js has itself observed (no external paid data
// source). A creator whose past launch this agent bought and watched crater is
// remembered and never bought from again; everyone else starts neutral, since almost
// every creator is "new" from this agent's own necessarily limited observation
// window. This is a real, if slow-to-build, signal — the alternative (no memory at
// all) means paying the same lesson from the same bad actor repeatedly.
const fs = require('fs');
const path = require('path');

const FILE_PATH = path.join(process.cwd(), 'pumpfun_creator_reputation.json');

function load() {
  try {
    if (fs.existsSync(FILE_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(FILE_PATH, 'utf8'));
      return parsed && typeof parsed.creators === 'object' ? parsed.creators : {};
    }
  } catch (error) {
    console.warn('pumpfun_creator_reputation.json contains invalid JSON, starting fresh:', error.message);
  }
  return {};
}

function save(creators) {
  fs.writeFileSync(FILE_PATH, JSON.stringify({ creators }, null, 2), 'utf8');
}

/**
 * True if this creator wallet has at least one past launch this agent itself
 * bought and watched turn into a real loss (see recordRugOutcome). Used as a hard
 * pre-filter — never buy from a wallet with a known bad outcome, regardless of how
 * good the new token's early numbers look.
 * @param {string} creatorAddress
 * @returns {boolean}
 */
function isKnownRugger(creatorAddress) {
  const creators = load();
  return !!(creators[creatorAddress] && creators[creatorAddress].ruggedCount > 0);
}

/**
 * Records that a launch from this creator was seen (whether or not it was bought) —
 * builds up launch-frequency history over time, surfaced for visibility even before
 * it's used for anything stricter than the rug flag.
 * @param {string} creatorAddress
 */
function recordLaunchSeen(creatorAddress) {
  if (!creatorAddress) return;
  const creators = load();
  if (!creators[creatorAddress]) {
    creators[creatorAddress] = { launchesSeen: 0, ruggedCount: 0, firstSeenAt: new Date().toISOString(), lastSeenAt: null };
  }
  creators[creatorAddress].launchesSeen += 1;
  creators[creatorAddress].lastSeenAt = new Date().toISOString();
  save(creators);
}

/**
 * Records a real, observed bad outcome for this creator's token — called from
 * checkExitConditions() when a held position closes at a severe loss. Permanent:
 * this creator is never bought from again by this agent.
 * @param {string} creatorAddress
 * @param {string} mint
 * @param {number} realizedPnlUsd
 */
function recordRugOutcome(creatorAddress, mint, realizedPnlUsd) {
  if (!creatorAddress) return;
  const creators = load();
  if (!creators[creatorAddress]) {
    creators[creatorAddress] = { launchesSeen: 1, ruggedCount: 0, firstSeenAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() };
  }
  creators[creatorAddress].ruggedCount += 1;
  creators[creatorAddress].lastRuggedMint = mint;
  creators[creatorAddress].lastRuggedPnlUsd = realizedPnlUsd;
  creators[creatorAddress].lastRuggedAt = new Date().toISOString();
  save(creators);
}

function getStats() {
  const creators = load();
  const total = Object.keys(creators).length;
  const knownRuggers = Object.values(creators).filter(c => c.ruggedCount > 0).length;
  return { totalCreatorsTracked: total, knownRuggers };
}

module.exports = {
  isKnownRugger,
  recordLaunchSeen,
  recordRugOutcome,
  getStats
};

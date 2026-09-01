// A shared, persistent "brain" for every real-money agent AND manager — added
// 2026-09-01 (user request: "give agents, managers some memory brain"). Distinct
// from pumpFunCreatorReputationService (which remembers one specific fact: which
// creator wallets have rugged) and from agentCullService (which remembers one
// specific fact: which agents were culled) — this is the general-purpose layer
// underneath: any agent can record a trade outcome under its own scope and later
// ask "how have MY recent decisions actually been going, across restarts?", and any
// manager can leave a plain-English lesson in the shared journal any agent or the
// dashboard can read back. Nothing here is a trained model; it's what this
// codebase's real-money agents can actually support honestly — a persistent record
// that survives process restarts (unlike in-memory performance counters, which
// reset to zero every deploy) and a couple of genuinely adaptive behaviors built on
// top of it (see pumpFunSniperAgent.js's memory-based size throttle).
//
// File-based only (no Mongo path) — unlike the position-store services, this isn't
// migrating an existing broken Mongo-only code path, it's new, and this process has
// run under PERSISTENCE_ENABLED=false all session; a file is the right permanent
// home for it either way; scopes are small.
const fs = require('fs');
const path = require('path');

const FILE_PATH = path.join(process.cwd(), 'agent_memory.json');
const MAX_OUTCOMES_PER_SCOPE = 200;
const MAX_LESSONS_PER_SCOPE = 100;

function load() {
  try {
    if (fs.existsSync(FILE_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(FILE_PATH, 'utf8'));
      return {
        outcomes: parsed?.outcomes && typeof parsed.outcomes === 'object' ? parsed.outcomes : {},
        lessons: parsed?.lessons && typeof parsed.lessons === 'object' ? parsed.lessons : {}
      };
    }
  } catch (error) {
    console.warn('agent_memory.json contains invalid JSON, starting fresh:', error.message);
  }
  return { outcomes: {}, lessons: {} };
}

function save(data) {
  fs.writeFileSync(FILE_PATH, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Records one closed trade's outcome under a scope (e.g. an agent type like
 * 'pumpFunSniper', or a more specific key such as 'binanceFuturesDca:BTCUSDT').
 * Keeps only the most recent MAX_OUTCOMES_PER_SCOPE — this is a rolling working
 * memory for sizing decisions, not a full audit trail (the real trade ledgers
 * already are that).
 * @param {string} scope
 * @param {Object} outcome
 * @param {number} outcome.pnlUsd
 * @param {Object} [outcome.meta] arbitrary extra context (mint, symbol, reason...)
 */
function recordOutcome(scope, { pnlUsd, meta } = {}) {
  if (!scope || !Number.isFinite(pnlUsd)) return;
  const data = load();
  if (!data.outcomes[scope]) data.outcomes[scope] = [];
  data.outcomes[scope].push({ at: new Date().toISOString(), pnlUsd, meta: meta || undefined });
  if (data.outcomes[scope].length > MAX_OUTCOMES_PER_SCOPE) {
    data.outcomes[scope] = data.outcomes[scope].slice(-MAX_OUTCOMES_PER_SCOPE);
  }
  save(data);
}

/**
 * Rolling stats for a scope, over its most recent `windowSize` outcomes (default
 * all kept). Used both for dashboard display and for agents' own real-time sizing
 * decisions (e.g. pumpFunSniperAgent throttling buy size after a cold streak).
 * @param {string} scope
 * @param {number} [windowSize]
 * @returns {{trades:number, wins:number, losses:number, winRate:number, totalPnlUsd:number, avgPnlUsd:number}}
 */
function getStats(scope, windowSize) {
  const data = load();
  const all = data.outcomes[scope] || [];
  const recent = windowSize ? all.slice(-windowSize) : all;
  const trades = recent.length;
  const wins = recent.filter(o => o.pnlUsd > 0).length;
  const losses = recent.filter(o => o.pnlUsd <= 0).length;
  const totalPnlUsd = recent.reduce((sum, o) => sum + o.pnlUsd, 0);
  return {
    trades,
    wins,
    losses,
    winRate: trades > 0 ? wins / trades : null,
    totalPnlUsd,
    avgPnlUsd: trades > 0 ? totalPnlUsd / trades : 0
  };
}

/**
 * Appends a short, human-readable lesson to a scope's journal — a rug detected, a
 * cull, a budget boost, a throttle kicking in. Meant to be read, by a person on the
 * dashboard or by a manager agent deciding what to do next; not machine-parsed.
 * @param {string} scope
 * @param {string} text
 * @param {Object} [meta]
 */
function recordLesson(scope, text, meta) {
  if (!scope || !text) return;
  const data = load();
  if (!data.lessons[scope]) data.lessons[scope] = [];
  data.lessons[scope].push({ at: new Date().toISOString(), text, meta: meta || undefined });
  if (data.lessons[scope].length > MAX_LESSONS_PER_SCOPE) {
    data.lessons[scope] = data.lessons[scope].slice(-MAX_LESSONS_PER_SCOPE);
  }
  save(data);
}

/**
 * @param {string} scope
 * @param {number} [limit] most recent first
 * @returns {Array<{at:string, text:string, meta?:Object}>}
 */
function getLessons(scope, limit = 20) {
  const data = load();
  return (data.lessons[scope] || []).slice(-limit).reverse();
}

/**
 * Whole-memory snapshot across every scope ever recorded — powers the dashboard's
 * "agent memory" card and lets a manager see every strategy's brain at a glance,
 * not just the one it's currently evaluating.
 * @returns {Object}
 */
function getAllScopesSnapshot() {
  const data = load();
  const scopes = new Set([...Object.keys(data.outcomes), ...Object.keys(data.lessons)]);
  const result = {};
  for (const scope of scopes) {
    result[scope] = {
      stats: getStats(scope),
      recentStats10: getStats(scope, 10),
      recentLessons: getLessons(scope, 5)
    };
  }
  return result;
}

module.exports = {
  recordOutcome,
  getStats,
  recordLesson,
  getLessons,
  getAllScopesSnapshot
};

// DIY, self-built "who are the good pump.fun traders" tracker — added 2026-09-01
// instead of depending on a third-party leaderboard (Kolscan's data loads from an
// endpoint that couldn't be identified in a reasonable amount of research time;
// Solana Tracker's free tier needs a signup key nobody's gotten yet). This builds
// the same kind of signal purely from real on-chain data this app already has RPC
// access to, using the same "no memory at all means repeating the same lesson"
// philosophy as pumpFunCreatorReputationService — just for TRADER wallets instead
// of creator wallets: which wallets keep showing up early on tokens that go on to
// actually pump, vs which don't. Starts from zero and needs real time/volume to
// become useful (unlike a mature third-party leaderboard with years of history) —
// that tradeoff is the honest cost of not depending on an external key.
//
// How it works:
// 1. recordEarlyBuyers(mint, entryMarketCapUsd) — called by pumpFunSniperAgent the
//    moment a new launch clears its own interest filter (real buying detected).
//    Reads the mint's actual on-chain transaction history (a handful of the
//    earliest transactions) and records which wallets received tokens in each —
//    a real "who bought this early" snapshot, not a guess.
// 2. reconcilePending() — runs periodically (see smartMoneyTrackerAgent.js): for
//    observations old enough to judge (past RECONCILE_MIN_AGE_MS) but not too old
//    to have gone stale (past RECONCILE_MAX_AGE_MS), checks the token's CURRENT
//    market cap against what it was at observation time. A real multiple, not a
//    forecast.
// 3. getLeaderboard() — aggregates reconciled observations per wallet into a real
//    win rate. Purely informational — this module never buys, sells, or follows
//    anyone; see smartMoneyTrackerAgent.js for why copy-trading isn't in scope.
// 4. getEstablishedLeaderboard() — added 2026-09-01 once a free Solana Tracker API
//    key was provided: a SEPARATE, established, multi-year leaderboard from
//    https://data.solanatracker.io (GET /v2/pnl/leaderboard/top, confirmed live —
//    their documented /v2/pnl/leaderboard/kol path 404s on this plan/key, so this
//    uses the general top-PnL leaderboard instead). Kept deliberately distinct from
//    getLeaderboard() rather than merged: they measure genuinely different things
//    (this app's own narrow on-chain observation vs. Solana Tracker's full trading
//    history), and conflating them would misrepresent both. Free tier is
//    2,500 requests/month; one call returns 100 full trader profiles, so this is
//    fetched on a slow, self-paced cadence (see FETCH_MIN_INTERVAL_MS) — comfortably
//    inside quota even polled far more often than needed.
const fs = require('fs');
const path = require('path');
const https = require('https');
const { Connection, PublicKey } = require('@solana/web3.js');

const FILE_PATH = path.join(process.cwd(), 'smart_money_observations.json');
const MAX_OBSERVATIONS = 2000;
const ESTABLISHED_FILE_PATH = path.join(process.cwd(), 'solana_tracker_leaderboard.json');
const SOLANA_TRACKER_BASE_URL = 'https://data.solanatracker.io';
const FETCH_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h — 100 traders/call, quota has huge headroom at this pace

// Kept independent of pumpFunTradingService's cached connection/keypair — this is
// read-only chain analysis with no wallet involved, and shouldn't need
// SOLANA_PRIVATE_KEY to be set to do its job (e.g. useful to run even before the
// wallet is funded).
let cachedConnection;
function getConnection() {
  if (!cachedConnection) {
    cachedConnection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com', 'confirmed');
  }
  return cachedConnection;
}

function load() {
  try {
    if (fs.existsSync(FILE_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(FILE_PATH, 'utf8'));
      return Array.isArray(parsed.observations) ? parsed.observations : [];
    }
  } catch (error) {
    console.warn('smart_money_observations.json contains invalid JSON, starting fresh:', error.message);
  }
  return [];
}

function save(observations) {
  fs.writeFileSync(FILE_PATH, JSON.stringify({ observations }, null, 2), 'utf8');
}

// How many of the mint's earliest on-chain transactions to actually inspect.
// Deliberately small — this rides on the same public, shared, easily-throttled RPC
// endpoint the sniper's own buy/sell path depends on. Skips the first 1-2 (almost
// always token creation / pool init, no buyer to credit).
const TRANSACTIONS_TO_INSPECT = 6;
const SKIP_EARLIEST = 1;

// Per-call cost was capped from the start (comment above), but call FREQUENCY
// wasn't — during a busy stretch, candidates can clear the sniper's interest
// filter every few seconds, and each one fired up to 7 more RPC calls on the same
// shared public endpoint real buy/sell/balance checks depend on. That actually
// happened live (2026-09-01, ~11:56-12:18): a 429-request storm on the shared RPC
// that cascaded into real wallet-balance checks failing with "fetch failed" — this
// feature nearly took the real trading path down with it, which the file header
// explicitly said must never happen. Hard floor on time between calls fixes the
// frequency side without needing to touch the already-small per-call cost.
const MIN_INTERVAL_BETWEEN_CALLS_MS = 90000; // 1 observation per 90s, worst case
let lastCallAt = 0;

/**
 * Real on-chain snapshot of who bought a token early, taken the moment it clears
 * the sniper's own interest filter. Never throws — every call site treats this as
 * fire-and-forget so a slow/failed RPC call here can never delay or break a real
 * buy decision. Silently skips (not an error) if called again too soon after the
 * last one — see MIN_INTERVAL_BETWEEN_CALLS_MS above.
 * @param {string} mint
 * @param {number} entryMarketCapUsd
 */
async function recordEarlyBuyers(mint, entryMarketCapUsd) {
  if (!mint || !Number.isFinite(entryMarketCapUsd) || entryMarketCapUsd <= 0) return;
  if (Date.now() - lastCallAt < MIN_INTERVAL_BETWEEN_CALLS_MS) return;
  lastCallAt = Date.now();
  try {
    const connection = getConnection();
    const mintKey = new PublicKey(mint);
    const sigInfos = await connection.getSignaturesForAddress(mintKey, { limit: TRANSACTIONS_TO_INSPECT + SKIP_EARLIEST });
    // Newest-first from the RPC; a brand-new token's full history fits in one page,
    // so reversing gives true chronological (creation-first) order.
    const chronological = sigInfos.slice().reverse().slice(SKIP_EARLIEST);

    const wallets = new Set();
    for (const { signature } of chronological) {
      try {
        const tx = await connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0 });
        const pre = tx?.meta?.preTokenBalances || [];
        const post = tx?.meta?.postTokenBalances || [];
        for (const p of post) {
          if (p.mint !== mint || !p.owner) continue;
          const before = pre.find(x => x.accountIndex === p.accountIndex);
          const preAmount = before?.uiTokenAmount?.uiAmount || 0;
          const postAmount = p.uiTokenAmount?.uiAmount || 0;
          // A real, positive token-balance increase for this owner in this
          // transaction — receiving tokens, i.e. buying, regardless of which
          // program/instruction shape did it. Pre/post balance diffing works
          // generically across any DEX/bonding-curve without decoding its
          // specific instruction format.
          if (postAmount > preAmount) wallets.add(p.owner);
        }
      } catch (error) {
        // One bad transaction (RPC hiccup, unparseable) shouldn't drop the rest.
        continue;
      }
    }

    if (wallets.size === 0) return;

    const observations = load();
    const now = new Date().toISOString();
    for (const wallet of wallets) {
      // Same (wallet, mint) pair can only be recorded once — a wallet showing up
      // in 3 of this token's first 6 transactions (adding to its own position) is
      // one early-buy decision, not three.
      if (observations.some(o => o.wallet === wallet && o.mint === mint)) continue;
      observations.push({ wallet, mint, atMarketCapUsd: entryMarketCapUsd, observedAt: now, reconciled: false, multiple: null });
    }
    save(observations.slice(-MAX_OBSERVATIONS));
  } catch (error) {
    // Never propagate — see file header, this is best-effort observation only.
    console.warn('smartMoneyTrackerService.recordEarlyBuyers failed (non-fatal):', error.message);
  }
}

const RECONCILE_MIN_AGE_MS = 30 * 60 * 1000; // give a token real time to move first
const RECONCILE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // beyond this, call it stale and drop it
const PUMP_MULTIPLE_THRESHOLD = 3; // a real "good call" bar — 3x from entry, not noise

/**
 * Judges every observation old enough to score, using the token's real current
 * market cap. Bounded per call (maxPerRun) to keep this to a handful of API calls
 * per cycle regardless of how many observations have piled up.
 * @param {number} [maxPerRun]
 * @returns {Promise<{reconciled: number, stale: number}>}
 */
async function reconcilePending(maxPerRun = 20) {
  const pumpFunTradingService = require('./pumpFunTradingService');
  const observations = load();
  const now = Date.now();

  let reconciledCount = 0;
  let staleCount = 0;
  let processed = 0;

  for (const obs of observations) {
    if (obs.reconciled || processed >= maxPerRun) continue;
    const ageMs = now - new Date(obs.observedAt).getTime();
    if (ageMs < RECONCILE_MIN_AGE_MS) continue;
    processed++;

    if (ageMs > RECONCILE_MAX_AGE_MS) {
      obs.reconciled = true;
      obs.multiple = null; // too old to judge fairly — excluded from the leaderboard, not counted as a loss
      staleCount++;
      continue;
    }

    const info = await pumpFunTradingService.getTokenInfo(obs.mint).catch(() => null);
    obs.reconciled = true;
    if (info?.usd_market_cap && obs.atMarketCapUsd) {
      obs.multiple = info.usd_market_cap / obs.atMarketCapUsd;
    } else {
      obs.multiple = null; // delisted/rugged-to-nothing or lookup failed — not a confident data point either way
    }
    reconciledCount++;
  }

  save(observations);
  return { reconciled: reconciledCount, stale: staleCount };
}

/**
 * Real, computed-on-read leaderboard — no separate stored ranking to drift out of
 * sync with the raw observations.
 * @param {number} [limit]
 * @param {number} [minCalls] minimum reconciled (and judgeable) observations before
 *   a wallet is ranked at all — keeps a single lucky trade from topping the board.
 * @returns {Array<{wallet, calls, hits, winRate, avgMultiple}>}
 */
function getLeaderboard(limit = 20, minCalls = 3) {
  // Exclude our own trading wallet — it's one of the "early buyers" on every token
  // this app itself buys (confirmed live: it showed up in its own first observation),
  // which would otherwise let this app rank itself on its own "best traders" board.
  let ownWallet = null;
  try {
    ownWallet = require('./pumpFunTradingService').getKeypair().publicKey.toBase58();
  } catch {
    // No SOLANA_PRIVATE_KEY configured — nothing to exclude, leaderboard still works.
  }

  const observations = load();
  const byWallet = new Map();

  for (const obs of observations) {
    if (!obs.reconciled || obs.multiple == null) continue; // only judgeable, reconciled calls count
    if (ownWallet && obs.wallet === ownWallet) continue;
    if (!byWallet.has(obs.wallet)) byWallet.set(obs.wallet, { calls: 0, hits: 0, multiples: [] });
    const w = byWallet.get(obs.wallet);
    w.calls++;
    w.multiples.push(obs.multiple);
    if (obs.multiple >= PUMP_MULTIPLE_THRESHOLD) w.hits++;
  }

  return Array.from(byWallet.entries())
    .map(([wallet, w]) => ({
      wallet,
      calls: w.calls,
      hits: w.hits,
      winRate: w.calls > 0 ? w.hits / w.calls : 0,
      avgMultiple: w.multiples.reduce((s, m) => s + m, 0) / w.multiples.length
    }))
    .filter(w => w.calls >= minCalls)
    .sort((a, b) => b.winRate - a.winRate || b.avgMultiple - a.avgMultiple)
    .slice(0, limit);
}

/**
 * @returns {{totalObservations: number, pendingReconciliation: number, trackedWallets: number}}
 */
function getStats() {
  const observations = load();
  return {
    totalObservations: observations.length,
    pendingReconciliation: observations.filter(o => !o.reconciled).length,
    trackedWallets: new Set(observations.map(o => o.wallet)).size
  };
}

function httpsGetJson(url, headers) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Solana Tracker request failed (${res.statusCode}): ${data.slice(0, 200)}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (error) {
          reject(new Error(`Solana Tracker returned invalid JSON: ${error.message}`));
        }
      });
    }).on('error', reject);
  });
}

function loadEstablishedCache() {
  try {
    if (fs.existsSync(ESTABLISHED_FILE_PATH)) {
      return JSON.parse(fs.readFileSync(ESTABLISHED_FILE_PATH, 'utf8'));
    }
  } catch (error) {
    console.warn('solana_tracker_leaderboard.json contains invalid JSON, starting fresh:', error.message);
  }
  return { fetchedAt: null, traders: [] };
}

/**
 * Refreshes the cached Solana Tracker leaderboard if it's stale (or missing), and
 * always returns whatever is cached — real data even if the network call itself is
 * skipped this cycle. No-ops cleanly (returns the empty cache) if
 * SOLANA_TRACKER_API_KEY isn't configured, so this is always safe to call.
 * @returns {Promise<{fetchedAt: string|null, traders: Array}>}
 */
async function refreshEstablishedLeaderboard() {
  const apiKey = process.env.SOLANA_TRACKER_API_KEY;
  if (!apiKey) return loadEstablishedCache();

  const cache = loadEstablishedCache();
  const age = cache.fetchedAt ? Date.now() - new Date(cache.fetchedAt).getTime() : Infinity;
  if (age < FETCH_MIN_INTERVAL_MS) return cache;

  try {
    const json = await httpsGetJson(`${SOLANA_TRACKER_BASE_URL}/v2/pnl/leaderboard/top`, { 'x-api-key': apiKey });
    const traders = (json.traders || []).map(t => ({
      wallet: t.wallet,
      realizedPnlUsd: t.period?.realized ?? null,
      roi: t.period?.roi ?? null,
      winRate: t.winRate ?? null,
      tradingDays: t.period?.tradingDays ?? null,
      tokensTraded: t.tokens?.closed ?? null,
      trades: t.counts?.trades ?? null
    }));
    const fresh = { fetchedAt: new Date().toISOString(), traders };
    fs.writeFileSync(ESTABLISHED_FILE_PATH, JSON.stringify(fresh, null, 2), 'utf8');
    return fresh;
  } catch (error) {
    console.warn('smartMoneyTrackerService.refreshEstablishedLeaderboard failed (non-fatal, serving stale cache if any):', error.message);
    return cache;
  }
}

/**
 * @param {number} [limit]
 * @returns {{fetchedAt: string|null, traders: Array}}
 */
function getEstablishedLeaderboard(limit = 20) {
  const cache = loadEstablishedCache();
  return { fetchedAt: cache.fetchedAt, traders: (cache.traders || []).slice(0, limit) };
}

module.exports = {
  recordEarlyBuyers,
  reconcilePending,
  getLeaderboard,
  getStats,
  refreshEstablishedLeaderboard,
  getEstablishedLeaderboard,
  PUMP_MULTIPLE_THRESHOLD
};

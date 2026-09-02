// REAL MONEY agent: watches newly-launched pump.fun tokens and buys the ones that
// show real, organic early interest — not literally every token the instant it's
// detected. Built only after the user explicitly acknowledged the real risk profile
// and chose a small, capped "play money" budget; later reworked (2026-09-01, see
// pumpFunCreatorReputationService.js) after being asked to filter on real signals
// instead of buying blind, using real live pump.fun data pulled during that change:
// of 3 real random launches sampled, only ONE picked up genuine organic buying
// (~6.85 real SOL, market cap +50%) within minutes; the other two sat at
// near-zero real reserves and flat-to-falling market cap. That's the concrete
// evidence behind the filtering logic below — most launches really are dead on
// arrival, and real_sol_reserves (actual SOL committed by real buyers, distinct
// from the token's synthetic bootstrap liquidity) is a genuine, free signal for
// telling which is which.
//
// This is NOT comparable to the Binance breakout/mean-reversion strategies. Those
// trade liquid, exchange-listed assets with real order books and a defined stop-loss
// that (barring an extreme gap) actually executes near where it's set. pump.fun tokens
// are permissionless, mostly-worthless-by-design memecoins; the launch window is
// dominated by professional sniper bots with structural latency/positioning
// advantages this agent cannot match; and a token going to zero (rug pull or just
// dying) before an exit can execute is the NORMAL outcome, not a tail risk. A
// stop-loss here is a best-effort exit attempt, not a guarantee. The filtering below
// makes this a somewhat different bet than pure-speed sniping — trading away the
// (unwinnable anyway) race to be first for a short observation window and a real
// interest signal — but does NOT change that fundamental risk profile.
//
// Trading goes through PumpPortal's Local Transaction API — a third-party service
// that never receives custody of the wallet (see pumpFunTradingService.js). Price
// monitoring uses pump.fun's own free public REST endpoint, not the metered
// WebSocket trade-subscription tier, which alone would cost more SOL than this
// wallet's deliberately tiny budget — this is also why per-buyer-level trade data
// (e.g. detecting a creator's own wallet buying most of the initial supply) isn't
// used here: that level of detail is only in the metered per-mint trade feed.
//
// Safety properties (do not remove without updating the plan/tests):
// - Never calls walletService.addEarnings — zero interaction with the fabricated
//   in-app "earnings" currency.
// - Every buy/sell goes through pumpFunTradingService, which independently requires
//   LIVE_TRADING_CONFIRMED=true, LIVE_PUMPFUN_TRADING_CONFIRMED=true, and a real
//   SOLANA_PRIVATE_KEY.
// - budgetCapUsd is a hard, permanent stop — once total confirmed buy spend reaches
//   it, this agent halts and never buys again (no auto-reset).
// - Only ever holds ONE position at a time (candidates are ignored while a position
//   is open or a buy is in flight) — spending the whole tiny budget on one
//   uncoordinated burst of buys is exactly the failure mode this guards against.
// - A failed sell never causes the agent to "forget" it's still holding the
//   position — openPosition is only cleared on a confirmed sell.
// - A creator whose past token this agent held and watched close at a severe loss
//   is never bought from again (pumpFunCreatorReputationService) — permanent, no
//   auto-reset, same philosophy as the budget cap.
const fs = require('fs');
const path = require('path');
const BaseAgent = require('./baseAgent');
const pumpFunTradingService = require('../services/pumpFunTradingService');
const creatorReputationService = require('../services/pumpFunCreatorReputationService');
const agentMemoryService = require('../services/agentMemoryService');
const smartMoneyTrackerService = require('../services/smartMoneyTrackerService');
const telegramNotifierService = require('../services/telegramNotifierService');
const Agent = require('../models/Agent');
const { Config } = require('../config/config');

const persistenceEnabled = new Config().get('agentManager.persistenceEnabled', true);
const openPositionFilePath = path.join(process.cwd(), 'pumpfun_open_position.json');

const PUMPPORTAL_WS_URL = 'wss://pumpportal.fun/api/data';

class PumpFunSniperAgent extends BaseAgent {
  constructor(options = {}) {
    super({
      ...options,
      type: 'pumpFunSniper',
      config: {
        // Hard ceiling on total real spend, all-time. Independent of (and usually
        // far above, on purpose) whatever the wallet actually holds right now —
        // getWalletBalanceSol + reserveSol is the OTHER, usually tighter, ceiling.
        budgetCapUsd: options.config?.budgetCapUsd != null ? options.config.budgetCapUsd : 10,
        // SOL kept back, never spent on a buy — covers network gas + priority fees
        // on both the buy AND the eventual sell.
        reserveSol: options.config?.reserveSol != null ? options.config.reserveSol : 0.006,
        maxSolPerSnipe: options.config?.maxSolPerSnipe != null ? options.config.maxSolPerSnipe : 0.05,
        slippagePct: options.config?.slippagePct != null ? options.config.slippagePct : 15,
        priorityFeeSol: options.config?.priorityFeeSol != null ? options.config.priorityFeeSol : 0.00005,
        stopLossPct: options.config?.stopLossPct != null ? options.config.stopLossPct : 40,
        // Trailing stop (2026-09-01) replaces the old flat profitTargetPct exit — a
        // fixed target sells a token that pumps 200% at the same +50% a token that
        // barely moved gets, capping the few real winners at exactly the size that
        // would have made this a net-positive strategy. Once the position is in
        // profit, the exit price ratchets UP with the peak instead of staying fixed,
        // so a real winner keeps running while still giving back at most
        // trailingStopPct from its best point — same mechanism as
        // backtestService.js's simulateTrailingTrades / Binance's real
        // TRAILING_STOP_MARKET order type. stopLossPct above still applies from
        // entry as the hard floor for a position that never gets into profit at all.
        trailingStopPct: options.config?.trailingStopPct != null ? options.config.trailingStopPct : 20,
        maxHoldMs: options.config?.maxHoldMs || 300000, // 5 minutes
        priceCheckIntervalMs: options.config?.priceCheckIntervalMs || 20000,
        // How often the SAME repeated error (e.g. an active Binance ban) is allowed
        // to log again — the new-token firehose can fire many times a minute, and
        // without this every single one logged its own identical line.
        errorLogThrottleMs: options.config?.errorLogThrottleMs || 120000, // 2 minutes
        // === Entry filtering (see file header for the real data behind these) ===
        // How long a candidate sits in the queue before its real_sol_reserves is
        // actually checked. Deliberately short — long enough to separate "dead on
        // arrival" from "someone's actually buying," short enough that it's still a
        // genuinely early entry if it passes, not "buy after everyone else already has."
        observationWindowMs: options.config?.observationWindowMs != null ? options.config.observationWindowMs : 10000,
        // Real SOL (not the token's synthetic bootstrap liquidity) that must have
        // been committed by real buyers by the end of the observation window. 0.3
        // SOL sits between the two "dead" tokens sampled live while building this
        // (~0 real SOL) and the one that showed genuine traction (~6.85 real SOL) —
        // a low bar, but a real one; see the file header.
        minRealSolReservesForEntry: options.config?.minRealSolReservesForEntry != null ? options.config.minRealSolReservesForEntry : 0.3,
        // A candidate older than this without having been evaluated (e.g. this
        // agent was busy holding another position) is dropped rather than bought
        // late and stale — "early" is the entire point of any edge here.
        maxCandidateAgeMs: options.config?.maxCandidateAgeMs != null ? options.config.maxCandidateAgeMs : 120000,
        maxPendingCandidates: options.config?.maxPendingCandidates || 200,
        ...options.config
      }
    });

    this.haltedReason = null;
    // Restored from the DB on a restart (see agentManager.js's loadAgentsFromDatabase)
    // so a still-open real position isn't forgotten just because the process
    // restarted — every deploy does this, so without it a held position would go
    // permanently untracked and unmanaged. See persistOpenPosition() below.
    this.openPosition = options.openPosition || null;
    this.buying = false;
    this.ws = null;
    this.lastLoggedErrorMessage = null;
    this.lastLoggedErrorAt = 0;
    // Tokens seen via the WS firehose, passed the cheap synchronous pre-filters
    // (not banned/nsfw, has a name, creator isn't a known rugger), and now waiting
    // out observationWindowMs before their real_sol_reserves is actually checked.
    // { mint, symbol, name, creator, tokenMsg, firstSeenAt }
    this.pendingCandidates = [];
  }

  /**
   * Persists this.openPosition to the Agent document — called right after every buy
   * (sets it) and every confirmed sell (clears it), so an in-flight position survives
   * a restart instead of being silently forgotten. A targeted single-field update,
   * independent of agentManager's broader (spawn/stop/shutdown-only) save cycle.
   */
  async persistOpenPosition() {
    if (!persistenceEnabled) {
      // File-based fallback — added 2026-09-01 after a real position (Pow,
      // ~$2.11) got orphaned across a restart: Agent.findOneAndUpdate() below
      // requires MongoDB, which isn't connected in this setup, so the position
      // was never actually being saved anywhere despite this method appearing to
      // run without error (the try/catch just logged and moved on). A fresh agent
      // instance then started with openPosition: null while the real tokens sat
      // untouched on-chain — correct info wallet-balance-wise (that reads the
      // chain directly), but the position was left with no exit management at all.
      try {
        if (this.openPosition) {
          fs.writeFileSync(openPositionFilePath, JSON.stringify({ agentId: String(this.id), openPosition: this.openPosition }, null, 2), 'utf8');
        } else if (fs.existsSync(openPositionFilePath)) {
          fs.unlinkSync(openPositionFilePath);
        }
      } catch (error) {
        this.log('error', 'Failed to persist openPosition to file:', error.message);
      }
      return;
    }
    try {
      await Agent.findOneAndUpdate({ agentId: String(this.id) }, { openPosition: this.openPosition });
    } catch (error) {
      this.log('error', 'Failed to persist openPosition:', error.message);
    }
  }

  /**
   * Loads a position left open by a previous instance (file-based fallback only —
   * the Mongo path already restores this via agentManager's normal DB-backed
   * rehydration on spawn). Called once at the start of run().
   */
  loadPersistedOpenPositionFromFile() {
    if (persistenceEnabled || this.openPosition) return;
    try {
      if (fs.existsSync(openPositionFilePath)) {
        const saved = JSON.parse(fs.readFileSync(openPositionFilePath, 'utf8'));
        if (saved?.openPosition) {
          this.openPosition = saved.openPosition;
          this.log('info', `Resumed open position from a previous run: ${saved.openPosition.symbol || saved.openPosition.mint}`);
        }
      }
    } catch (error) {
      this.log('error', 'Failed to load persisted openPosition from file:', error.message);
    }
  }

  async run() {
    this.loadPersistedOpenPositionFromFile();
    this.log(
      'info',
      `Starting pump.fun sniper (REAL MONEY, high risk — see file header): budget cap $${this.config.budgetCapUsd}, ` +
      `max ${this.config.maxSolPerSnipe} SOL/snipe, trailing stop ${this.config.trailingStopPct}% off peak once in profit, ` +
      `stop-loss -${this.config.stopLossPct}% from entry, max hold ${Math.round(this.config.maxHoldMs / 1000)}s. ` +
      `Filtering: ${this.config.observationWindowMs / 1000}s observation window, requires >= ` +
      `${this.config.minRealSolReservesForEntry} real SOL committed before buying (not literally the first launch seen).`
    );

    if (this.isRunning) {
      await new Promise(resolve => setTimeout(resolve, Math.random() * 30000));
    }

    this.connectWebSocket();

    while (this.isRunning) {
      try {
        if (this.openPosition) {
          this.state = 'active';
          await this.checkExitConditions();
        } else {
          this.state = this.haltedReason ? 'resting' : 'idle';
        }
      } catch (error) {
        this.log('error', 'Error managing pump.fun position:', error.message);
        this.state = 'error';
      }

      if (this.isRunning) {
        await new Promise(resolve => setTimeout(resolve, this.config.priceCheckIntervalMs));
      }
    }

    if (this.ws) {
      try { this.ws.close(); } catch (error) { /* already closed */ }
    }
  }

  connectWebSocket() {
    this.ws = new WebSocket(PUMPPORTAL_WS_URL);

    this.ws.addEventListener('open', () => {
      this.log('info', 'Connected to PumpPortal, subscribing to new token launches');
      this.ws.send(JSON.stringify({ method: 'subscribeNewToken' }));
    });

    this.ws.addEventListener('message', (event) => {
      this.handleMessage(event.data).catch(error => {
        // pump.fun's new-token firehose can fire many times a minute; while a known
        // Binance ban is active, every single one hit this same error and logged it
        // individually — hundreds of identical lines an hour, drowning out anything
        // actually worth noticing. Log a given message once per throttle window, not
        // once per WebSocket event.
        const now = Date.now();
        const isRepeat = error.message === this.lastLoggedErrorMessage &&
          now - this.lastLoggedErrorAt < this.config.errorLogThrottleMs;
        if (!isRepeat) {
          this.log('error', 'Error handling PumpPortal message:', error.message);
          this.lastLoggedErrorMessage = error.message;
          this.lastLoggedErrorAt = now;
        }
      });
    });

    this.ws.addEventListener('close', () => {
      if (this.isRunning) {
        this.log('warn', 'PumpPortal WebSocket closed — reconnecting in 10s');
        setTimeout(() => { if (this.isRunning) this.connectWebSocket(); }, 10000);
      }
    });

    this.ws.addEventListener('error', (event) => {
      this.log('warn', 'PumpPortal WebSocket error:', event.message || String(event));
    });
  }

  async handleMessage(rawData) {
    let msg;
    try {
      msg = JSON.parse(rawData.toString());
    } catch (error) {
      return;
    }

    // The subscription-confirmation message and any non-token event has no `mint`.
    if (!msg.mint) return;

    if (!this.openPosition && !this.haltedReason) {
      this.queueCandidate(msg);
    }

    // Piggyback candidate evaluation on the WS message stream itself rather than
    // waiting for the next priceCheckIntervalMs tick — new-token messages fire
    // frequently enough (many times a minute) to act as a near-continuous clock,
    // which matters here since the entire point of observationWindowMs is staying
    // close to "early."
    if (!this.openPosition && !this.haltedReason && !this.buying) {
      await this.evaluateCandidates();
    }
  }

  /**
   * Cheap, synchronous-only pre-filters — no network calls, so every message can be
   * checked instantly regardless of firehose volume. Anything that passes goes into
   * pendingCandidates to have its real_sol_reserves checked once observationWindowMs
   * has passed (see evaluateCandidates).
   * @param {Object} tokenMsg
   */
  queueCandidate(tokenMsg) {
    if (tokenMsg.nsfw || tokenMsg.is_banned) return;
    if (!tokenMsg.name && !tokenMsg.symbol) return;
    if (creatorReputationService.isKnownRugger(tokenMsg.creator)) return;

    creatorReputationService.recordLaunchSeen(tokenMsg.creator);

    if (this.pendingCandidates.length >= this.config.maxPendingCandidates) {
      this.pendingCandidates.shift(); // drop the oldest rather than grow unbounded
    }
    this.pendingCandidates.push({
      mint: tokenMsg.mint,
      symbol: tokenMsg.symbol,
      name: tokenMsg.name,
      creator: tokenMsg.creator,
      tokenMsg,
      firstSeenAt: Date.now()
    });
  }

  /**
   * Checks every candidate whose observation window has elapsed: drops stale ones
   * (maxCandidateAgeMs), and for the rest, fetches fresh token info and buys the
   * first one whose real_sol_reserves clears minRealSolReservesForEntry — the
   * "someone's actually buying this" filter (see file header for the real data
   * behind the threshold). Stops at the first buy, since only one position is ever
   * held at a time.
   */
  async evaluateCandidates() {
    const now = Date.now();
    const ready = this.pendingCandidates.filter(c => now - c.firstSeenAt >= this.config.observationWindowMs);
    if (ready.length === 0) return;

    this.pendingCandidates = this.pendingCandidates.filter(c => now - c.firstSeenAt < this.config.observationWindowMs);

    for (const candidate of ready) {
      if (now - candidate.firstSeenAt > this.config.maxCandidateAgeMs) continue; // too stale — never bought

      const info = await pumpFunTradingService.getTokenInfo(candidate.mint).catch(() => null);
      if (!info) continue;

      const realSol = (info.real_sol_reserves || 0) / 1e9; // lamports -> SOL
      if (realSol < this.config.minRealSolReservesForEntry) continue;

      this.log(
        'info',
        `${candidate.symbol || candidate.mint} cleared the interest filter: ${realSol.toFixed(3)} real SOL ` +
        `committed within ${Math.round((now - candidate.firstSeenAt) / 1000)}s of launch (reply_count=${info.reply_count || 0})`
      );

      // Fire-and-forget, real on-chain observation for the smart-money tracker —
      // runs for every candidate that clears the filter, not just ones this agent
      // buys, so its coverage isn't limited to our own single-position-at-a-time
      // trading. Never awaited: a slow/failed RPC call in here must never delay or
      // break the actual buy decision below.
      if (info.usd_market_cap) {
        smartMoneyTrackerService.recordEarlyBuyers(candidate.mint, info.usd_market_cap)
          .catch(error => this.log('warn', 'Smart-money observation failed (non-fatal):', error.message));
      }

      if (this.openPosition || this.haltedReason || this.buying) return; // state changed mid-loop
      this.buying = true;
      try {
        await this.attemptBuy(candidate.tokenMsg, info);
      } finally {
        this.buying = false;
      }
      return; // only ever one buy per evaluation pass
    }
  }

  async attemptBuy(tokenMsg, preFetchedInfo) {
    const [spentSol, solPrice, balanceSol] = await Promise.all([
      // Across ALL agent instances, not just this.id: every restart spawns a fresh
      // agent with a new ID, so a per-agent total reset the spend to zero and turned
      // this "hard, permanent" cap into a per-restart allowance. On a host that
      // redeploys often that is effectively no cap at all. See
      // getTotalSpentSolAllAgents (and PUMPFUN_BUDGET_EPOCH, which lets a cap apply
      // from a chosen point forward rather than being exhausted by old history).
      pumpFunTradingService.getTotalSpentSolAllAgents(),
      pumpFunTradingService.getSolUsdPrice(),
      pumpFunTradingService.getWalletBalanceSol()
    ]);

    const spentUsd = spentSol * solPrice;
    if (spentUsd >= this.config.budgetCapUsd) {
      this.haltedReason = `Budget cap of $${this.config.budgetCapUsd} reached (spent $${spentUsd.toFixed(2)})`;
      this.log('warn', this.haltedReason);
      return;
    }

    const availableSol = balanceSol - this.config.reserveSol;
    const remainingBudgetSol = (this.config.budgetCapUsd - spentUsd) / solPrice;
    const rawBuyAmountSol = Math.min(this.config.maxSolPerSnipe, availableSol, remainingBudgetSol);

    // Memory-based caution throttle (2026-09-01): a real, persistent-across-restarts
    // "brain" is only worth having if a bad stretch actually changes behavior. Needs
    // a real sample size (6+ closed trades) before acting — otherwise ordinary
    // variance in a handful of memecoin snipes would get mistaken for a genuine cold
    // streak. Only ever scales DOWN, never up: a hot streak doesn't get bigger bets,
    // it just stops throttling. See agentMemoryService.recordOutcome() in
    // checkExitConditions for where this memory gets written.
    const recentMemory = agentMemoryService.getStats('pumpFunSniper', 10);
    const throttled = recentMemory.trades >= 6 && recentMemory.winRate < 0.25;
    const buyAmountSol = rawBuyAmountSol * (throttled ? 0.5 : 1);

    // NaN <= 0.001 is false, same as every other NaN comparison — a bare threshold
    // check alone silently lets a broken (NaN) amount through to a real buy attempt.
    // Caught live: solPrice/balanceSol resolving to something non-finite meant this
    // agent kept trying to "buy NaN SOL" on every single new-launch event.
    if (!Number.isFinite(buyAmountSol) || buyAmountSol <= 0.001) {
      // Deliberately NOT this.haltedReason — that's reserved for the permanent
      // budget-cap stop above. An empty/thin wallet is a temporary, fixable state:
      // fund it and the very next candidate that clears the interest filter should
      // just work, with no restart needed. Setting haltedReason here would
      // permanently wedge the agent the moment it's started with an unfunded wallet
      // (its actual starting state right now) even after real SOL arrives.
      this.log(
        'warn',
        `Skipping buy — insufficient funds (wallet ~$${(balanceSol * solPrice).toFixed(2)}, ` +
        `reserve ~$${(this.config.reserveSol * solPrice).toFixed(2)} held back for gas/fees). ` +
        `Will retry automatically once funded.`
      );
      return;
    }

    this.log(
      'info',
      `New launch: ${tokenMsg.name || '?'} (${tokenMsg.symbol || '?'}) ${tokenMsg.mint} — buying ${buyAmountSol.toFixed(4)} SOL` +
      (throttled ? ` (halved — cold streak: ${recentMemory.wins}W/${recentMemory.losses}L over last ${recentMemory.trades})` : '')
    );

    const trade = await pumpFunTradingService.buyToken({
      mint: tokenMsg.mint,
      solAmount: buyAmountSol,
      agentId: this.id,
      slippagePct: this.config.slippagePct,
      priorityFeeSol: this.config.priorityFeeSol
    });

    this.updatePerformance({ actionsTaken: this.performance.actionsTaken + 1 });

    if (trade.status !== 'confirmed') {
      // "failed" here can mean two very different things: the transaction never
      // landed (genuinely nothing to do), or it landed but confirmTransaction()
      // itself timed out/errored before finding out — the exact case that stranded
      // a real position (Ponyo, ~$0.53) on 2026-09-01: recorded as a failed buy,
      // openPosition never set, so this agent had no idea it held anything, while
      // also never being able to buy again once the wallet ran low. A timeout
      // ("not confirmed in X seconds... unknown if it succeeded") is exactly the
      // ambiguous case worth checking; other errors (e.g. a real simulation
      // rejection) can't have landed anything, so skip the extra RPC call for those.
      const ambiguous = /not confirmed|unknown if it (succeeded|failed)/i.test(trade.raw?.error || '');
      if (ambiguous) {
        // A single immediate check isn't enough — confirmed live 2026-09-01 (Anna,
        // ~$0.14): the timeout fires at 30s, but the transaction can still land a
        // few seconds AFTER that, so checking only once right away can (and did)
        // race ahead of it and see a false "not held", stranding the position
        // anyway despite this whole check existing to prevent exactly that. Retries
        // for up to ~20s past the original timeout before giving up for real.
        let heldAmount = 0;
        for (let attempt = 0; attempt < 4 && heldAmount === 0; attempt++) {
          if (attempt > 0) await new Promise(resolve => setTimeout(resolve, 5000));
          heldAmount = await pumpFunTradingService.getTokenBalanceUi(tokenMsg.mint).catch(() => 0);
        }
        if (heldAmount > 0) {
          this.log('warn', `Buy for ${tokenMsg.mint} reported failed/ambiguous but ${heldAmount} tokens are actually held on-chain — adopting the position instead of stranding it.`);
          const info = preFetchedInfo || await pumpFunTradingService.getTokenInfo(tokenMsg.mint).catch(() => null);
          this.openPosition = {
            mint: tokenMsg.mint,
            symbol: tokenMsg.symbol,
            name: tokenMsg.name,
            creator: tokenMsg.creator,
            entrySolAmount: buyAmountSol,
            entryMarketCapUsd: info?.usd_market_cap || null,
            peakMarketCapUsd: info?.usd_market_cap || null,
            boughtAt: Date.now()
          };
          await this.persistOpenPosition();
          this.updatePerformance({ opportunitiesFound: this.performance.opportunitiesFound + 1 });
          return;
        }
      }
      this.log('error', `Buy failed for ${tokenMsg.mint}:`, trade.raw?.error || 'unknown error');
      return;
    }

    // Reuse the info evaluateCandidates already fetched to pass the interest filter
    // (avoids a redundant call) when it exists; only re-fetch here if this was
    // called some other way (there isn't one currently, but no reason to require it).
    const info = preFetchedInfo || await pumpFunTradingService.getTokenInfo(tokenMsg.mint).catch(() => null);

    this.openPosition = {
      mint: tokenMsg.mint,
      symbol: tokenMsg.symbol,
      name: tokenMsg.name,
      creator: tokenMsg.creator,
      entrySolAmount: buyAmountSol,
      entryMarketCapUsd: info?.usd_market_cap || null,
      // Tracks the best market cap seen since entry — the trailing stop in
      // checkExitConditions ratchets off this, not off entryMarketCapUsd, once the
      // position is in profit.
      peakMarketCapUsd: info?.usd_market_cap || null,
      boughtAt: Date.now()
    };
    await this.persistOpenPosition();
    this.updatePerformance({ opportunitiesFound: this.performance.opportunitiesFound + 1 });
    this.log('info', `Bought ${tokenMsg.symbol || tokenMsg.mint}: ${buyAmountSol} SOL, tx ${trade.txSignature}`);
  }

  async checkExitConditions() {
    const pos = this.openPosition;
    const heldMs = Date.now() - pos.boughtAt;
    const info = await pumpFunTradingService.getTokenInfo(pos.mint).catch(() => null);

    let reason = null;
    if (info?.usd_market_cap && pos.entryMarketCapUsd) {
      pos.peakMarketCapUsd = Math.max(pos.peakMarketCapUsd || pos.entryMarketCapUsd, info.usd_market_cap);
      const changeFromEntryPct = ((info.usd_market_cap - pos.entryMarketCapUsd) / pos.entryMarketCapUsd) * 100;
      const changeFromPeakPct = ((info.usd_market_cap - pos.peakMarketCapUsd) / pos.peakMarketCapUsd) * 100;

      if (changeFromEntryPct <= -this.config.stopLossPct) {
        // Hard floor from entry — fires regardless of peak, protecting a position
        // that never got into profit at all (peak stayed near entry).
        reason = `stop-loss hit (${changeFromEntryPct.toFixed(1)}% from entry)`;
      } else if (pos.peakMarketCapUsd > pos.entryMarketCapUsd && changeFromPeakPct <= -this.config.trailingStopPct) {
        // Only trails once the position has actually been in profit — a token that
        // immediately dipped and never recovered exits on the hard stop-loss above,
        // not a trailing stop measured from a peak that was never really a gain.
        reason = `trailing stop hit (${changeFromEntryPct.toFixed(1)}% from entry, ${changeFromPeakPct.toFixed(1)}% off peak)`;
      }
    }
    if (!reason && heldMs >= this.config.maxHoldMs) {
      reason = `max hold time reached (${Math.round(heldMs / 1000)}s)`;
    }
    if (!reason) return;

    this.log('info', `Selling ${pos.symbol || pos.mint}: ${reason}`);

    const trade = await pumpFunTradingService.sellToken({
      mint: pos.mint,
      agentId: this.id,
      slippagePct: this.config.slippagePct + 5,
      priorityFeeSol: this.config.priorityFeeSol,
      costBasisSolAmount: pos.entrySolAmount
    });

    this.updatePerformance({ actionsTaken: this.performance.actionsTaken + 1 });

    if (trade.status === 'no_position') {
      // The wallet genuinely holds none of this token on-chain right now — almost
      // certainly a prior sell that landed but whose confirmation was lost to a
      // network blip (see sellToken's getTokenBalanceUi check). Unlike a normal
      // failed sell, retrying this forever is pointless (it can never succeed) and
      // actively harmful (blocks this agent from ever buying again). Reconcile:
      // clear the position. The real proceeds from whatever sell actually landed
      // are unrecoverable from here, so P&L is honestly recorded as unknown, not
      // fabricated as zero or as the entry cost.
      this.log('warn', `${pos.symbol || pos.mint}: reconciled — wallet holds none of this token on-chain (stale position, likely an unconfirmed-but-landed prior sell). Clearing.`);
      agentMemoryService.recordLesson(
        'pumpFunSniper',
        `Reconciled stale position ${pos.symbol || pos.mint} — wallet held zero on-chain, real P&L unknown (a prior sell likely landed without client confirmation)`,
        { mint: pos.mint, creator: pos.creator }
      );
      this.openPosition = null;
      await this.persistOpenPosition();
      return;
    }

    if (trade.status !== 'confirmed') {
      // Sell failed — we still hold the position. Keep it open so the next cycle
      // retries; clearing it here would make the agent forget a real, still-held
      // position and could let it buy something else while already exposed.
      this.log('error', `Sell failed for ${pos.mint}, still holding:`, trade.raw?.error || 'unknown error');
      return;
    }

    this.log(
      'info',
      `Sold ${pos.symbol || pos.mint}: received ${trade.solAmount.toFixed(4)} SOL` +
      (trade.realizedPnlUsd != null ? ` (P&L $${trade.realizedPnlUsd.toFixed(2)})` : '') +
      `, tx ${trade.txSignature}`
    );
    this.updatePerformance({ earnings: this.performance.earnings + (trade.realizedPnlUsd || 0) });

    // Fire-and-forget real-time alert — never awaited, a Telegram outage must never
    // delay clearing openPosition below or anything else in this real trade path.
    const pnl = trade.realizedPnlUsd || 0;
    telegramNotifierService.sendMessage(
      `${pnl >= 0 ? '🟢' : '🔴'} <b>Sold ${pos.symbol || pos.mint}</b>\n` +
      `P&L: $${pnl.toFixed(2)} — ${reason}\n` +
      `Received ${trade.solAmount.toFixed(4)} SOL`
    ).catch(() => {});

    // Feed every real close into the shared memory service — this is what lets
    // attemptBuy() below throttle sizing after a real cold streak, and survives a
    // restart (unlike this.performance, which resets to zero every deploy).
    agentMemoryService.recordOutcome('pumpFunSniper', {
      pnlUsd: trade.realizedPnlUsd || 0,
      meta: { mint: pos.mint, symbol: pos.symbol, reason }
    });
    if ((trade.realizedPnlUsd || 0) <= -1) {
      agentMemoryService.recordLesson(
        'pumpFunSniper',
        `Lost $${Math.abs(trade.realizedPnlUsd).toFixed(2)} on ${pos.symbol || pos.mint} — ${reason}`,
        { mint: pos.mint, creator: pos.creator }
      );
    }

    // Feed the real outcome back into creator reputation — a stop-loss exit means
    // this specific token dropped by at least stopLossPct from entry, a real,
    // observed bad outcome. This creator is never bought from again. Not every
    // stop-loss is necessarily a deliberate rug (could just be a normal memecoin
    // dying), but the distinction doesn't matter here — either way, real money was
    // lost on this creator's token, which is exactly what this exists to avoid repeating.
    if (reason.startsWith('stop-loss') && pos.creator) {
      creatorReputationService.recordRugOutcome(pos.creator, pos.mint, trade.realizedPnlUsd);
      this.log('warn', `Creator ${pos.creator} marked — will not buy from this wallet again`);
    }

    this.openPosition = null;
    await this.persistOpenPosition();
  }

  /**
   * Extended status including the real ledger and wallet balance, for the dashboard.
   * @returns {Promise<Object>}
   */
  async getStatusExtended() {
    const [ledger, balanceSol, spentSol] = await Promise.all([
      pumpFunTradingService.getLedger(this.id),
      pumpFunTradingService.getWalletBalanceSol().catch(() => null),
      pumpFunTradingService.getTotalSpentSol(this.id)
    ]);

    return {
      ...this.getStatus(),
      real: {
        budgetCapUsd: this.config.budgetCapUsd,
        totalSpentSol: spentSol,
        walletBalanceSol: balanceSol,
        halted: !!this.haltedReason,
        haltedReason: this.haltedReason,
        openPosition: this.openPosition,
        recentTrades: ledger.slice(-10),
        filtering: {
          observationWindowMs: this.config.observationWindowMs,
          minRealSolReservesForEntry: this.config.minRealSolReservesForEntry,
          pendingCandidates: this.pendingCandidates.length,
          creatorReputation: creatorReputationService.getStats()
        }
      }
    };
  }

  async cleanup() {
    if (this.ws) {
      try { this.ws.close(); } catch (error) { /* already closed */ }
    }
    this.log(
      'info',
      'Cleaning up pump.fun sniper agent (no auto-liquidation performed; ' +
      'any open position remains held in the wallet)'
    );
  }
}

module.exports = PumpFunSniperAgent;

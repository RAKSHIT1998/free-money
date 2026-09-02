// Real pump.fun trading service — REAL MONEY, Solana, permissionless memecoin
// speculation. This is a fundamentally different risk category from the Binance
// agents: most tokens traded here have no underlying value, launches are dominated by
// professional sniper bots with structural latency/positioning advantages this
// service cannot compete with, and losing the full position fast (rug pull, or the
// token simply going to zero) is the normal outcome, not a tail risk. Built only after
// the user explicitly chose a small, capped "play money" budget with that understood.
//
// Trading goes through PumpPortal's "Local Transaction API" (https://pumpportal.fun) —
// a third-party service, NOT official pump.fun infrastructure. Critically, it never
// receives custody of the wallet: it only returns an unsigned transaction, which is
// signed locally with our own key and broadcast via our own RPC connection. PumpPortal
// charges 0.5% per trade on top of pump.fun's own ~1% bonding-curve fee and Solana
// network gas.
const fs = require('fs');
const path = require('path');
const { Connection, Keypair, PublicKey, VersionedTransaction, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const bs58 = require('bs58').default;
const { Config, isLikelyRealBinanceKey } = require('../config/config');

const config = new Config();
const persistenceEnabled = config.get('agentManager.persistenceEnabled', true);
const realPumpFunTradesFilePath = path.join(process.cwd(), 'real_pumpfun_trades.json');

const PUMPPORTAL_TRADE_URL = 'https://pumpportal.fun/api/trade-local';
const PUMP_FUN_API_BASE = 'https://frontend-api-v3.pump.fun';

let RealPumpFunTrade;
function getRealPumpFunTradeModel() {
  if (!RealPumpFunTrade) {
    RealPumpFunTrade = require('../models/RealPumpFunTrade');
  }
  return RealPumpFunTrade;
}

let cachedConnection;
function getConnection() {
  if (!cachedConnection) {
    cachedConnection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com', 'confirmed');
  }
  return cachedConnection;
}

let cachedKeypair;
function getKeypair() {
  if (!cachedKeypair) {
    if (!process.env.SOLANA_PRIVATE_KEY) {
      throw new Error('SOLANA_PRIVATE_KEY is not set');
    }
    cachedKeypair = Keypair.fromSecretKey(bs58.decode(process.env.SOLANA_PRIVATE_KEY));
  }
  return cachedKeypair;
}

/**
 * Defense-in-depth guard, same pattern as realFuturesTradingService's dual-opt-in —
 * independent of every Binance gate, since this is a completely separate wallet/chain.
 */
function assertLivePumpFunTradingAllowed() {
  const liveConfirmed = process.env.LIVE_TRADING_CONFIRMED === 'true';
  const pumpFunConfirmed = process.env.LIVE_PUMPFUN_TRADING_CONFIRMED === 'true';
  const hasKey = !!process.env.SOLANA_PRIVATE_KEY && process.env.SOLANA_PRIVATE_KEY.length > 32;

  if (!liveConfirmed || !pumpFunConfirmed || !hasKey) {
    throw new Error(
      'Real pump.fun trading blocked: requires LIVE_TRADING_CONFIRMED=true, ' +
      'LIVE_PUMPFUN_TRADING_CONFIRMED=true, and a real SOLANA_PRIVATE_KEY.'
    );
  }
}

/**
 * Read-only SOL balance for the configured wallet.
 * @returns {Promise<number>} balance in SOL
 */
async function getWalletBalanceSol() {
  const keypair = getKeypair();
  const connection = getConnection();
  const lamports = await connection.getBalance(keypair.publicKey);
  return lamports / LAMPORTS_PER_SOL;
}

/**
 * Real, on-chain held balance of one token — checked directly against the RPC
 * (both the standard SPL Token program and Token-2022), same query
 * getRealWallets() uses. Added 2026-09-01 after a position (5LnadjGj...) got stuck
 * retrying a sell every ~20s for over 10 hours: PumpPortal's on-chain program
 * correctly rejected every attempt with "SellZeroAmount" because the wallet
 * genuinely held none of it (almost certainly a sell that landed on-chain during an
 * earlier network blip, but whose confirmTransaction() call itself then failed --
 * "fetch failed" -- so the client recorded status:'failed' and, correctly per the
 * existing safety design, never cleared openPosition). sellToken() now checks this
 * FIRST so a stale/already-empty position gets reconciled instead of hammering a
 * doomed transaction forever.
 * @param {string} mint
 * @returns {Promise<number>} UI amount held (0 if none / account doesn't exist)
 */
async function getTokenBalanceUi(mint) {
  const keypair = getKeypair();
  const connection = getConnection();
  // Filtering by { mint } alone (rather than { programId }) unambiguously finds the
  // account regardless of whether it's a standard SPL Token or Token-2022 mint — no
  // need to query both program IDs separately here.
  const { value } = await connection.getParsedTokenAccountsByOwner(keypair.publicKey, { mint: new PublicKey(mint) });
  return value.reduce((sum, { account }) => sum + (parseFloat(account.data.parsed.info.tokenAmount.uiAmountString) || 0), 0);
}

// pump.fun's own new-token WebSocket firehose can emit several events per second at
// busy times, and getSolUsdPrice() used to be called fresh on every single one —
// hammering Binance's spot ticker endpoint dozens of times a minute with zero
// pacing. SOL/USD doesn't move meaningfully within a few seconds; a short cache
// turns that burst into essentially one request per window, the same lesson the
// Binance futures agents already learned the hard way this session.
let cachedSolPrice = null;
let cachedSolPriceAt = 0;
const SOL_PRICE_CACHE_TTL_MS = 15000;

/**
 * Current SOL/USD price via CoinGecko's public API — deliberately NOT Binance.
 * Binance spot calls are hard-disabled account-wide (BINANCE_SPOT_DISABLED, see
 * realTradingService.js) since there's no spot balance to act on; this price lookup
 * doesn't touch our account at all (it's a public market-data read), but it used to
 * share Binance's spot ticker endpoint and therefore the same disabled gate, which
 * would have silently broken pump.fun's pricing entirely. CoinGecko has no such
 * dependency. Cached for SOL_PRICE_CACHE_TTL_MS.
 * @returns {Promise<number>}
 */
async function getSolUsdPrice() {
  if (cachedSolPrice != null && Date.now() - cachedSolPriceAt < SOL_PRICE_CACHE_TTL_MS) {
    return cachedSolPrice;
  }

  const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
  if (!res.ok) {
    throw new Error(`CoinGecko SOL/USD price request failed: ${res.status}`);
  }
  const data = await res.json();
  const price = parseFloat(data?.solana?.usd);

  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`Invalid SOL/USD price response: ${JSON.stringify(data)}`);
  }

  cachedSolPrice = price;
  cachedSolPriceAt = Date.now();
  return price;
}

/**
 * Real, public pump.fun frontend API — read-only token info (bonding curve reserves,
 * market cap). Used for a lightweight price-check poll rather than the metered
 * WebSocket trade-subscription tier, which alone would cost more SOL than this
 * wallet's entire deliberately-tiny budget.
 * @param {string} mint token mint address
 * @returns {Promise<Object|null>} pump.fun's coin record, or null if not found
 */
async function getTokenInfo(mint) {
  const res = await fetch(`${PUMP_FUN_API_BASE}/coins/${mint}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; free-money-app pumpfun price check)' }
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`pump.fun coin lookup failed: ${res.status}`);
  return res.json();
}

// @solana/web3.js's SendTransactionError.message is a multi-line template
// ("Simulation failed. \nMessage: <actual reason>\nLogs: \n[...]\n..."); keeping
// only the first line (the old code) meant every stored/logged reason was just the
// useless literal string "Simulation failed." with the real cause — the "Message:"
// line — silently dropped. Found live 2026-08-05 (an IncorrectProgramId / Token-2022
// mismatch, invisible without the Logs array) and again 2026-09-01: a wave of buys
// failing with nothing but "Simulation failed." plus a *successful*-looking program
// log tail, because non-program-level reverts (e.g. insufficient balance for rent,
// checked by the runtime after every instruction succeeds) never appear in
// transactionLogs at all — only in this "Message:" line. Now kept in full.
function formatTradeError(error) {
  const rawMessage = String(error?.message || 'unknown error');
  let reason = rawMessage
    .replace(/\n?\s*Logs:\s*\n[\s\S]*$/i, '') // drop the embedded Logs blob; transactionLogs covers that separately below
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join(' ') || 'unknown error';

  // Node's fetch (undici) wraps the real underlying network error in `.cause` and
  // reduces the visible message to the generic "fetch failed" — added 2026-09-02
  // after that generic message turned out to be ~55% of all sell attempts with no
  // way to tell a DNS failure from a connection reset from a timeout. AggregateError
  // (multiple DNS-resolved addresses all failing) nests one level deeper still.
  if (error?.cause) {
    const cause = error.cause;
    const causeDetails = Array.isArray(cause?.errors)
      ? cause.errors.map(e => e?.message || String(e)).join('; ')
      : (cause?.message || cause?.code || String(cause));
    if (causeDetails) reason = `${reason} (cause: ${causeDetails})`;
  }

  const logs = Array.isArray(error?.transactionLogs) ? error.transactionLogs : null;
  if (!logs || logs.length === 0) return reason;

  const relevant = logs.filter(line => /failed|error/i.test(line));
  const tail = relevant.length > 0 ? relevant : logs.slice(-4);
  return `${reason} | ${tail.join(' // ')}`;
}

// Ledger analysis 2026-09-02: since the getTokenBalanceUi fix eliminated the earlier
// SellZeroAmount storm, the dominant remaining sell failure (~96% of what's left,
// ~55% of all sell attempts) is a bare "fetch failed" against PumpPortal's
// trade-local endpoint — this is the build-transaction step, BEFORE anything is
// signed or broadcast, so nothing has touched the chain yet and retrying it is
// unconditionally safe (unlike retrying sendTransaction/confirmTransaction, which
// could risk acting on a transaction that already landed). It previously had no
// timeout (a hung request could stall a whole scan cycle) and no local retry at all
// — every transient blip fell through to status:'failed' and had to wait for the
// agent's next ~20s cycle to try again, which is what produced 1000+ failed sell
// attempts stacked up behind a handful of real positions.
async function fetchTradeLocalWithRetry(body, { attempts = 3, timeoutMs = 12000, retryDelayMs = 400 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(PUMPPORTAL_TRADE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`PumpPortal trade-local failed (${response.status}): ${text || response.statusText}`);
      }
      return response;
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      if (attempt < attempts) {
        await new Promise(resolve => setTimeout(resolve, retryDelayMs * attempt));
      }
    }
  }
  throw lastError;
}

async function buildSignAndSend({ publicKey, action, mint, amount, denominatedInSol, slippage, priorityFee, pool }) {
  const response = await fetchTradeLocalWithRetry({
    publicKey,
    action,
    mint,
    amount,
    denominatedInSol: denominatedInSol ? 'true' : 'false',
    slippage,
    priorityFee,
    pool: pool || 'auto'
  });

  const data = await response.arrayBuffer();
  const tx = VersionedTransaction.deserialize(new Uint8Array(data));
  const keypair = getKeypair();
  tx.sign([keypair]);

  const connection = getConnection();
  const signature = await connection.sendTransaction(tx);
  await connection.confirmTransaction(signature, 'confirmed');
  return signature;
}

/**
 * Buy a token with a fixed SOL amount. The wallet's own key signs locally —
 * PumpPortal never has custody.
 * @param {Object} params
 * @param {string} params.mint
 * @param {number} params.solAmount amount of SOL to spend
 * @param {string} params.agentId
 * @param {number} [params.slippagePct] default 15 — memecoin bonding curves move fast
 * @param {number} [params.priorityFeeSol] default 0.00005
 * @returns {Promise<Object>} the recorded trade
 */
async function buyToken({ mint, solAmount, agentId, slippagePct = 15, priorityFeeSol = 0.00005 }) {
  assertLivePumpFunTradingAllowed();
  const keypair = getKeypair();

  let signature;
  let status = 'confirmed';
  let errorMessage;
  try {
    signature = await buildSignAndSend({
      publicKey: keypair.publicKey.toBase58(),
      action: 'buy',
      mint,
      amount: solAmount,
      denominatedInSol: true,
      slippage: slippagePct,
      priorityFee: priorityFeeSol
      // pool intentionally omitted — buildSignAndSend defaults to 'auto', letting
      // PumpPortal route to whichever venue the token actually needs. Hardcoding
      // 'pump' here was implicated in real, live buy failures (2026-08-05):
      // "IncorrectProgramId" building the associated token account for tokens whose
      // mint requires the Token-2022 program, which 'auto' may route around.
    });
  } catch (error) {
    status = 'failed';
    errorMessage = formatTradeError(error);
  }

  const solPrice = await getSolUsdPrice().catch(() => null);
  const record = {
    agentId,
    timestamp: new Date(),
    action: 'buy',
    tokenMint: mint,
    solAmount,
    usdAmount: solPrice ? solAmount * solPrice : undefined,
    txSignature: signature,
    status,
    raw: errorMessage ? { error: errorMessage } : undefined
  };

  return appendTrade(record);
}

/**
 * Sell a percentage of the held token balance (default 100% — exit the full
 * position). Percent-based, not an exact token quantity, so this never depends on
 * tracking precise decimals/rounding from the buy fill.
 * @param {Object} params
 * @param {string} params.mint
 * @param {string} params.agentId
 * @param {number} [params.percent] default 100
 * @param {number} [params.slippagePct] default 20 — wider than buy; exiting matters
 *   more than optimizing the fill
 * @param {number} [params.priorityFeeSol] default 0.00005
 * @param {number} [params.costBasisSolAmount] the SOL originally spent buying this
 *   position, for computing realizedPnlUsd on this row
 * @returns {Promise<Object>} the recorded trade
 */
async function sellToken({ mint, agentId, percent = 100, slippagePct = 20, priorityFeeSol = 0.00005, costBasisSolAmount }) {
  assertLivePumpFunTradingAllowed();
  const keypair = getKeypair();

  // Check the real on-chain balance FIRST — see getTokenBalanceUi's comment for why
  // this exists: a position whose sell transaction actually landed on-chain but whose
  // confirmTransaction() call then failed (network blip) looks identical, from here,
  // to a normal transient failure, and the existing safety design correctly never
  // clears openPosition on a failed sell — without this check that combination means
  // retrying a doomed "sell zero amount" transaction forever. If the wallet already
  // holds nothing, there is nothing to submit; report it as such instead.
  const heldAmount = await getTokenBalanceUi(mint).catch(() => null);
  if (heldAmount === 0) {
    const record = {
      agentId,
      timestamp: new Date(),
      action: 'sell',
      tokenMint: mint,
      solAmount: 0,
      status: 'no_position',
      raw: { note: 'Wallet already holds none of this token on-chain — nothing to sell (likely a prior sell that landed but was never confirmed client-side).' }
    };
    return appendTrade(record);
  }

  const balanceBefore = await getWalletBalanceSol().catch(() => null);

  let signature;
  let status = 'confirmed';
  let errorMessage;
  try {
    signature = await buildSignAndSend({
      publicKey: keypair.publicKey.toBase58(),
      action: 'sell',
      mint,
      amount: `${percent}%`,
      denominatedInSol: false,
      slippage: slippagePct,
      priorityFee: priorityFeeSol
      // pool intentionally omitted — buildSignAndSend defaults to 'auto', letting
      // PumpPortal route to whichever venue the token actually needs. Hardcoding
      // 'pump' here was implicated in real, live buy failures (2026-08-05):
      // "IncorrectProgramId" building the associated token account for tokens whose
      // mint requires the Token-2022 program, which 'auto' may route around.
    });
  } catch (error) {
    status = 'failed';
    errorMessage = formatTradeError(error);
  }

  const solPrice = await getSolUsdPrice().catch(() => null);
  const balanceAfter = status === 'confirmed' ? await getWalletBalanceSol().catch(() => null) : null;
  const solReceived = balanceBefore != null && balanceAfter != null ? Math.max(0, balanceAfter - balanceBefore) : null;

  let realizedPnlUsd;
  if (solPrice && solReceived != null && costBasisSolAmount != null) {
    realizedPnlUsd = (solReceived - costBasisSolAmount) * solPrice;
  }

  const record = {
    agentId,
    timestamp: new Date(),
    action: 'sell',
    tokenMint: mint,
    solAmount: solReceived != null ? solReceived : 0,
    usdAmount: solPrice && solReceived != null ? solReceived * solPrice : undefined,
    txSignature: signature,
    status,
    realizedPnlUsd,
    raw: errorMessage ? { error: errorMessage } : undefined
  };

  return appendTrade(record);
}

// File-based fallback ledger, mirroring realTradingService.js's real_trades.json
// pattern exactly — added 2026-09-01 after a real, live bug: with persistence
// disabled, appendTrade() silently discarded every trade record instead of saving
// it anywhere, and getLedger() unconditionally returned []. Real buys/sells still
// executed on-chain (that path never depended on Mongo), but getTotalSpentSol()
// always read back 0 — meaning the $10 budget cap could never trigger, no matter
// how much was actually spent. Confirmed live: 3 real buy/sell rounds executed
// with the cap silently inert throughout. Same bug class as
// crossExchangeTransferArbitrageAgent's had; that one was already fixed, this one
// wasn't checked until it actually caused an uncapped run.
function loadTradesFromFile() {
  try {
    if (fs.existsSync(realPumpFunTradesFilePath)) {
      const parsed = JSON.parse(fs.readFileSync(realPumpFunTradesFilePath, 'utf8'));
      return Array.isArray(parsed.trades) ? parsed.trades : [];
    }
  } catch (error) {
    console.warn('real_pumpfun_trades.json contains invalid JSON, starting with empty ledger:', error.message);
  }
  return [];
}

function saveTradesToFile(trades) {
  fs.writeFileSync(realPumpFunTradesFilePath, JSON.stringify({ trades }, null, 2), 'utf8');
}

async function appendTrade(tradeRecord) {
  if (persistenceEnabled) {
    const Model = getRealPumpFunTradeModel();
    const doc = await Model.create(tradeRecord);
    return doc.toObject();
  }
  const trades = loadTradesFromFile();
  const record = { ...tradeRecord, timestamp: tradeRecord.timestamp || new Date() };
  trades.push(record);
  saveTradesToFile(trades);
  return record;
}

/**
 * Real ledger for one agent.
 * @param {string} agentId
 * @returns {Promise<Array>}
 */
async function getLedger(agentId) {
  if (persistenceEnabled) {
    const Model = getRealPumpFunTradeModel();
    return Model.find({ agentId: String(agentId) }).sort({ timestamp: 1 }).lean();
  }
  return loadTradesFromFile()
    .filter(t => String(t.agentId) === String(agentId))
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

/**
 * Total SOL spent on confirmed buys, all-time, for this agent — the budget-cap
 * check basis. Sell proceeds are NOT netted back in: a budget cap tracks capital
 * put at risk, not current balance (same principle as the Binance agents' margin
 * budget caps).
 * @param {string} agentId
 * @returns {Promise<number>} SOL spent
 */
async function getTotalSpentSol(agentId) {
  const ledger = await getLedger(agentId);
  return ledger
    .filter(t => t.action === 'buy' && t.status === 'confirmed')
    .reduce((sum, t) => sum + t.solAmount, 0);
}

/**
 * Total confirmed buy spend across EVERY agent instance, optionally only counting
 * trades at or after PUMPFUN_BUDGET_EPOCH (an ISO timestamp).
 *
 * Why this exists: budgetCapUsd was enforced against getTotalSpentSol(agentId), which
 * is per-agent — and every restart spawns a fresh agent with a new incrementing ID,
 * resetting its spend to zero. A "$10 hard cap" therefore silently meant "$10 per
 * restart", and on a host that redeploys frequently that is not a cap at all. This
 * counts all instances, so the ceiling survives restarts.
 *
 * The epoch exists so a cap can be applied going forward without the ledger's existing
 * history instantly exhausting it — set PUMPFUN_BUDGET_EPOCH to now when starting a
 * fresh funded run.
 * @returns {Promise<number>} SOL spent
 */
async function getTotalSpentSolAllAgents() {
  const all = await getAllTrades();
  const epoch = process.env.PUMPFUN_BUDGET_EPOCH ? Date.parse(process.env.PUMPFUN_BUDGET_EPOCH) : null;
  return all
    .filter(t => t.action === 'buy' && t.status === 'confirmed')
    .filter(t => (epoch && Number.isFinite(epoch)) ? Date.parse(t.timestamp) >= epoch : true)
    .reduce((sum, t) => sum + (t.solAmount || 0), 0);
}

/**
 * Real P&L across EVERY pump.fun trade ever recorded, regardless of which agent
 * instance/restart made it — a fresh agent spawn gets a new incrementing ID, so a
 * per-agentId summary alone would silently drop history from before the most recent
 * restart.
 * @returns {Promise<Array>}
 */
async function getAllTrades() {
  if (persistenceEnabled) {
    const Model = getRealPumpFunTradeModel();
    return Model.find({}).sort({ timestamp: 1 }).lean();
  }
  return loadTradesFromFile().sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

/**
 * Same data as getAllTrades(), summarized — win rate, best/worst trade, etc. Same
 * shape as realFuturesTradingService.getTradeHistorySummary() for consistency when
 * both are shown together.
 * @returns {Promise<Object>}
 */
async function getAllTimeSummary() {
  const allTrades = await getAllTrades();
  const sells = allTrades.filter(t => t.action === 'sell' && t.status === 'confirmed' && t.realizedPnlUsd != null);
  const totalRealizedPnlUsd = sells.reduce((sum, t) => sum + t.realizedPnlUsd, 0);
  const wins = sells.filter(t => t.realizedPnlUsd > 0);
  const losses = sells.filter(t => t.realizedPnlUsd <= 0);
  const lastTrade = sells[sells.length - 1] || null;
  const bestTrade = sells.length > 0 ? sells.reduce((a, b) => (b.realizedPnlUsd > a.realizedPnlUsd ? b : a)) : null;
  const worstTrade = sells.length > 0 ? sells.reduce((a, b) => (b.realizedPnlUsd < a.realizedPnlUsd ? b : a)) : null;

  // GROUND TRUTH, independent of per-trade bookkeeping. totalRealizedPnlUsd above sums
  // each sell's own realizedPnlUsd, which is only as good as the cost basis that sell
  // was handed — and a sell whose matching buy never got recorded (the unconfirmed-sell
  // bug: the transaction landed on-chain but confirmTransaction() failed, so status
  // stayed 'failed') contributes its full proceeds as profit with no cost subtracted.
  //
  // Audited 2026-09-02: that inflated the reported figure to +$2.21 when actual SOL
  // flows were +0.0018 SOL (~$0.18), because 0.0195 SOL of cost basis went uncounted.
  // Net SOL in/out cannot drift this way — every buy and sell moves real lamports.
  const confirmed = allTrades.filter(t => t.status === 'confirmed');
  const solSpent = confirmed.filter(t => t.action === 'buy').reduce((s, t) => s + (t.solAmount || 0), 0);
  const solReceived = confirmed.filter(t => t.action === 'sell').reduce((s, t) => s + (t.solAmount || 0), 0);
  const netSol = solReceived - solSpent;

  // Buys with no corresponding sell — cost that the per-trade P&L never accounted for.
  const buyCountByMint = {};
  const sellCountByMint = {};
  confirmed.forEach(t => {
    const target = t.action === 'buy' ? buyCountByMint : t.action === 'sell' ? sellCountByMint : null;
    if (target) target[t.tokenMint] = (target[t.tokenMint] || 0) + 1;
  });
  const unmatchedBuys = confirmed.filter(t =>
    t.action === 'buy' && (sellCountByMint[t.tokenMint] || 0) < (buyCountByMint[t.tokenMint] || 0)
  );
  const unaccountedCostSol = unmatchedBuys.reduce((s, t) => s + (t.solAmount || 0), 0);

  const solPrice = await getSolUsdPrice().catch(() => null);

  return {
    // Kept for continuity, but no longer the headline — see netSolPnlUsd.
    totalRealizedPnlUsd,
    // What the wallet actually gained or lost across every recorded trade.
    netSol,
    netSolPnlUsd: solPrice != null ? netSol * solPrice : null,
    unaccountedCostSol,
    unaccountedCostUsd: solPrice != null ? unaccountedCostSol * solPrice : null,
    pnlFiguresDisagree: Math.abs(unaccountedCostSol) > 0.0005,
    closedTradeCount: sells.length,
    winCount: wins.length,
    lossCount: losses.length,
    winRatePct: sells.length > 0 ? (wins.length / sells.length) * 100 : null,
    lastTrade: lastTrade ? { symbol: lastTrade.tokenMint, pnlUsd: lastTrade.realizedPnlUsd, time: lastTrade.timestamp } : null,
    bestTrade: bestTrade ? { symbol: bestTrade.tokenMint, pnlUsd: bestTrade.realizedPnlUsd, time: bestTrade.timestamp } : null,
    worstTrade: worstTrade ? { symbol: worstTrade.tokenMint, pnlUsd: worstTrade.realizedPnlUsd, time: worstTrade.timestamp } : null,
    openPositionCount: allTrades.filter(t => t.action === 'buy' && t.status === 'confirmed').length - allTrades.filter(t => t.action === 'sell' && t.status === 'confirmed').length
  };
}

// Minimum SOL to leave behind on a withdrawal. Emptying the account entirely would
// leave nothing for transaction fees on any subsequent action (including selling an
// open position), and an account below the rent-exempt minimum can be reaped. This is
// the same reserve concept pumpFunSniperAgent uses before buying.
const WITHDRAWAL_RESERVE_SOL = 0.002;

/**
 * Send SOL from this app's wallet to an arbitrary destination address. REAL, IRREVERSIBLE
 * money movement — a wrong address means the funds are gone with no recourse.
 *
 * Deliberately gated on WITHDRAWAL_PIN rather than the normal login: as of 2026-09-02
 * the dashboard runs with authentication disabled at the user's request, so without a
 * separate secret this endpoint would let anyone who found the public URL drain the
 * wallet. Fails closed — if no PIN is configured, withdrawal is refused outright rather
 * than defaulting to open.
 *
 * @param {Object} params
 * @param {string} params.toAddress destination Solana address
 * @param {number|'max'} params.amountSol amount to send, or 'max' for everything above the reserve
 * @param {string} params.pin must match WITHDRAWAL_PIN
 * @returns {Promise<Object>} the recorded withdrawal
 */
async function withdrawSol({ toAddress, amountSol, pin }) {
  const configuredPin = process.env.WITHDRAWAL_PIN;
  if (!configuredPin) {
    throw new Error(
      'Withdrawals are disabled: set WITHDRAWAL_PIN in the environment first. ' +
      'This is required because the dashboard currently runs without login, so a ' +
      'withdrawal endpoint with no secret would be drainable by anyone with the URL.'
    );
  }
  if (pin !== configuredPin) {
    throw new Error('Incorrect withdrawal PIN');
  }

  const { SystemProgram, Transaction, PublicKey, sendAndConfirmTransaction } = require('@solana/web3.js');

  let destination;
  try {
    destination = new PublicKey(toAddress);
  } catch (error) {
    throw new Error(`Invalid Solana address: ${toAddress}`);
  }
  // A valid-looking key that isn't actually on the ed25519 curve can't hold/spend SOL
  // normally — catching it here rather than after the funds have already moved.
  if (!PublicKey.isOnCurve(destination.toBytes())) {
    throw new Error(`Address is not a valid wallet address (off-curve): ${toAddress}`);
  }

  const keypair = getKeypair();
  const connection = getConnection();
  const balanceSol = await getWalletBalanceSol();
  const available = balanceSol - WITHDRAWAL_RESERVE_SOL;

  if (available <= 0) {
    throw new Error(
      `Nothing available to withdraw: balance ${balanceSol.toFixed(6)} SOL, ` +
      `${WITHDRAWAL_RESERVE_SOL} SOL reserved for transaction fees.`
    );
  }

  const requested = amountSol === 'max' ? available : parseFloat(amountSol);
  if (!Number.isFinite(requested) || requested <= 0) {
    throw new Error(`Invalid amount: ${amountSol}`);
  }
  if (requested > available) {
    throw new Error(
      `Requested ${requested.toFixed(6)} SOL but only ${available.toFixed(6)} SOL is ` +
      `available (balance ${balanceSol.toFixed(6)}, ${WITHDRAWAL_RESERVE_SOL} reserved for fees).`
    );
  }

  const lamports = Math.floor(requested * LAMPORTS_PER_SOL);
  const transaction = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: keypair.publicKey, toPubkey: destination, lamports })
  );

  let signature;
  let status = 'confirmed';
  let errorMessage;
  try {
    signature = await sendAndConfirmTransaction(connection, transaction, [keypair]);
  } catch (error) {
    status = 'failed';
    errorMessage = formatTradeError(error);
  }

  const solPrice = await getSolUsdPrice().catch(() => null);
  const record = {
    agentId: 'manual-withdrawal',
    timestamp: new Date(),
    action: 'withdraw',
    tokenMint: 'SOL',
    solAmount: requested,
    usdAmount: solPrice ? requested * solPrice : undefined,
    txSignature: signature,
    status,
    raw: errorMessage ? { error: errorMessage, toAddress } : { toAddress }
  };
  await appendTrade(record);

  if (status === 'failed') {
    throw new Error(`Withdrawal failed: ${errorMessage}`);
  }

  return {
    signature,
    amountSol: requested,
    amountUsd: solPrice ? requested * solPrice : null,
    toAddress,
    remainingSol: balanceSol - requested,
    explorerUrl: `https://solscan.io/tx/${signature}`
  };
}

/**
 * How much could be withdrawn right now, without actually moving anything — so the UI
 * can show a real number instead of making the user guess and hit an error.
 */
async function getWithdrawableSol() {
  const balanceSol = await getWalletBalanceSol();
  return {
    balanceSol,
    reservedSol: WITHDRAWAL_RESERVE_SOL,
    withdrawableSol: Math.max(0, balanceSol - WITHDRAWAL_RESERVE_SOL),
    pinConfigured: !!process.env.WITHDRAWAL_PIN
  };
}

module.exports = {
  getKeypair,
  getConnection,
  getWalletBalanceSol,
  getTokenBalanceUi,
  getSolUsdPrice,
  getTokenInfo,
  buyToken,
  sellToken,
  getLedger,
  getTotalSpentSol,
  getTotalSpentSolAllAgents,
  getAllTrades,
  getAllTimeSummary,
  withdrawSol,
  getWithdrawableSol,
  assertLivePumpFunTradingAllowed
};

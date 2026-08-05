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
const { Connection, Keypair, VersionedTransaction, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const bs58 = require('bs58').default;
const { Config, isLikelyRealBinanceKey } = require('../config/config');

const config = new Config();
const persistenceEnabled = config.get('agentManager.persistenceEnabled', true);

const PUMPPORTAL_TRADE_URL = 'https://pumpportal.fun/api/trade-local';
const PUMP_FUN_API_BASE = 'https://frontend-api-v3.pump.fun';

// Lazy require of the spot service, purely to reuse its Binance rate-limit gate —
// getSolUsdPrice() below hits the exact same Binance endpoint (api.binance.com spot
// ticker) that realTradingService.js already protects, so both share one cooldown
// instead of each independently discovering (or missing) the same ban.
let realTradingService;
function getRealTradingService() {
  if (!realTradingService) {
    realTradingService = require('./realTradingService');
  }
  return realTradingService;
}

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
 * Current SOL/USD price via Binance's public spot ticker (unrelated to, and
 * unaffected by, any Binance futures rate-limit/ban state — different endpoint,
 * different base URL, no shared cooldown gate). Cached for SOL_PRICE_CACHE_TTL_MS.
 * @returns {Promise<number>}
 */
async function getSolUsdPrice() {
  if (cachedSolPrice != null && Date.now() - cachedSolPriceAt < SOL_PRICE_CACHE_TTL_MS) {
    return cachedSolPrice;
  }

  // Shares realTradingService's persisted Binance-spot cooldown gate — this is the
  // exact same endpoint that agent's own hammering got IP-banned on 2026-08-05, so
  // this call must respect (and contribute to) the same ban state, not track it
  // independently.
  const spotService = getRealTradingService();
  await spotService.assertSpotNotRateLimited();

  const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT');
  const data = await res.json();

  // fetch() doesn't throw on a non-2xx status the way axios does, so a 418/429 ban
  // response still resolves normally here — check explicitly and feed it into the
  // shared gate exactly like noteSpotRateLimitResponse expects (axios-shaped
  // error.response.status/headers), reading the real status/retry-after off the
  // actual response rather than guessing from the body.
  if (!res.ok) {
    spotService.noteSpotRateLimitResponse({
      response: { status: res.status, headers: { 'retry-after': res.headers.get('retry-after') } }
    });
  }

  const price = parseFloat(data.price);
  // A failed/rate-limited call still resolves with a 200-shaped-looking body (e.g.
  // {code, msg}), so data.price is undefined and this would silently return NaN
  // instead of throwing — which then poisons every downstream calculation with NaN
  // (observed live: an agent computing "buying NaN SOL" and repeatedly attempting
  // it on every new-launch event). Fail loudly instead.
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

async function buildSignAndSend({ publicKey, action, mint, amount, denominatedInSol, slippage, priorityFee, pool }) {
  const response = await fetch(PUMPPORTAL_TRADE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicKey,
      action,
      mint,
      amount,
      denominatedInSol: denominatedInSol ? 'true' : 'false',
      slippage,
      priorityFee,
      pool: pool || 'auto'
    })
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`PumpPortal trade-local failed (${response.status}): ${text || response.statusText}`);
  }

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
      priorityFee: priorityFeeSol,
      pool: 'pump'
    });
  } catch (error) {
    status = 'failed';
    errorMessage = error.message;
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
      priorityFee: priorityFeeSol,
      pool: 'pump'
    });
  } catch (error) {
    status = 'failed';
    errorMessage = error.message;
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

async function appendTrade(tradeRecord) {
  if (persistenceEnabled) {
    const Model = getRealPumpFunTradeModel();
    const doc = await Model.create(tradeRecord);
    return doc.toObject();
  }
  return tradeRecord;
}

/**
 * Real ledger for one agent.
 * @param {string} agentId
 * @returns {Promise<Array>}
 */
async function getLedger(agentId) {
  if (!persistenceEnabled) return [];
  const Model = getRealPumpFunTradeModel();
  return Model.find({ agentId: String(agentId) }).sort({ timestamp: 1 }).lean();
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

module.exports = {
  getKeypair,
  getConnection,
  getWalletBalanceSol,
  getSolUsdPrice,
  getTokenInfo,
  buyToken,
  sellToken,
  getLedger,
  getTotalSpentSol,
  assertLivePumpFunTradingAllowed
};

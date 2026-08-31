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
const { Connection, Keypair, VersionedTransaction, LAMPORTS_PER_SOL } = require('@solana/web3.js');
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

// @solana/web3.js's SendTransactionError.message is only ever the first line of a
// multi-line template ("Simulation failed. \nMessage: ...\nLogs: \n[...]\n..."); the
// actual on-chain revert reason lives in the separate .transactionLogs array, which
// error.message never includes. Losing that meant every failed trade's stored/logged
// reason was just the useless literal string "Simulation failed." — found live
// 2026-08-05 reconstructing Render's line-by-line log output by hand to see why every
// single pump.fun buy attempt was failing (an IncorrectProgramId / Token-2022 mismatch,
// invisible without this).
function formatTradeError(error) {
  const firstLine = String(error?.message || 'unknown error').split('\n')[0].trim();
  const logs = Array.isArray(error?.transactionLogs) ? error.transactionLogs : null;
  if (!logs || logs.length === 0) return firstLine;

  const relevant = logs.filter(line => /failed|error/i.test(line));
  const tail = relevant.length > 0 ? relevant : logs.slice(-4);
  return `${firstLine} | ${tail.join(' // ')}`;
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
 * Real P&L across EVERY pump.fun trade ever recorded, regardless of which agent
 * instance/restart made it — a fresh agent spawn gets a new incrementing ID, so a
 * per-agentId summary alone would silently drop history from before the most recent
 * restart. Same summary shape as realFuturesTradingService.getTradeHistorySummary()
 * for consistency when both are shown together.
 * @returns {Promise<Object>}
 */
async function getAllTrades() {
  if (persistenceEnabled) {
    const Model = getRealPumpFunTradeModel();
    return Model.find({}).sort({ timestamp: 1 }).lean();
  }
  return loadTradesFromFile().sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

async function getAllTimeSummary() {
  const allTrades = await getAllTrades();
  {
  }

  const sells = allTrades.filter(t => t.action === 'sell' && t.status === 'confirmed' && t.realizedPnlUsd != null);
  const totalRealizedPnlUsd = sells.reduce((sum, t) => sum + t.realizedPnlUsd, 0);
  const wins = sells.filter(t => t.realizedPnlUsd > 0);
  const losses = sells.filter(t => t.realizedPnlUsd <= 0);
  const lastTrade = sells[sells.length - 1] || null;
  const bestTrade = sells.length > 0 ? sells.reduce((a, b) => (b.realizedPnlUsd > a.realizedPnlUsd ? b : a)) : null;
  const worstTrade = sells.length > 0 ? sells.reduce((a, b) => (b.realizedPnlUsd < a.realizedPnlUsd ? b : a)) : null;

  return {
    totalRealizedPnlUsd,
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
  getAllTimeSummary,
  assertLivePumpFunTradingAllowed
};

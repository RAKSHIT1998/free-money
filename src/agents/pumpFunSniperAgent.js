// REAL MONEY agent: buys newly-launched pump.fun tokens the instant they're detected
// and exits on a simple, honest rule (profit target / stop-loss / max hold time,
// whichever comes first). Built only after the user explicitly acknowledged the real
// risk profile and chose a small, capped "play money" budget.
//
// This is NOT comparable to the Binance breakout/mean-reversion strategies. Those
// trade liquid, exchange-listed assets with real order books and a defined stop-loss
// that (barring an extreme gap) actually executes near where it's set. pump.fun tokens
// are permissionless, mostly-worthless-by-design memecoins; the launch window is
// dominated by professional sniper bots with structural latency/positioning
// advantages this agent cannot match; and a token going to zero (rug pull or just
// dying) before an exit can execute is the NORMAL outcome, not a tail risk. A
// stop-loss here is a best-effort exit attempt, not a guarantee.
//
// Trading goes through PumpPortal's Local Transaction API — a third-party service
// that never receives custody of the wallet (see pumpFunTradingService.js). Price
// monitoring uses pump.fun's own free public REST endpoint, not the metered
// WebSocket trade-subscription tier, which alone would cost more SOL than this
// wallet's deliberately tiny budget.
//
// Safety properties (do not remove without updating the plan/tests):
// - Never calls walletService.addEarnings — zero interaction with the fabricated
//   in-app "earnings" currency.
// - Every buy/sell goes through pumpFunTradingService, which independently requires
//   LIVE_TRADING_CONFIRMED=true, LIVE_PUMPFUN_TRADING_CONFIRMED=true, and a real
//   SOLANA_PRIVATE_KEY.
// - budgetCapUsd is a hard, permanent stop — once total confirmed buy spend reaches
//   it, this agent halts and never buys again (no auto-reset).
// - Only ever holds ONE position at a time (new-token messages are ignored while a
//   position is open or a buy is in flight) — spending the whole tiny budget on one
//   uncoordinated burst of buys is exactly the failure mode this guards against.
// - A failed sell never causes the agent to "forget" it's still holding the
//   position — openPosition is only cleared on a confirmed sell.
const BaseAgent = require('./baseAgent');
const pumpFunTradingService = require('../services/pumpFunTradingService');

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
        reserveSol: options.config?.reserveSol != null ? options.config.reserveSol : 0.003,
        maxSolPerSnipe: options.config?.maxSolPerSnipe != null ? options.config.maxSolPerSnipe : 0.05,
        slippagePct: options.config?.slippagePct != null ? options.config.slippagePct : 15,
        priorityFeeSol: options.config?.priorityFeeSol != null ? options.config.priorityFeeSol : 0.00005,
        profitTargetPct: options.config?.profitTargetPct != null ? options.config.profitTargetPct : 50,
        stopLossPct: options.config?.stopLossPct != null ? options.config.stopLossPct : 40,
        maxHoldMs: options.config?.maxHoldMs || 300000, // 5 minutes
        priceCheckIntervalMs: options.config?.priceCheckIntervalMs || 20000,
        ...options.config
      }
    });

    this.haltedReason = null;
    this.openPosition = null;
    this.buying = false;
    this.ws = null;
  }

  async run() {
    this.log(
      'info',
      `Starting pump.fun sniper (REAL MONEY, high risk — see file header): budget cap $${this.config.budgetCapUsd}, ` +
      `max ${this.config.maxSolPerSnipe} SOL/snipe, profit target +${this.config.profitTargetPct}%, ` +
      `stop-loss -${this.config.stopLossPct}%, max hold ${Math.round(this.config.maxHoldMs / 1000)}s`
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
        this.log('error', 'Error handling PumpPortal message:', error.message);
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
    if (this.openPosition || this.haltedReason || this.buying) return;

    this.buying = true;
    try {
      await this.attemptBuy(msg);
    } finally {
      this.buying = false;
    }
  }

  async attemptBuy(tokenMsg) {
    const [spentSol, solPrice, balanceSol] = await Promise.all([
      pumpFunTradingService.getTotalSpentSol(this.id),
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
    const buyAmountSol = Math.min(this.config.maxSolPerSnipe, availableSol, remainingBudgetSol);

    if (buyAmountSol <= 0.001) {
      this.haltedReason = `Insufficient funds to snipe (wallet ~$${(balanceSol * solPrice).toFixed(2)}, ` +
        `reserve ~$${(this.config.reserveSol * solPrice).toFixed(2)} held back for gas/fees)`;
      this.log('warn', this.haltedReason);
      return;
    }

    this.log(
      'info',
      `New launch: ${tokenMsg.name || '?'} (${tokenMsg.symbol || '?'}) ${tokenMsg.mint} — buying ${buyAmountSol.toFixed(4)} SOL`
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
      this.log('error', `Buy failed for ${tokenMsg.mint}:`, trade.raw?.error || 'unknown error');
      return;
    }

    const info = await pumpFunTradingService.getTokenInfo(tokenMsg.mint).catch(() => null);

    this.openPosition = {
      mint: tokenMsg.mint,
      symbol: tokenMsg.symbol,
      name: tokenMsg.name,
      entrySolAmount: buyAmountSol,
      entryMarketCapUsd: info?.usd_market_cap || null,
      boughtAt: Date.now()
    };
    this.updatePerformance({ opportunitiesFound: this.performance.opportunitiesFound + 1 });
    this.log('info', `Bought ${tokenMsg.symbol || tokenMsg.mint}: ${buyAmountSol} SOL, tx ${trade.txSignature}`);
  }

  async checkExitConditions() {
    const pos = this.openPosition;
    const heldMs = Date.now() - pos.boughtAt;
    const info = await pumpFunTradingService.getTokenInfo(pos.mint).catch(() => null);

    let reason = null;
    if (info?.usd_market_cap && pos.entryMarketCapUsd) {
      const changePct = ((info.usd_market_cap - pos.entryMarketCapUsd) / pos.entryMarketCapUsd) * 100;
      if (changePct >= this.config.profitTargetPct) {
        reason = `profit target hit (+${changePct.toFixed(1)}%)`;
      } else if (changePct <= -this.config.stopLossPct) {
        reason = `stop-loss hit (${changePct.toFixed(1)}%)`;
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
    this.openPosition = null;
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
        recentTrades: ledger.slice(-10)
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

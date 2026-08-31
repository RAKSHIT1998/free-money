// REAL MONEY, HIGH-RISK agent: transfer-based cross-exchange arbitrage. Buys on
// Binance, WITHDRAWS the real crypto to Coinbase, and sells there once the deposit
// lands. This is the model the user explicitly chose after being warned about its
// core risk — recorded here so the risk stays visible in the code, not just in a
// chat log:
//
// Crypto transfers between exchanges are NOT instant. A withdrawal is a real
// on-chain transaction (or Binance's internal transfer network for supported
// pairs) — typically 10-60+ minutes depending on the asset/network, sometimes
// longer, before Coinbase actually credits it. The spread this agent acts on is
// measured at BUY time; by the time the deposit lands, that spread has very likely
// closed or reversed (that's exactly why it was closeable in the first place — real
// spreads get arbitraged shut fast by faster capital). This agent does NOT pretend
// otherwise: minNetSpreadPct defaults much higher than crossExchangeArbitrageAgent's
// pure scanner threshold specifically to build in margin for that risk, and if the
// spread has moved against the position by more than maxAcceptableLossPct by the
// time the deposit lands, it does NOT auto-sell into that loss — see
// processPendingPositions() below.
//
// Structural difference from every other real-money agent in this codebase: this is
// the only one that spans two separate exchange accounts and includes an
// irreversible withdrawal step. Read realTradingService.js's assertLiveWithdrawalAllowed
// and coinbaseTradingService.js's assertLiveCoinbaseTradingAllowed before touching
// the gates below — they're deliberately stricter than ordinary trading.
//
// Safety properties (do not remove without updating the plan/tests):
// - Only ever acts on assets in ASSET_NETWORKS below — a hardcoded, small,
//   deliberately-verified allowlist. The dynamic pairlist from
//   crossExchangeMarketDataService can and does include assets outside this list;
//   those are simply skipped, never guessed at. Getting a withdrawal network wrong
//   is not a "try again" mistake.
// - Both real-money legs (Binance buy, Coinbase sell) and the withdrawal go through
//   their own independently-gated services — this agent has no shortcut around any
//   of those checks.
// - If a leg fails after an earlier one already succeeded, the position is marked
//   'stranded_after_buy' / 'stranded_after_withdrawal' / 'needs_manual_review' with a
//   clear note rather than silently retried or hidden — a human needs to see and
//   resolve these, matching fundingRateArbitrageAgent's 'unhedged' philosophy.
// - Never calls walletService.addEarnings — zero interaction with the fabricated
//   in-app "earnings" currency.
const BaseAgent = require('./baseAgent');
const realTradingService = require('../services/realTradingService');
const coinbaseTradingService = require('../services/coinbaseTradingService');
const marketDataService = require('../services/crossExchangeMarketDataService');
const positionStore = require('../services/transferArbPositionStore');

// Binance's withdrawal `network` code for each asset's single native chain. Deliberately
// small and conservative — every entry here is a well-established single-network asset
// (or, for LINK/UNI, a standard ERC-20 on Ethereum). Any asset NOT listed here is simply
// never traded by this agent, regardless of what the dynamic pairlist surfaces. Verify
// against your own Binance account's withdrawal screen before relying on this with real
// money — these are believed correct but Binance is the actual authority.
const ASSET_NETWORKS = {
  BTC: 'BTC',
  ETH: 'ETH',
  SOL: 'SOL',
  XRP: 'XRP',
  LTC: 'LTC',
  DOGE: 'DOGE',
  ADA: 'ADA',
  LINK: 'ETH',
  UNI: 'ETH',
  DOT: 'DOT',
  ZEC: 'ZEC',
  BCH: 'BCH',
  ETC: 'ETC'
};

// Rough order-of-magnitude USD withdrawal fee estimates per asset — Binance's real
// fee moves with network conditions and account tier. This only affects whether a
// candidate clears minNetSpreadPct; the actual fee Binance charges is authoritative
// and gets deducted from the withdrawn amount regardless of this estimate.
const DEFAULT_WITHDRAWAL_FEE_USD_ESTIMATES = {
  BTC: 2, ETH: 3, SOL: 0.05, XRP: 0.25, LTC: 0.01, DOGE: 2, ADA: 0.5,
  LINK: 2, UNI: 2, DOT: 0.1, ZEC: 0.01, BCH: 0.01, ETC: 0.05
};

class CrossExchangeTransferArbitrageAgent extends BaseAgent {
  constructor(options = {}) {
    super({
      ...options,
      type: 'crossExchangeTransferArbitrage',
      config: {
        perTradeUsd: options.config?.perTradeUsd || 25,
        minNetSpreadPct: options.config?.minNetSpreadPct != null ? options.config.minNetSpreadPct : 0.02,
        decayBufferPct: options.config?.decayBufferPct != null ? options.config.decayBufferPct : 0.005,
        maxAcceptableLossPct: options.config?.maxAcceptableLossPct != null ? options.config.maxAcceptableLossPct : 0.03,
        maxConcurrentPositions: options.config?.maxConcurrentPositions || 1,
        depositTimeoutMs: options.config?.depositTimeoutMs || 7200000,
        scanIntervalMs: options.config?.scanIntervalMs || 10000,
        maxSpreadRatio: options.config?.maxSpreadRatio != null ? options.config.maxSpreadRatio : 0.005,
        staleQuoteMs: options.config?.staleQuoteMs || 15000,
        takerFees: {
          binance: marketDataService.DEFAULT_TAKER_FEES.binance,
          coinbase: marketDataService.DEFAULT_TAKER_FEES.coinbase,
          ...(options.config?.takerFees || {})
        },
        withdrawalFeeUsdEstimates: { ...DEFAULT_WITHDRAWAL_FEE_USD_ESTIMATES, ...(options.config?.withdrawalFeeUsdEstimates || {}) },
        ...options.config
      }
    });

    this.lastScanAt = null;
    this.lastScanNote = null;
  }

  async run() {
    this.log(
      'warn',
      `Starting cross-exchange TRANSFER arbitrage (REAL MONEY, HIGH-RISK): $${this.config.perTradeUsd}/trade, ` +
      `min net spread ${(this.config.minNetSpreadPct * 100).toFixed(2)}% after fees + estimated withdrawal cost ` +
      `+ ${(this.config.decayBufferPct * 100).toFixed(2)}% decay buffer, max ${this.config.maxConcurrentPositions} ` +
      `concurrent position(s), assets eligible: ${Object.keys(ASSET_NETWORKS).join(', ')}. ` +
      `Deposits that don't land within ${Math.round(this.config.depositTimeoutMs / 60000)}min are marked stranded ` +
      `for manual review, not retried automatically.`
    );

    // Live quotes come from crossExchangeMarketDataService's WebSocket cache — start
    // it (idempotent) so this agent works even if crossExchangeArbitrageAgent isn't
    // also running.
    marketDataService.startStreaming(() => marketDataService.getCachedPairlistAssets());

    while (this.isRunning) {
      try {
        await this.scanCycle();
      } catch (error) {
        this.log('error', 'Error in transfer-arbitrage cycle:', error.message);
        this.state = 'error';
      }

      if (this.isRunning) {
        await new Promise(resolve => setTimeout(resolve, this.config.scanIntervalMs));
      }
    }
  }

  async scanCycle() {
    this.state = 'active';

    await marketDataService.getPairlist(
      { numberAssets: 15, minQuoteVolumeUsd: 2000000, maxSpreadRatio: this.config.maxSpreadRatio },
      1800000
    );

    await this.processPendingPositions();

    const openCount = await positionStore.countOpenPositions(this.id);

    if (openCount < this.config.maxConcurrentPositions) {
      await this.tryOpenNewPosition();
    }

    this.lastScanAt = new Date();
    if (this.state !== 'error') this.state = openCount > 0 ? 'active' : 'idle';
  }

  /**
   * Advances every position currently waiting on a deposit: checks arrival, and
   * either sells, flags for manual review (spread moved too far against it), or
   * marks stranded (timed out). Never loops/blocks — one check per position per
   * scanCycle, so a multi-hour wait never freezes the agent.
   */
  async processPendingPositions() {
    const pending = await positionStore.getPendingDepositPositions(this.id);

    for (const position of pending) {
      let arrived, currentBalance;
      try {
        ({ arrived, currentBalance } = await coinbaseTradingService.hasDepositArrived({
          asset: position.asset,
          baselineBalance: position.depositBaselineBalance,
          minAmount: position.withdrawAmount
        }));
      } catch (error) {
        this.log('error', `Error checking Coinbase deposit status for ${position.asset}:`, error.message);
        continue;
      }

      if (!arrived) {
        // new Date(x) rather than position.withdrawnAt.getTime() directly — the
        // file-backed store (no MongoDB) round-trips dates through JSON as plain
        // strings, not Date objects; new Date() handles both a Date and a string.
        const elapsedMs = Date.now() - new Date(position.withdrawnAt).getTime();
        if (elapsedMs > this.config.depositTimeoutMs) {
          position.status = 'stranded_after_withdrawal';
          position.note = `Deposit never confirmed on Coinbase within ${Math.round(this.config.depositTimeoutMs / 60000)} ` +
            `minutes of withdrawal. Binance withdrawal ID: ${position.binanceWithdrawId}, expected ${position.withdrawAmount} ` +
            `${position.asset} to ${position.withdrawAddress} (network ${position.withdrawNetwork}). Trace this on Binance's ` +
            `withdrawal history / a block explorer and resolve manually — the agent will not retry or guess.`;
          await position.save();
          this.log('error', `CRITICAL: withdrawal for ${position.asset} did not land in time:`, position.note);
        }
        continue;
      }

      position.depositConfirmedAt = new Date();

      let quote;
      try {
        quote = await coinbaseTradingService.getCurrentQuote(position.asset);
      } catch (error) {
        await position.save();
        this.log('error', `Deposit for ${position.asset} landed but couldn't fetch a current Coinbase price:`, error.message);
        continue;
      }

      const sellQty = Math.min(position.withdrawAmount, currentBalance);
      const costBasisUsd = position.buyQty * position.buyFillPriceUsd;
      const grossProceedsUsd = sellQty * quote.bid;
      const pnlPct = (grossProceedsUsd - costBasisUsd) / costBasisUsd;

      if (pnlPct < -this.config.maxAcceptableLossPct) {
        position.status = 'needs_manual_review';
        position.note = `Deposit landed (${sellQty} ${position.asset}) but current net P&L would be ` +
          `${(pnlPct * 100).toFixed(2)}%, beyond the ${(this.config.maxAcceptableLossPct * 100).toFixed(2)}% max ` +
          `acceptable loss — NOT auto-selling. Current Coinbase bid $${quote.bid}. Review and sell manually if/when ` +
          `you decide, or wait for a bounce.`;
        await position.save();
        this.log('warn', `Position on ${position.asset} needs manual review:`, position.note);
        continue;
      }

      try {
        const sellResult = await coinbaseTradingService.placeMarketSellOrder({ asset: position.asset, quantity: sellQty, agentId: this.id });
        position.status = 'closed';
        position.coinbaseSellOrderId = sellResult.coinbaseOrderId;
        position.sellQty = sellResult.filledQty;
        position.sellFillPriceUsd = sellResult.fillPrice;
        position.realizedPnlUsd = (sellResult.filledQty * sellResult.fillPrice) - costBasisUsd;
        position.closedAt = new Date();
        await position.save();
        this.updatePerformance({ actionsTaken: this.performance.actionsTaken + 1 });
        this.log(
          'info',
          `Closed transfer-arb position on ${position.asset}: realized P&L $${position.realizedPnlUsd.toFixed(2)} ` +
          `(${(pnlPct * 100).toFixed(2)}%)`
        );
      } catch (error) {
        position.status = 'needs_manual_review';
        position.note = `Deposit landed (${sellQty} ${position.asset}, current bid $${quote.bid}) but the Coinbase ` +
          `sell order failed: ${error.message}. Funds remain on Coinbase, unsold — resolve manually.`;
        await position.save();
        this.log('error', `Sell failed for ${position.asset} after deposit landed:`, position.note);
      }
    }
  }

  /**
   * Estimated all-in cost of the withdrawal leg as a fraction of perTradeUsd — folded
   * into the net-spread check so a trade that only clears fees but not the
   * withdrawal cost is correctly rejected, not opened.
   */
  estimateWithdrawalFeePct(asset) {
    const feeUsd = this.config.withdrawalFeeUsdEstimates[asset];
    if (feeUsd == null) return 0.02; // shouldn't happen — ASSET_NETWORKS and this map are kept in sync
    return feeUsd / this.config.perTradeUsd;
  }

  async tryOpenNewPosition() {
    const eligibleAssets = marketDataService.getCachedPairlistAssets().filter(asset => ASSET_NETWORKS[asset]);
    if (eligibleAssets.length === 0) {
      this.lastScanNote = 'No pairlist assets currently intersect this agent\'s verified withdrawal-network allowlist';
      return;
    }

    const results = marketDataService.getLiveQuotes(eligibleAssets, {
      maxSpreadRatio: this.config.maxSpreadRatio,
      staleMs: this.config.staleQuoteMs
    });

    let best = null;
    for (const { asset, quotes } of results) {
      const binanceQuote = quotes.find(q => q.exchange === 'binance');
      const coinbaseQuote = quotes.find(q => q.exchange === 'coinbase');
      if (!binanceQuote || !coinbaseQuote) continue;
      if (coinbaseQuote.bid <= binanceQuote.ask) continue; // not crossed

      const grossSpreadPct = (coinbaseQuote.bid - binanceQuote.ask) / binanceQuote.ask;
      const netSpreadPct = grossSpreadPct
        - this.config.takerFees.binance
        - this.config.takerFees.coinbase
        - this.estimateWithdrawalFeePct(asset)
        - this.config.decayBufferPct;

      if (netSpreadPct >= this.config.minNetSpreadPct && (!best || netSpreadPct > best.netSpreadPct)) {
        best = { asset, binanceAsk: binanceQuote.ask, coinbaseBid: coinbaseQuote.bid, netSpreadPct };
      }
    }

    this.lastScanNote = best
      ? `Best candidate: ${best.asset} at ${(best.netSpreadPct * 100).toFixed(2)}% net`
      : `No candidate cleared ${(this.config.minNetSpreadPct * 100).toFixed(2)}% net this cycle`;

    if (!best) return;

    this.log(
      'info',
      `Opening transfer-arb position: ${best.asset} — buy Binance @ ${best.binanceAsk}, sell Coinbase @ ` +
      `${best.coinbaseBid} (net ${(best.netSpreadPct * 100).toFixed(2)}% after fees, estimated withdrawal cost, ` +
      `and decay buffer)`
    );

    await this.openPosition(best.asset, best.netSpreadPct);
  }

  /**
   * Executes the buy + withdraw legs for one new position. Every failure path marks
   * a clear terminal/review status rather than retrying blindly — see the status
   * enum comment in RealTransferArbPosition.js.
   */
  async openPosition(asset, spreadAtDecisionPct) {
    const network = ASSET_NETWORKS[asset];

    const position = await positionStore.createPosition({
      agentId: this.id,
      asset,
      status: 'buying',
      perTradeUsd: this.config.perTradeUsd,
      spreadAtDecisionPct
    });

    let buyTrade;
    try {
      buyTrade = await realTradingService.placeMarketBuyOrder({
        symbol: `${asset}USDT`,
        quoteOrderQtyUsd: this.config.perTradeUsd,
        agentId: this.id
      });
    } catch (error) {
      position.status = 'failed';
      position.note = `Binance buy failed: ${error.message}`;
      await position.save();
      this.log('error', `Buy failed for ${asset}:`, error.message);
      return;
    }

    if (buyTrade.status !== 'filled') {
      position.status = 'failed';
      position.note = `Binance buy did not fill (status=${buyTrade.status})`;
      await position.save();
      this.log('warn', `Buy for ${asset} did not fill (status=${buyTrade.status})`);
      return;
    }

    position.binanceBuyOrderId = buyTrade.binanceOrderId;
    position.buyQty = buyTrade.filledQty;
    position.buyFillPriceUsd = buyTrade.fillPrice;
    position.status = 'withdrawing';
    await position.save();

    let baselineBalance, depositAddress;
    try {
      baselineBalance = await coinbaseTradingService.getAssetBalance(asset);
      depositAddress = await coinbaseTradingService.getOrCreateDepositAddress(asset);
    } catch (error) {
      position.status = 'stranded_after_buy';
      position.note = `Bought ${position.buyQty} ${asset} on Binance (order ${position.binanceBuyOrderId}) but ` +
        `could not get a Coinbase deposit address: ${error.message}. Funds remain on Binance, NOT lost — resolve manually.`;
      await position.save();
      this.log('error', `CRITICAL: bought ${asset} but Coinbase deposit-address lookup failed:`, position.note);
      return;
    }

    const withdrawAmount = position.buyQty;
    let withdrawResult;
    try {
      withdrawResult = await realTradingService.withdraw({
        asset,
        amount: withdrawAmount,
        address: depositAddress.address,
        network,
        agentId: this.id
      });
    } catch (error) {
      position.status = 'stranded_after_buy';
      position.note = `Bought ${position.buyQty} ${asset} on Binance (order ${position.binanceBuyOrderId}) but the ` +
        `withdrawal call failed: ${error.message}. Funds remain on Binance, NOT lost — resolve manually.`;
      await position.save();
      this.log('error', `CRITICAL: bought ${asset} but withdrawal failed:`, position.note);
      return;
    }

    position.binanceWithdrawId = withdrawResult.binanceWithdrawId;
    position.withdrawAmount = withdrawAmount;
    position.withdrawAddress = depositAddress.address;
    position.withdrawNetwork = network;
    position.withdrawnAt = new Date();
    position.depositBaselineBalance = baselineBalance;
    position.status = 'awaiting_deposit';
    await position.save();

    this.log(
      'info',
      `Withdrew ${withdrawAmount} ${asset} from Binance to Coinbase (network ${network}, withdraw ID ` +
      `${withdrawResult.binanceWithdrawId}) — awaiting deposit confirmation, checked every scan cycle`
    );
  }

  /**
   * Extended status including open/review/stranded positions and recent closed
   * ones with realized P&L, for the dashboard.
   * @returns {Promise<Object>}
   */
  async getStatusExtended() {
    const { pending, needsReview, stranded, recentClosed } = await positionStore.getStatusSummary(this.id);

    const totalRealizedPnlUsd = recentClosed.reduce((sum, p) => sum + (p.realizedPnlUsd || 0), 0);

    return {
      ...this.getStatus(),
      real: {
        eligibleAssets: Object.keys(ASSET_NETWORKS),
        pendingPositions: pending,
        needsManualReview: needsReview,
        strandedPositions: stranded,
        recentClosed,
        recentRealizedPnlUsd: totalRealizedPnlUsd,
        lastScanAt: this.lastScanAt,
        lastScanNote: this.lastScanNote,
        note: 'REAL MONEY, transfer-based (buy Binance, withdraw, sell Coinbase). See class header for the acknowledged transfer-timing risk.'
      }
    };
  }

  async cleanup() {
    this.log(
      'info',
      'Cleaning up transfer-arbitrage agent (no auto-liquidation performed; any position mid-flight — bought, ' +
      'withdrawing, awaiting deposit, or flagged for review — remains exactly as-is and resumes being checked next start)'
    );
  }
}

module.exports = CrossExchangeTransferArbitrageAgent;

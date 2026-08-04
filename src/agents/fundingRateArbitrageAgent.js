// REAL MONEY agent: funding-rate arbitrage. Market-neutral by design — unlike every
// other trading agent in this codebase, this does NOT bet on price direction. It holds
// TWO simultaneous legs per symbol: long spot + short the USDT-M perpetual, sized to
// the same notional. Price moves cancel between the two legs (spot gains what the
// short loses, and vice versa); the actual return is the funding rate itself, paid by
// long perpetual holders to short holders every 8h whenever lastFundingRate > 0.
//
// This only implements the positive-funding case (short perp + long spot). The
// negative-funding case (long perp + short spot) would require borrowing/margin-
// shorting the spot asset, a meaningfully different risk (borrow costs, liquidation on
// the spot loan) that this agent deliberately does not take on.
//
// Safety properties (do not remove without updating the plan/tests):
// - Never calls walletService.addEarnings — zero interaction with the fabricated
//   in-app "earnings" currency.
// - Both legs go through their own independently-gated services (realTradingService
//   for spot, realFuturesTradingService for futures) — each still requires
//   LIVE_TRADING_CONFIRMED=true (and futures additionally LIVE_FUTURES_TRADING_CONFIRMED=true).
// - NO stop-loss/take-profit on the futures leg — this is intentional. A stop-loss
//   firing on the short would break the hedge and leave naked spot exposure; the
//   position's actual risk control is closing BOTH legs together when funding turns
//   unfavorable, not a price-based stop.
// - If either leg of an open/close fails after the other already succeeded, the
//   position is marked 'unhedged' in the ledger with a clear note rather than silently
//   left inconsistent — this is a real, visible state a human needs to review and
//   manually resolve, not something this agent tries to cleverly auto-correct.
// - At most one open pair per symbol at a time (checked against the ledger, not memory).
const BaseAgent = require('./baseAgent');
const realTradingService = require('../services/realTradingService');
const realFuturesTradingService = require('../services/realFuturesTradingService');

let RealFundingArbPosition;
function getPositionModel() {
  if (!RealFundingArbPosition) {
    RealFundingArbPosition = require('../models/RealFundingArbPosition');
  }
  return RealFundingArbPosition;
}

class FundingRateArbitrageAgent extends BaseAgent {
  constructor(options = {}) {
    super({
      ...options,
      type: 'fundingRateArbitrage',
      config: {
        perTradeNotionalUsd: options.config?.perTradeNotionalUsd != null ? options.config.perTradeNotionalUsd : 20,
        // Low by design: leverage on the short leg only reduces margin USED, not the
        // notional itself (which must match the spot leg exactly to stay hedged) — high
        // leverage here would only add unnecessary liquidation risk to one leg of an
        // otherwise price-neutral position, for zero benefit.
        futuresLeverage: options.config?.futuresLeverage || 3,
        marginMode: options.config?.marginMode || 'ISOLATED',
        // Funding is paid every 8h; a rate below this isn't worth the two-leg
        // transaction cost (spot taker fee + futures taker fee, paid twice — once to
        // open, once to close).
        minFundingRateToEnter: options.config?.minFundingRateToEnter != null ? options.config.minFundingRateToEnter : 0.0003,
        minFundingRateToExit: options.config?.minFundingRateToExit != null ? options.config.minFundingRateToExit : 0.0001,
        minQuoteVolumeUsd: options.config?.minQuoteVolumeUsd || 5000000,
        maxCandidatesPerCycle: options.config?.maxCandidatesPerCycle || Infinity,
        scanIntervalMs: options.config?.scanIntervalMs || 1800000, // 30 minutes — funding doesn't move fast
        ...options.config
      }
    });

    this.haltedReason = null;
    this.lastScanCandidates = [];
  }

  async run() {
    this.log(
      'info',
      `Starting funding-rate arbitrage scanner: $${this.config.perTradeNotionalUsd} notional/pair, ` +
      `${this.config.futuresLeverage}x on the short leg only, enter above ${(this.config.minFundingRateToEnter * 100).toFixed(3)}% ` +
      `funding, exit below ${(this.config.minFundingRateToExit * 100).toFixed(3)}%`
    );

    if (this.isRunning) {
      await new Promise(resolve => setTimeout(resolve, Math.random() * 60000));
    }

    while (this.isRunning) {
      try {
        await this.scanCycle();
      } catch (error) {
        this.log('error', 'Error in funding-rate arbitrage cycle:', error.message);
        this.state = 'error';
      }

      if (this.isRunning) {
        const jitterMs = Math.random() * 0.1 * this.config.scanIntervalMs;
        await new Promise(resolve => setTimeout(resolve, this.config.scanIntervalMs + jitterMs));
      }
    }
  }

  async scanCycle() {
    if (this.haltedReason) {
      this.state = 'resting';
      return;
    }

    this.state = 'active';

    const Model = getPositionModel();
    const openPositions = await Model.find({ agentId: this.id, status: 'open' });
    const openSymbols = new Set(openPositions.map(p => p.symbol));

    // Exit pass first — free up capital before considering new entries.
    for (const position of openPositions) {
      try {
        const funding = await realFuturesTradingService.getFundingRate(position.symbol);
        if (funding.lastFundingRate < this.config.minFundingRateToExit) {
          await this.closePair(position, funding.lastFundingRate);
        }
      } catch (error) {
        this.log('error', `Error checking/closing ${position.symbol} position:`, error.message);
      }
    }

    // Entry pass — only symbols without an already-open pair.
    const [tickers, perpetualSymbols] = await Promise.all([
      realFuturesTradingService.getAll24hrTickers(),
      realFuturesTradingService.getUsdtPerpetualSymbols()
    ]);
    const perpetualSet = new Set(perpetualSymbols);

    const eligible = tickers.filter(t =>
      perpetualSet.has(t.symbol) &&
      !openSymbols.has(t.symbol) &&
      t.quoteVolume >= this.config.minQuoteVolumeUsd
    );

    const candidates = [];
    for (const ticker of eligible) {
      // Paced, same reasoning as meanReversionFuturesAgent's klines loop — this can
      // cover hundreds of symbols and a tight sequential burst risks an IP ban.
      await new Promise(resolve => setTimeout(resolve, 150));
      try {
        const funding = await realFuturesTradingService.getFundingRate(ticker.symbol);
        if (funding.lastFundingRate >= this.config.minFundingRateToEnter) {
          candidates.push({ symbol: ticker.symbol, fundingRate: funding.lastFundingRate });
        }
      } catch (error) {
        this.log('warn', `Failed to check funding rate for ${ticker.symbol}:`, error.message);
      }
    }

    candidates.sort((a, b) => b.fundingRate - a.fundingRate);
    this.lastScanCandidates = candidates.slice(0, 10);
    this.log('info', `Found ${candidates.length} funding-rate candidate(s) above ${(this.config.minFundingRateToEnter * 100).toFixed(3)}%`);

    for (const candidate of candidates.slice(0, this.config.maxCandidatesPerCycle)) {
      try {
        await this.openPair(candidate.symbol, candidate.fundingRate);
      } catch (error) {
        this.log('error', `Failed to open funding-arb pair for ${candidate.symbol}:`, error.message);
      }
    }

    if (openPositions.length === 0 && candidates.length === 0) {
      this.state = 'idle';
    }
  }

  /**
   * Opens one hedged pair: spot BUY then futures SHORT of matching notional. If the
   * futures leg fails after the spot leg already filled, immediately sells the spot
   * back rather than leaving naked directional exposure — and if THAT also fails,
   * records the position as 'unhedged' rather than silently losing track of it.
   * @param {string} symbol
   * @param {number} fundingRate
   */
  async openPair(symbol, fundingRate) {
    const Model = getPositionModel();
    const notionalUsd = this.config.perTradeNotionalUsd;

    const spotTrade = await realTradingService.placeMarketBuyOrder({
      symbol,
      quoteOrderQtyUsd: notionalUsd,
      agentId: this.id
    });

    if (spotTrade.status !== 'filled') {
      this.log('warn', `Spot leg for ${symbol} did not fill (status=${spotTrade.status}) — skipping futures leg`);
      return;
    }

    let futuresTrade;
    try {
      futuresTrade = await realFuturesTradingService.openLeveragedShort({
        symbol,
        marginUsd: notionalUsd / this.config.futuresLeverage,
        leverage: this.config.futuresLeverage,
        marginMode: this.config.marginMode,
        // Deliberately no stopLossPct/takeProfitPct — see class comment.
        agentId: this.id
      });
    } catch (error) {
      // The spot leg filled but the futures leg didn't — unwind immediately rather
      // than carry naked directional spot exposure that was never the intent.
      this.log('error', `Futures short leg for ${symbol} failed after spot filled — unwinding spot:`, error.message);
      try {
        await realTradingService.placeMarketSellOrder({ symbol, quantity: spotTrade.filledQty, agentId: this.id });
        this.log('info', `Successfully unwound spot leg for ${symbol} after futures leg failure`);
        return;
      } catch (unwindError) {
        await Model.create({
          agentId: this.id,
          symbol,
          status: 'unhedged',
          notionalUsd,
          spotQty: spotTrade.filledQty,
          spotEntryOrderId: spotTrade.binanceOrderId,
          fundingRateAtOpen: fundingRate,
          note: `Futures leg failed (${error.message}) AND spot unwind failed (${unwindError.message}) — ` +
            `naked spot exposure of ${spotTrade.filledQty} ${symbol} remains. Requires manual review.`
        });
        this.log('error', `CRITICAL: could not unwind spot leg for ${symbol} either — naked exposure recorded as 'unhedged', needs manual review:`, unwindError.message);
        return;
      }
    }

    if (futuresTrade.status !== 'filled') {
      this.log('warn', `Futures short leg for ${symbol} did not fill (status=${futuresTrade.status}) — unwinding spot`);
      try {
        await realTradingService.placeMarketSellOrder({ symbol, quantity: spotTrade.filledQty, agentId: this.id });
      } catch (unwindError) {
        await Model.create({
          agentId: this.id,
          symbol,
          status: 'unhedged',
          notionalUsd,
          spotQty: spotTrade.filledQty,
          spotEntryOrderId: spotTrade.binanceOrderId,
          futuresEntryOrderId: futuresTrade.binanceOrderId,
          fundingRateAtOpen: fundingRate,
          note: `Futures leg didn't fill and spot unwind failed (${unwindError.message}) — needs manual review.`
        });
      }
      return;
    }

    await Model.create({
      agentId: this.id,
      symbol,
      status: 'open',
      notionalUsd,
      spotQty: spotTrade.filledQty,
      spotEntryOrderId: spotTrade.binanceOrderId,
      futuresEntryOrderId: futuresTrade.binanceOrderId,
      fundingRateAtOpen: fundingRate
    });

    this.updatePerformance({ actionsTaken: this.performance.actionsTaken + 1 });
    this.log(
      'info',
      `Opened funding-arb pair on ${symbol}: $${notionalUsd} notional, spot qty ${spotTrade.filledQty}, ` +
      `funding rate ${(fundingRate * 100).toFixed(4)}%`
    );
  }

  /**
   * Closes both legs of a hedged pair. If the futures leg closes but the spot sell
   * fails, the position is marked 'unhedged' — it's momentarily long spot with no
   * hedge, a state that needs a human to actually go sell that spot balance.
   * @param {Object} position Mongoose RealFundingArbPosition document
   * @param {number} currentFundingRate
   */
  async closePair(position, currentFundingRate) {
    const closeResult = await realFuturesTradingService.closePosition(position.symbol, this.id);

    try {
      const sellResult = await realTradingService.placeMarketSellOrder({
        symbol: position.symbol,
        quantity: position.spotQty,
        agentId: this.id
      });

      position.status = 'closed';
      position.closedAt = new Date();
      position.futuresExitOrderId = closeResult.closeTrade?.binanceOrderId;
      position.spotExitOrderId = sellResult.binanceOrderId;
      await position.save();

      this.log(
        'info',
        `Closed funding-arb pair on ${position.symbol} (funding rate dropped to ${(currentFundingRate * 100).toFixed(4)}%)`
      );
    } catch (error) {
      position.status = 'unhedged';
      position.futuresExitOrderId = closeResult.closeTrade?.binanceOrderId;
      position.note = `Futures leg closed but spot sell failed (${error.message}) — ` +
        `${position.spotQty} ${position.symbol} remains unsold with no hedge. Requires manual review.`;
      await position.save();
      this.log('error', `CRITICAL: closed futures leg for ${position.symbol} but spot sell failed — marked 'unhedged', needs manual review:`, error.message);
    }
  }

  /**
   * Extended status including open/unhedged positions, for the dashboard.
   * @returns {Promise<Object>}
   */
  async getStatusExtended() {
    const Model = getPositionModel();
    const [openPositions, unhedgedPositions, recentClosed] = await Promise.all([
      Model.find({ agentId: this.id, status: 'open' }).lean(),
      Model.find({ agentId: this.id, status: 'unhedged' }).lean(),
      Model.find({ agentId: this.id, status: 'closed' }).sort({ closedAt: -1 }).limit(10).lean()
    ]);

    return {
      ...this.getStatus(),
      real: {
        openPositions,
        unhedgedPositions,
        recentClosed,
        halted: !!this.haltedReason,
        haltedReason: this.haltedReason,
        lastScanCandidates: this.lastScanCandidates
      }
    };
  }

  async cleanup() {
    this.log(
      'info',
      'Cleaning up funding-rate arbitrage agent (no auto-close performed; any open hedged pairs remain live on the account)'
    );
  }
}

module.exports = FundingRateArbitrageAgent;

// REAL MONEY agent: grid trading on a single SPOT symbol. Divides a price range into
// evenly-spaced levels; buys a fixed USD amount whenever price is at or below a level
// with no existing position there, and sells that position once price rises to the
// level above it — repeating for as long as price oscillates within the range. Third
// distinct risk profile in this codebase (after directional leveraged momentum/
// reversion and market-neutral funding arbitrage): profits from RANGE-BOUND
// sideways price action, specifically loses ground if price trends strongly in either
// direction outside the grid (buys accumulate near the bottom with no sells if price
// keeps falling; nothing left to buy near the top if price keeps rising).
//
// Deliberately simplified from a "real" grid bot: a real grid bot rests actual LIMIT
// orders on the book at every level, filled instantly and passively by the exchange
// matching engine. This agent instead polls price periodically and reacts with MARKET
// orders — simpler to build on this codebase's existing polling architecture, but
// slower to react (a fast intra-cycle round trip through a level is missed entirely)
// and pays taker fees instead of maker rebates/lower maker fees. Spot only (no
// leverage) — a grid needs no leverage to work, and spot avoids liquidation risk
// entirely on a strategy that's already making a directional-drift assumption (that
// price stays range-bound).
//
// Safety properties (do not remove without updating the plan/tests):
// - Never calls walletService.addEarnings — zero interaction with the fabricated
//   in-app "earnings" currency.
// - Every order goes through realTradingService, which independently requires
//   LIVE_TRADING_CONFIRMED=true and real (non-placeholder) Binance credentials.
// - The grid range (lowerPrice/upperPrice) is computed ONCE at first run (from recent
//   historical high/low with padding) and then held fixed for the agent's lifetime —
//   never silently recalculated, which would orphan open positions tracked against
//   the old range. A human must reconfigure it deliberately to change it.
// - Price outside the configured range is a deliberate no-op (skip the cycle), not an
//   attempt to extend the grid or chase price.
const BaseAgent = require('./baseAgent');
const realTradingService = require('../services/realTradingService');
const realFuturesTradingService = require('../services/realFuturesTradingService');

let RealGridPosition;
function getPositionModel() {
  if (!RealGridPosition) {
    RealGridPosition = require('../models/RealGridPosition');
  }
  return RealGridPosition;
}

class GridTradingAgent extends BaseAgent {
  constructor(options = {}) {
    super({
      ...options,
      type: 'gridTrading',
      config: {
        symbol: options.config?.symbol || 'BTCUSDT',
        gridLevels: options.config?.gridLevels || 10,
        perLevelUsd: options.config?.perLevelUsd != null ? options.config.perLevelUsd : 5,
        // null until computed on first run — see class comment on why this is fixed
        // once set, not recalculated every cycle.
        lowerPrice: options.config?.lowerPrice != null ? options.config.lowerPrice : null,
        upperPrice: options.config?.upperPrice != null ? options.config.upperPrice : null,
        boundsLookbackDays: options.config?.boundsLookbackDays || 90,
        boundsPaddingPct: options.config?.boundsPaddingPct != null ? options.config.boundsPaddingPct : 0.05,
        scanIntervalMs: options.config?.scanIntervalMs || 300000, // 5 minutes
        ...options.config
      }
    });

    this.haltedReason = null;
  }

  async run() {
    if (this.config.lowerPrice == null || this.config.upperPrice == null) {
      await this.computeInitialBounds();
    }

    this.log(
      'info',
      `Starting grid trading agent for ${this.config.symbol}: ${this.config.gridLevels} levels between ` +
      `$${this.config.lowerPrice.toFixed(2)} and $${this.config.upperPrice.toFixed(2)}, $${this.config.perLevelUsd}/level`
    );

    if (this.isRunning) {
      await new Promise(resolve => setTimeout(resolve, Math.random() * 60000));
    }

    while (this.isRunning) {
      try {
        await this.gridCycle();
      } catch (error) {
        this.log('error', 'Error in grid trading cycle:', error.message);
        this.state = 'error';
      }

      if (this.isRunning) {
        const jitterMs = Math.random() * 0.1 * this.config.scanIntervalMs;
        await new Promise(resolve => setTimeout(resolve, this.config.scanIntervalMs + jitterMs));
      }
    }
  }

  /**
   * Derives lowerPrice/upperPrice from recent historical high/low (with padding) if
   * they weren't explicitly configured. Uses futures klines purely as a volatility/
   * range reference — spot and perpetual prices for the same symbol track closely
   * enough that this is a reasonable proxy, and it avoids needing a separate spot
   * klines endpoint just to size a range.
   */
  async computeInitialBounds() {
    const klines = await realFuturesTradingService.getKlines(this.config.symbol, '1d', this.config.boundsLookbackDays);
    const low = Math.min(...klines.map(k => k.low));
    const high = Math.max(...klines.map(k => k.high));
    this.config.lowerPrice = low * (1 - this.config.boundsPaddingPct);
    this.config.upperPrice = high * (1 + this.config.boundsPaddingPct);
    this.log(
      'info',
      `Auto-computed grid range for ${this.config.symbol} from ${this.config.boundsLookbackDays}d history: ` +
      `$${this.config.lowerPrice.toFixed(2)} - $${this.config.upperPrice.toFixed(2)} (${(this.config.boundsPaddingPct * 100).toFixed(0)}% padding)`
    );
  }

  /**
   * Grid line prices, gridLevels+1 of them, evenly spaced between lowerPrice and
   * upperPrice. Level i's buy zone is gridLines[i]; selling a position opened at
   * level i happens when price reaches gridLines[i+1].
   * @returns {number[]}
   */
  gridLines() {
    const { lowerPrice, upperPrice, gridLevels } = this.config;
    const step = (upperPrice - lowerPrice) / gridLevels;
    return Array.from({ length: gridLevels + 1 }, (_, i) => lowerPrice + i * step);
  }

  async gridCycle() {
    if (this.haltedReason) {
      this.state = 'resting';
      return;
    }

    const currentPrice = await realTradingService.getCurrentPrice(this.config.symbol);

    if (currentPrice < this.config.lowerPrice || currentPrice > this.config.upperPrice) {
      this.log('warn', `Price $${currentPrice} is outside grid range [$${this.config.lowerPrice.toFixed(2)}, $${this.config.upperPrice.toFixed(2)}] — skipping cycle`);
      this.state = 'idle';
      return;
    }

    this.state = 'active';

    const lines = this.gridLines();
    const Model = getPositionModel();
    const openPositions = await Model.find({ agentId: this.id, symbol: this.config.symbol, status: 'open' });
    const openByLevel = new Map(openPositions.map(p => [p.levelIndex, p]));

    let actionsThisCycle = 0;

    // Sell pass: any open position whose level-above line has been reached.
    for (const position of openPositions) {
      const sellLine = lines[position.levelIndex + 1];
      if (currentPrice >= sellLine) {
        try {
          const sellTrade = await realTradingService.placeMarketSellOrder({
            symbol: this.config.symbol,
            quantity: position.qty,
            agentId: this.id
          });
          position.status = 'closed';
          position.sellOrderId = sellTrade.binanceOrderId;
          position.sellPrice = sellTrade.fillPrice;
          position.closedAt = new Date();
          await position.save();
          actionsThisCycle++;
          this.log(
            'info',
            `Grid sell: level ${position.levelIndex} of ${this.config.symbol}, ` +
            `bought @ $${position.buyPrice.toFixed(2)}, sold @ $${sellTrade.fillPrice.toFixed(2)}`
          );
        } catch (error) {
          this.log('error', `Failed to sell grid position at level ${position.levelIndex}:`, error.message);
        }
      }
    }

    // Buy pass: any level at or above the current price with no open position there.
    for (let i = 0; i < this.config.gridLevels; i++) {
      if (currentPrice <= lines[i] && !openByLevel.has(i)) {
        try {
          const buyTrade = await realTradingService.placeMarketBuyOrder({
            symbol: this.config.symbol,
            quoteOrderQtyUsd: this.config.perLevelUsd,
            agentId: this.id
          });
          if (buyTrade.status === 'filled') {
            await Model.create({
              agentId: this.id,
              symbol: this.config.symbol,
              levelIndex: i,
              status: 'open',
              buyPrice: buyTrade.fillPrice,
              qty: buyTrade.filledQty,
              buyOrderId: buyTrade.binanceOrderId
            });
            actionsThisCycle++;
            this.log('info', `Grid buy: level ${i} of ${this.config.symbol} @ $${buyTrade.fillPrice.toFixed(2)}`);
          }
        } catch (error) {
          this.log('error', `Failed to buy grid position at level ${i}:`, error.message);
        }
      }
    }

    if (actionsThisCycle > 0) {
      this.updatePerformance({ actionsTaken: this.performance.actionsTaken + actionsThisCycle });
    } else {
      this.state = 'idle';
    }
  }

  /**
   * Extended status including current grid range and open positions, for the dashboard.
   * @returns {Promise<Object>}
   */
  async getStatusExtended() {
    const Model = getPositionModel();
    const [openPositions, recentClosed, currentPrice] = await Promise.all([
      Model.find({ agentId: this.id, symbol: this.config.symbol, status: 'open' }).lean(),
      Model.find({ agentId: this.id, symbol: this.config.symbol, status: 'closed' }).sort({ closedAt: -1 }).limit(10).lean(),
      realTradingService.getCurrentPrice(this.config.symbol).catch(() => null)
    ]);

    const realizedProfitUsd = recentClosed.reduce((sum, p) => sum + (p.sellPrice - p.buyPrice) * p.qty, 0);

    return {
      ...this.getStatus(),
      real: {
        symbol: this.config.symbol,
        lowerPrice: this.config.lowerPrice,
        upperPrice: this.config.upperPrice,
        gridLevels: this.config.gridLevels,
        currentPrice,
        openPositionsCount: openPositions.length,
        openPositions,
        recentClosed,
        realizedProfitUsd,
        halted: !!this.haltedReason,
        haltedReason: this.haltedReason
      }
    };
  }

  async cleanup() {
    this.log(
      'info',
      'Cleaning up grid trading agent (no auto-sell performed; any open grid positions remain live in the account)'
    );
  }
}

module.exports = GridTradingAgent;

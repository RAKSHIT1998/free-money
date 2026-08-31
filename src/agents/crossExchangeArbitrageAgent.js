// Real, read-only, HIGH-FREQUENCY cross-exchange spot arbitrage SCANNER: streams
// live bid/ask ticks over WebSocket from Binance, Coinbase, and Kraken (see
// crossExchangeMarketDataService.js — no API keys, no orders) and surfaces genuine
// spreads between exchanges, net of estimated taker fees on both legs, for a human
// to review and act on.
//
// "High-frequency" here means the DATA layer: a persistent WebSocket subscription
// per exchange pushes a fresh quote every 60-100ms on a liquid pair (measured
// against live Binance data), not the old 60-second REST poll this replaced. A scan
// cycle just reads that already-fresh in-memory cache, so scanIntervalMs can be
// turned down to a couple of seconds (or lower) without adding any network load —
// see crossExchangeMarketDataService.js's header for exactly how that's built.
//
// The tradeable asset list isn't hardcoded — it's a dynamic, volume-ranked,
// spread-filtered pairlist rebuilt periodically (freqtrade's VolumePairList +
// SpreadFilter pattern; see crossExchangeMarketDataService.js's header for details),
// so this scanner naturally follows liquidity instead of a list someone forgot to
// update.
//
// This deliberately does NOT place any real orders, unlike this codebase's other
// REAL MONEY agents. Two reasons, both structural rather than a missing feature:
// 1. This codebase's only live-trading infrastructure (realTradingService /
//    realFuturesTradingService) talks exclusively to Binance. Executing the other
//    leg on Coinbase or Kraken would need separate API credentials, order-placement
//    services, and balance tracking for each — none of which exist here.
// 2. Even with that infrastructure, "buy low on A, sell high on B" isn't atomic
//    across exchanges the way it is across two legs of one Binance account (see
//    fundingRateArbitrageAgent.js). The base asset has to already be sitting on the
//    higher-priced exchange before you sell it there — an on-chain or exchange
//    transfer from A to B takes anywhere from minutes to hours, and the spread this
//    agent measures at scan time is very likely gone (or reversed) by the time a
//    transfer would land. Real cross-exchange arbitrage desks handle this by
//    maintaining standing inventory of the SAME asset pre-funded on every exchange
//    and trading against local balance on each side, rebalancing between exchanges
//    separately later — a deliberate capital-allocation decision this agent isn't
//    positioned to make on a human's behalf. netSpreadPct below assumes that
//    pre-funded model (i.e., no transfer-in-the-loop); it is NOT achievable by
//    buying on A and immediately walking the same coins over to B.
//
// Safety properties (do not remove without updating the plan/tests):
// - GET requests only, to public/unauthenticated endpoints. No account access, no
//   orders, no withdrawals, no wallet interaction of any kind.
// - Never calls walletService.addEarnings — zero interaction with the fabricated
//   in-app "earnings" currency, and zero claim to real earnings since nothing here
//   is actually traded.
const BaseAgent = require('./baseAgent');
const marketDataService = require('../services/crossExchangeMarketDataService');

class CrossExchangeArbitrageAgent extends BaseAgent {
  constructor(options = {}) {
    super({
      ...options,
      type: 'crossExchangeArbitrage',
      config: {
        // Net of both legs' estimated taker fees. Below this, the "opportunity" is
        // more likely to be fee/latency noise than a real, actionable spread.
        minNetSpreadPct: options.config?.minNetSpreadPct != null ? options.config.minNetSpreadPct : 0.003, // 0.30%
        maxCandidatesTracked: options.config?.maxCandidatesTracked || 10,
        // Quotes come from an always-current WebSocket cache (see run()), so this is
        // purely "how often to re-check for a crossed spread" — not a network-fetch
        // interval. 2s by default; safe to turn down further (e.g. a few hundred ms)
        // since a scan is just reading memory, not making a request.
        scanIntervalMs: options.config?.scanIntervalMs || 2000,
        // A quote older than this is treated as missing rather than trusted — guards
        // against a silently-dropped WebSocket still reporting a last-known price
        // that's no longer real.
        staleQuoteMs: options.config?.staleQuoteMs || 15000,
        takerFees: { ...marketDataService.DEFAULT_TAKER_FEES, ...(options.config?.takerFees || {}) },
        // Pairlist generation (freqtrade VolumePairList/SpreadFilter equivalents —
        // see crossExchangeMarketDataService.js). numberAssets/minQuoteVolumeUsd
        // control breadth vs. liquidity floor; maxSpreadRatio rejects thin quotes
        // before they're ever compared across exchanges; pairlistRefreshMs is how
        // often the ranked asset list itself is recomputed via REST (live quotes for
        // whatever's currently on the list still stream continuously regardless).
        numberAssets: options.config?.numberAssets || 15,
        minQuoteVolumeUsd: options.config?.minQuoteVolumeUsd || 2000000,
        maxSpreadRatio: options.config?.maxSpreadRatio != null ? options.config.maxSpreadRatio : 0.005,
        pairlistRefreshMs: options.config?.pairlistRefreshMs || 1800000,
        ...options.config
      }
    });

    this.lastScanAt = null;
    this.lastScanCandidates = [];
    this.lastScanErrors = [];
  }

  async run() {
    this.log(
      'info',
      `Starting cross-exchange arbitrage scanner (read-only, WebSocket-streamed): top ${this.config.numberAssets} ` +
      `by volume across Binance/Coinbase/Kraken (min $${this.config.minQuoteVolumeUsd.toLocaleString()} combined ` +
      `24h volume, max ${(this.config.maxSpreadRatio * 100).toFixed(2)}% same-exchange spread), checking every ` +
      `${this.config.scanIntervalMs}ms for a net spread above ${(this.config.minNetSpreadPct * 100).toFixed(2)}% ` +
      `after estimated fees`
    );

    // Starts (if not already running) the three background WebSocket loops that
    // keep crossExchangeMarketDataService's live quote cache current. Passing a
    // live getter (not a snapshot) means the streams automatically follow the
    // pairlist as it's refreshed below, with no explicit restart needed.
    marketDataService.startStreaming(() => marketDataService.getCachedPairlistAssets());

    while (this.isRunning) {
      try {
        await this.scanCycle();
      } catch (error) {
        this.log('error', 'Error in cross-exchange arbitrage scan:', error.message);
        this.state = 'error';
      }

      if (this.isRunning) {
        await new Promise(resolve => setTimeout(resolve, this.config.scanIntervalMs));
      }
    }
  }

  async scanCycle() {
    this.state = 'active';

    // Cheap no-op most cycles — only does real REST work once every
    // pairlistRefreshMs (default 30 min). The WebSocket streams (started in run())
    // pick up whatever this returns via the live getter passed to startStreaming.
    await marketDataService.getPairlist(
      {
        numberAssets: this.config.numberAssets,
        minQuoteVolumeUsd: this.config.minQuoteVolumeUsd,
        maxSpreadRatio: this.config.maxSpreadRatio
      },
      this.config.pairlistRefreshMs
    );

    const watchedAssets = marketDataService.getCachedPairlistAssets();
    const perAssetResults = marketDataService.getLiveQuotes(watchedAssets, {
      maxSpreadRatio: this.config.maxSpreadRatio,
      staleMs: this.config.staleQuoteMs
    });

    const candidates = [];
    const errors = [];
    for (const { asset, quotes, errors: assetErrors } of perAssetResults) {
      errors.push(...assetErrors);
      candidates.push(...this.findSpreadsForAsset(asset, quotes));
    }

    candidates.sort((a, b) => b.netSpreadPct - a.netSpreadPct);

    this.lastScanAt = new Date();
    this.lastScanCandidates = candidates.slice(0, this.config.maxCandidatesTracked);
    this.lastScanErrors = errors.slice(0, 10);

    this.updatePerformance({
      actionsTaken: this.performance.actionsTaken + 1,
      opportunitiesFound: this.performance.opportunitiesFound + candidates.length
    });

    if (candidates.length > 0) {
      const top = candidates[0];
      this.log(
        'info',
        `Found ${candidates.length} candidate spread(s) above threshold. Best: ${top.asset} — ` +
        `buy on ${top.buyExchange} @ ${top.buyAsk}, sell on ${top.sellExchange} @ ${top.sellBid} ` +
        `(net ${(top.netSpreadPct * 100).toFixed(3)}% after fees)`
      );
    } else {
      this.log('info', `No candidate spreads above ${(this.config.minNetSpreadPct * 100).toFixed(2)}% net threshold this cycle`);
      this.state = 'idle';
    }
  }

  /**
   * Compares every exchange pair for one asset and returns every direction whose
   * net-of-fees spread clears the configured threshold. A "crossed" market — the
   * cheap exchange's ask below the expensive exchange's bid — is required; a
   * positive gross spread that doesn't survive both legs' taker fees is skipped.
   * @param {string} asset
   * @param {Array<{exchange: string, bid: number, ask: number}>} quotes
   * @returns {Array<Object>}
   */
  findSpreadsForAsset(asset, quotes) {
    const found = [];
    for (const buyVenue of quotes) {
      for (const sellVenue of quotes) {
        if (buyVenue.exchange === sellVenue.exchange) continue;
        if (sellVenue.bid <= buyVenue.ask) continue; // not crossed — no gross spread to begin with

        const grossSpreadPct = (sellVenue.bid - buyVenue.ask) / buyVenue.ask;
        const buyFee = this.config.takerFees[buyVenue.exchange] || 0;
        const sellFee = this.config.takerFees[sellVenue.exchange] || 0;
        const netSpreadPct = grossSpreadPct - buyFee - sellFee;

        if (netSpreadPct >= this.config.minNetSpreadPct) {
          found.push({
            asset,
            buyExchange: buyVenue.exchange,
            buyAsk: buyVenue.ask,
            sellExchange: sellVenue.exchange,
            sellBid: sellVenue.bid,
            grossSpreadPct,
            netSpreadPct,
            observedAt: new Date()
          });
        }
      }
    }
    return found;
  }

  /**
   * Extended status including the current candidate list, for the dashboard.
   * @returns {Object}
   */
  getStatusExtended() {
    return {
      ...this.getStatus(),
      scan: {
        lastScanAt: this.lastScanAt,
        pairlist: marketDataService.getCachedPairlistAssets(),
        streamHealth: marketDataService.getStreamHealth(),
        scanIntervalMs: this.config.scanIntervalMs,
        staleQuoteMs: this.config.staleQuoteMs,
        minNetSpreadPct: this.config.minNetSpreadPct,
        takerFees: this.config.takerFees,
        candidates: this.lastScanCandidates,
        errors: this.lastScanErrors,
        note: 'Read-only scanner, WebSocket-streamed quotes — no orders are placed. See class header for why cross-exchange execution isn\'t automated.'
      }
    };
  }

  async cleanup() {
    this.log('info', 'Cleaning up cross-exchange arbitrage scanner (no positions to close — read-only agent), closing WebSocket streams');
    await marketDataService.stopStreaming();
  }
}

module.exports = CrossExchangeArbitrageAgent;

// Read-only real "what's buzzing in crypto right now" feed — polls CoinGecko's
// public trending endpoint (confirmed live 2026-09-01: GET
// https://api.coingecko.com/api/v3/search/trending — no API key, no signup,
// genuinely free/public, one of the most established crypto data APIs in
// existence). NOT a literal Twitter/X tracker: X's API has required a paid
// developer plan since 2023 (their free tier doesn't support search/timeline reads
// at all) and this app doesn't have one configured — see the file this was
// requested alongside for the honest explanation given to the user instead of
// silently faking it. CoinGecko's trending score is itself driven heavily by
// search-volume/social-buzz signals, so this is a real, if indirect, stand-in:
// "what's spiking in attention right now," from a source that's actually
// verifiable and won't quietly break.
//
// Safety properties (same as every other discovery agent in this file's family):
// - GET requests only, no auth.
// - Never buys, never trades on this signal itself — surfaces it into the same
//   opportunity feed as the job/bounty/airdrop scanners for a human to review.
//   ("Trending" is a lagging, widely-watched signal; anyone acting on this list has
//   very little real edge over every other viewer of the same public data.)
const BaseAgent = require('./baseAgent');
const axios = require('axios');
const opportunityService = require('../services/opportunityService');

const COINGECKO_TRENDING_URL = 'https://api.coingecko.com/api/v3/search/trending';

class CryptoUpdatesTrackerAgent extends BaseAgent {
  constructor(options = {}) {
    super({
      ...options,
      type: 'cryptoUpdatesTracker',
      config: {
        // CoinGecko's public (keyless) tier is rate-limited (roughly ~30 calls/min
        // shared across all keyless callers worldwide) — polling far below that.
        pollIntervalMs: options.config?.pollIntervalMs || 1800000,
        maxResultsPerPoll: options.config?.maxResultsPerPoll || 15,
        ...options.config
      }
    });

    this.discoveryStats = {
      lastPollAt: null,
      newThisPoll: 0,
      alreadyKnownThisPoll: 0,
      totalNewAllTime: 0
    };
  }

  async run() {
    this.log('info', 'Starting real crypto trending feed (read-only, public CoinGecko data) — a buzz/attention signal, not trading advice');

    while (this.isRunning) {
      try {
        await this.pollAndSurface();
      } catch (error) {
        this.log('error', 'Error polling CoinGecko trending:', error.message);
        this.state = 'error';
      }

      if (this.isRunning) {
        await new Promise(resolve => setTimeout(resolve, this.config.pollIntervalMs));
      }
    }
  }

  async pollAndSurface() {
    this.state = 'active';
    const coins = await this.fetchTrendingCoins();

    let newCount = 0;
    let alreadyKnownCount = 0;
    for (const coin of coins.slice(0, this.config.maxResultsPerPoll)) {
      const saved = await opportunityService.addOpportunity(this.buildOpportunity(coin));
      if (saved.isNew) newCount++; else alreadyKnownCount++;
    }

    this.discoveryStats = {
      lastPollAt: new Date(),
      newThisPoll: newCount,
      alreadyKnownThisPoll: alreadyKnownCount,
      totalNewAllTime: this.discoveryStats.totalNewAllTime + newCount
    };

    this.updatePerformance({
      actionsTaken: this.performance.actionsTaken + 1,
      opportunitiesFound: this.performance.opportunitiesFound + newCount
    });
    this.log('info', `Polled CoinGecko trending: ${newCount} new listing(s), ${alreadyKnownCount} already known`);
  }

  getStatus() {
    return {
      ...super.getStatus(),
      discovery: { ...this.discoveryStats }
    };
  }

  /**
   * Real, public CoinGecko trending coins — no auth. Ranked by CoinGecko's own
   * trending algorithm (search volume, price action, recency), refreshed roughly
   * every few minutes on their side.
   * @returns {Promise<Array>}
   */
  async fetchTrendingCoins() {
    const { data } = await axios.get(COINGECKO_TRENDING_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; free-money-app opportunity discovery)' }
    });
    return Array.isArray(data?.coins) ? data.coins.map(c => c.item).filter(Boolean) : [];
  }

  buildOpportunity(coin) {
    const change24h = coin.data?.price_change_percentage_24h?.usd;
    const changeStr = typeof change24h === 'number' ? `${change24h >= 0 ? '+' : ''}${change24h.toFixed(1)}% (24h)` : '';
    // Stable, dedupable URL — CoinGecko doesn't give trending entries their own
    // permalink, so this re-surfaces the same coin's page each time it re-trends
    // (same "already known" dedup behavior as every other feed here).
    const url = `https://www.coingecko.com/en/coins/${coin.slug || coin.id}`;

    return {
      title: `Trending: ${coin.name} (${coin.symbol?.toUpperCase()})${changeStr ? ` — ${changeStr}` : ''}`,
      description:
        `Currently trending on CoinGecko (rank #${coin.market_cap_rank ?? 'unranked'} by market cap). ` +
        `This reflects search/attention volume, not a buy signal — trending lists are widely watched, ` +
        `so there is little edge in acting on this alone. Verify independently before any real trade.`,
      url,
      source: 'coingecko-trending-real',
      type: 'other',
      reward: coin.data?.market_cap || 'See listing',
      requirements: [
        'Do your own research before trading on a trending signal',
        'Trending = high attention, not confirmed fundamentals'
      ],
      tags: ['coingecko', 'real', 'trending', 'read-only-discovery', coin.symbol?.toLowerCase()].filter(Boolean)
    };
  }

  async cleanup() {
    this.log('info', 'Cleaning up crypto updates tracker agent');
  }
}

module.exports = CryptoUpdatesTrackerAgent;

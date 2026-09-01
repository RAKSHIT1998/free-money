// Read-only real airdrop-eligibility discovery — polls airdrops.io's public,
// unauthenticated WordPress REST API for its "airdrop" custom post type
// (confirmed live 2026-09-01: GET https://airdrops.io/wp-json/wp/v2/airdrop —
// public, no API key, returns real currently-tracked airdrop project pages).
// This exists specifically instead of a "wallet-drainer"/private-key-scanning tool:
// there is no such thing as real crypto sitting genuinely unclaimed and ownerless —
// every wallet with a balance has an owner. What IS real is retroactive token
// airdrops sitting in an on-chain claim contract until the ELIGIBLE wallet claims
// them. This agent surfaces which airdrops currently exist, for the user to check
// their own wallet's eligibility and claim directly on the OFFICIAL project site —
// same "discovery only, human acts" pattern as cryptoGigHunterAgent.js.
//
// Safety properties (do not remove without updating the plan/tests):
// - GET requests only, to airdrops.io's own listing API and (best-effort, and
//   tolerant of failure) each item's own public page for status/network metadata.
// - Never checks any specific wallet's eligibility itself, never connects a wallet,
//   never signs or submits any transaction, never visits or calls any third-party
//   "claim" endpoint. Wallet-connect "claim" flows are a well-known drainer/phishing
//   vector; automating them is explicitly out of scope, not just unimplemented.
// - The only side effect is opportunityService.addOpportunity() — real data for a
//   human to review and act on themselves, exactly like the job/bounty feeds.
const BaseAgent = require('./baseAgent');
const axios = require('axios');
const opportunityService = require('../services/opportunityService');

const AIRDROPS_IO_LIST_URL = 'https://airdrops.io/wp-json/wp/v2/airdrop';

class AirdropClaimScannerAgent extends BaseAgent {
  constructor(options = {}) {
    super({
      ...options,
      type: 'airdropClaimScanner',
      config: {
        pollIntervalMs: options.config?.pollIntervalMs || 3600000,
        maxResultsPerPoll: options.config?.maxResultsPerPoll || 20,
        // Best-effort per-item status/network enrichment (see fetchStatusMeta) hits
        // one extra page per item — capped separately from maxResultsPerPoll so a
        // slow poll doesn't fan out into dozens of requests every cycle.
        maxEnrichPerPoll: options.config?.maxEnrichPerPoll || 10,
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
    this.log('info', 'Starting real airdrop discovery feed (read-only, public airdrops.io data) — never checks a specific wallet or claims anything automatically');

    while (this.isRunning) {
      try {
        await this.pollAndSurface();
      } catch (error) {
        this.log('error', 'Error polling airdrops.io:', error.message);
        this.state = 'error';
      }

      if (this.isRunning) {
        await new Promise(resolve => setTimeout(resolve, this.config.pollIntervalMs));
      }
    }
  }

  async pollAndSurface() {
    this.state = 'active';
    const items = await this.fetchRealAirdrops();

    let newCount = 0;
    let alreadyKnownCount = 0;
    let enriched = 0;
    for (const item of items.slice(0, this.config.maxResultsPerPoll)) {
      if (!item.link) continue;

      let meta = null;
      if (enriched < this.config.maxEnrichPerPoll) {
        meta = await this.fetchStatusMeta(item.link).catch(() => null);
        enriched++;
      }
      // Skip anything we can positively confirm has ended — no reason to keep
      // resurfacing a closed claim window. Unknown status (enrichment failed, or
      // wasn't attempted this poll) is surfaced anyway rather than silently dropped.
      if (meta?.airdrop_status === 'ended') continue;

      const saved = await opportunityService.addOpportunity(this.buildOpportunity(item, meta));
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
    this.log('info', `Polled airdrops.io: ${newCount} new listing(s), ${alreadyKnownCount} already known`);
  }

  getStatus() {
    return {
      ...super.getStatus(),
      discovery: { ...this.discoveryStats }
    };
  }

  /**
   * Real, public airdrops.io "airdrop" custom-post-type listing — no auth.
   * @returns {Promise<Array>}
   */
  async fetchRealAirdrops() {
    const { data } = await axios.get(AIRDROPS_IO_LIST_URL, {
      params: { per_page: this.config.maxResultsPerPoll, orderby: 'modified', order: 'desc' },
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; free-money-app opportunity discovery)' }
    });

    return Array.isArray(data) ? data.filter(entry => entry && entry.link) : [];
  }

  /**
   * Best-effort enrichment: the REST API's default fields for this custom post type
   * don't include status/network (see file header), but each page embeds them in an
   * inline `window.adioPage = {...}` script tag. Tolerant of the page's markup
   * changing — returns null rather than throwing if the pattern isn't found, and
   * callers already treat null as "unknown, surface anyway".
   * @param {string} pageUrl
   * @returns {Promise<Object|null>}
   */
  async fetchStatusMeta(pageUrl) {
    const { data: html } = await axios.get(pageUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; free-money-app opportunity discovery)' },
      timeout: 10000
    });
    const match = /window\.adioPage\s*=\s*(\{[^;]*?\});/.exec(html);
    if (!match) return null;
    try {
      return JSON.parse(match[1]);
    } catch {
      return null;
    }
  }

  buildOpportunity(item, meta) {
    const status = meta?.airdrop_status || 'unknown';
    const network = meta?.airdrop_network;

    return {
      title: `${this.stripHtml(item.title?.rendered) || 'Airdrop'}${network ? ` (${network})` : ''}`,
      description:
        `Real, currently-tracked airdrop listing via airdrops.io. Status: ${status}. ` +
        `This does NOT confirm your wallet is eligible — check eligibility and claim ` +
        `ONLY on the project's own official site/contract, never through a third-party ` +
        `"claim" link. Never connect a wallet or sign anything you haven't independently ` +
        `verified is the real project.`,
      url: item.link,
      source: 'airdrops.io-real',
      type: 'airdrop',
      reward: 'Varies — see listing',
      requirements: [
        'Verify this is the real project (official domain/socials) before doing anything',
        'Check YOUR wallet\'s eligibility using the project\'s own official checker/claim page',
        'Never sign a transaction from a link you have not independently verified'
      ],
      tags: ['airdrops.io', 'real', 'airdrop', 'read-only-discovery', status, ...(network ? [network] : [])]
    };
  }

  stripHtml(str) {
    return typeof str === 'string' ? str.replace(/<[^>]*>/g, '').trim() : str;
  }

  async cleanup() {
    this.log('info', 'Cleaning up airdrop claim scanner agent');
  }
}

module.exports = AirdropClaimScannerAgent;

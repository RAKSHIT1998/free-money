// Read-only REAL opportunity feed: polls HackerOne's public program directory
// (confirmed live during implementation: GET https://hackerone.com/programs/search
// ?query=<term>&sort=published_at:descending — public, unauthenticated, returns real
// program listings sorted by most-recently-published). Surfaces real data into the
// existing opportunityService so the user can manually go research and report real
// vulnerabilities for real bounty payouts.
//
// Safety properties (do not remove without updating the plan/tests):
// - GET requests only. No auth headers, no cookies/session, no login.
// - Never submits reports, never claims bounties, never touches walletService.
// - The only side effect is opportunityService.addOpportunity() — real, review-before-acting
//   data for a human, not an autonomous claim.
const BaseAgent = require('./baseAgent');
const axios = require('axios');
const opportunityService = require('../services/opportunityService');

// The public search endpoint requires a non-empty `query` (empty query returns no
// results). Rotate through common single-character queries across polls to get broad,
// varied coverage of the (sorted-by-recency) directory without needing pagination.
const SEARCH_TERMS = ['a', 'e', 'i', 'o', 's', 't'];

class HackerOneBountyAgent extends BaseAgent {
  constructor(options = {}) {
    super({
      ...options,
      type: 'hackerOneBounty',
      config: {
        pollIntervalMs: options.config?.pollIntervalMs || 3600000,
        maxResultsPerPoll: options.config?.maxResultsPerPoll || 20,
        ...options.config
      }
    });
    this.pollCount = 0;
  }

  async run() {
    this.log('info', 'Starting HackerOne real-opportunity feed (read-only, public data)');

    while (this.isRunning) {
      try {
        await this.pollAndSurface();
      } catch (error) {
        this.log('error', 'Error polling HackerOne:', error.message);
        this.state = 'error';
      }

      if (this.isRunning) {
        await new Promise(resolve => setTimeout(resolve, this.config.pollIntervalMs));
      }
    }
  }

  async pollAndSurface() {
    this.state = 'active';
    const programs = await this.fetchPublicPrograms();

    let surfaced = 0;
    for (const program of programs.slice(0, this.config.maxResultsPerPoll)) {
      if (!program.handle) continue;

      await opportunityService.addOpportunity({
        title: `HackerOne: ${program.name || program.handle}`,
        description: (program.about && program.about.trim())
          ? program.about
          : `Public bug bounty program on HackerOne. Handle: ${program.handle}`,
        url: `https://hackerone.com/${program.handle}`,
        source: 'HackerOne-real',
        type: 'bounty',
        reward: 'See program policy',
        requirements: [
          'Register a free HackerOne researcher account',
          'Follow the program\'s scope and disclosure policy before submitting anything'
        ],
        tags: ['hackerone', 'real', 'security-research', 'read-only-discovery']
      });
      surfaced++;
    }

    this.pollCount++;
    this.updatePerformance({
      actionsTaken: this.performance.actionsTaken + 1,
      opportunitiesFound: this.performance.opportunitiesFound + surfaced
    });
    this.log('info', `Surfaced ${surfaced} real HackerOne opportunities`);
  }

  /**
   * Fetch a page of real, public HackerOne programs. GET only, no auth.
   * @returns {Promise<Array<{name, handle, about}>>}
   */
  async fetchPublicPrograms() {
    const term = SEARCH_TERMS[this.pollCount % SEARCH_TERMS.length];
    const { data } = await axios.get('https://hackerone.com/programs/search', {
      params: { query: term, sort: 'published_at:descending' },
      headers: { Accept: 'application/json' }
    });

    const results = Array.isArray(data?.results) ? data.results : [];
    return results.map(p => ({
      name: p.name || p.handle,
      handle: p.handle,
      about: p.about
    }));
  }

  async cleanup() {
    this.log('info', 'Cleaning up HackerOne bounty agent');
  }
}

module.exports = HackerOneBountyAgent;

// Read-only REAL opportunity feed: polls GitHub's public issue search API
// (confirmed live during implementation: GET https://api.github.com/search/issues
// ?q=label:bounty+state:open+type:issue — public, unauthenticated, returns real open
// issues across public repos labeled as paid bounties). Surfaces real data into the
// existing opportunityService so the user can manually review and claim real paid
// coding bounties.
//
// Safety properties (do not remove without updating the plan/tests):
// - GET requests only. No auth headers, no cookies/session, no login.
// - Never comments on issues, never claims a bounty, never touches walletService.
// - The only side effect is opportunityService.addOpportunity() — real, review-before-acting
//   data for a human, not an autonomous claim.
const BaseAgent = require('./baseAgent');
const axios = require('axios');
const opportunityService = require('../services/opportunityService');

// Rotate across the common label spellings projects use for paid bounties — a single
// query would miss real bounties tagged with a different (but equally common) label.
const SEARCH_QUERIES = [
  'label:bounty state:open type:issue',
  'label:"help wanted" label:bounty state:open type:issue',
  'label:"$" state:open type:issue',
  '"bounty" in:title state:open type:issue'
];

class GithubBountyHunterAgent extends BaseAgent {
  constructor(options = {}) {
    super({
      ...options,
      type: 'githubBountyHunter',
      config: {
        pollIntervalMs: options.config?.pollIntervalMs || 3600000,
        maxResultsPerPoll: options.config?.maxResultsPerPoll || 20,
        ...options.config
      }
    });
    this.pollCount = 0;

    this.discoveryStats = {
      lastPollAt: null,
      newThisPoll: 0,
      alreadyKnownThisPoll: 0,
      totalNewAllTime: 0
    };
  }

  async run() {
    this.log('info', 'Starting GitHub bounty-issue feed (read-only, public data)');

    if (this.isRunning) {
      await new Promise(resolve => setTimeout(resolve, Math.random() * 60000));
    }

    while (this.isRunning) {
      try {
        await this.pollAndSurface();
      } catch (error) {
        this.log('error', 'Error polling GitHub bounty issues:', error.message);
        this.state = 'error';
      }

      if (this.isRunning) {
        await new Promise(resolve => setTimeout(resolve, this.config.pollIntervalMs));
      }
    }
  }

  async pollAndSurface() {
    this.state = 'active';
    const issues = await this.fetchBountyIssues();

    let newCount = 0;
    let alreadyKnownCount = 0;
    for (const issue of issues.slice(0, this.config.maxResultsPerPoll)) {
      if (!issue.url) continue;

      const saved = await opportunityService.addOpportunity({
        title: `GitHub Bounty: ${issue.title}`,
        description: (issue.body && issue.body.trim())
          ? issue.body.slice(0, 2000)
          : `Open bounty-labeled issue in ${issue.repo}.`,
        url: issue.url,
        source: 'GitHub-real',
        type: 'bounty',
        reward: 'See issue for bounty amount',
        requirements: [
          `Read the full issue at ${issue.url} for scope and acceptance criteria`,
          'Comment to claim before starting work — most bounty repos require this to avoid duplicate effort',
          'Open a pull request referencing the issue once the fix is ready'
        ],
        tags: ['github', 'real', 'coding-bounty', 'read-only-discovery']
      });
      if (saved.isNew) newCount++; else alreadyKnownCount++;
    }

    this.pollCount++;
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
    this.log('info', `Polled GitHub bounties: ${newCount} new issue(s), ${alreadyKnownCount} already known`);
  }

  getStatus() {
    return {
      ...super.getStatus(),
      discovery: { ...this.discoveryStats }
    };
  }

  /**
   * Fetch a page of real, public GitHub issues labeled as paid bounties. GET only,
   * no auth — subject to GitHub's unauthenticated search rate limit (generous enough
   * for one request per hourly poll).
   * @returns {Promise<Array<{title, body, url, repo}>>}
   */
  async fetchBountyIssues() {
    const query = SEARCH_QUERIES[this.pollCount % SEARCH_QUERIES.length];
    const { data } = await axios.get('https://api.github.com/search/issues', {
      params: { q: query, sort: 'created', order: 'desc', per_page: this.config.maxResultsPerPoll },
      headers: { Accept: 'application/vnd.github+json' }
    });

    const items = Array.isArray(data?.items) ? data.items : [];
    return items.map(i => ({
      title: i.title,
      body: i.body,
      url: i.html_url,
      repo: i.repository_url ? i.repository_url.replace('https://api.github.com/repos/', '') : 'unknown repo'
    }));
  }

  async cleanup() {
    this.log('info', 'Cleaning up GitHub bounty hunter agent');
  }
}

module.exports = GithubBountyHunterAgent;

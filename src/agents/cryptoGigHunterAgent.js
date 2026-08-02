// Read-only REAL job feed: polls Remote OK's public crypto-jobs category (confirmed
// live during implementation: GET https://remoteok.com/remote-crypto-jobs.json —
// public, unauthenticated, returns real remote job listings in the crypto/web3
// industry). Surfaces real data into the existing opportunityService so the user can
// manually review and apply for real roles/gigs.
//
// Per Remote OK's own API terms (returned as the first array element of every
// response): callers must link back to the job's Remote OK URL and credit Remote OK
// as the source. Every surfaced opportunity does both (see buildOpportunity below).
//
// Safety properties (do not remove without updating the plan/tests):
// - GET requests only. No auth headers, no cookies/session, no login, no application
//   submission of any kind.
// - Never applies for jobs, never touches walletService. The only side effect is
//   opportunityService.addOpportunity() — real, review-before-acting data for a
//   human, not an autonomous claim or submission.
// - "Crypto/web3" jobs on Remote OK are jobs IN the crypto industry, not necessarily
//   jobs that pay literally in cryptocurrency — that distinction is preserved in the
//   surfaced description rather than papered over, so the user isn't misled.
const BaseAgent = require('./baseAgent');
const axios = require('axios');
const opportunityService = require('../services/opportunityService');

const REMOTE_OK_CRYPTO_URL = 'https://remoteok.com/remote-crypto-jobs.json';

class CryptoGigHunterAgent extends BaseAgent {
  constructor(options = {}) {
    super({
      ...options,
      type: 'cryptoGigHunter',
      config: {
        pollIntervalMs: options.config?.pollIntervalMs || 3600000,
        maxResultsPerPoll: options.config?.maxResultsPerPoll || 20,
        ...options.config
      }
    });
  }

  async run() {
    this.log('info', 'Starting real crypto/web3 gig feed (read-only, public Remote OK data)');

    while (this.isRunning) {
      try {
        await this.pollAndSurface();
      } catch (error) {
        this.log('error', 'Error polling Remote OK crypto jobs:', error.message);
        this.state = 'error';
      }

      if (this.isRunning) {
        await new Promise(resolve => setTimeout(resolve, this.config.pollIntervalMs));
      }
    }
  }

  async pollAndSurface() {
    this.state = 'active';
    const jobs = await this.fetchRealCryptoJobs();

    let surfaced = 0;
    for (const job of jobs.slice(0, this.config.maxResultsPerPoll)) {
      if (!job.url) continue;

      await opportunityService.addOpportunity(this.buildOpportunity(job));
      surfaced++;
    }

    this.updatePerformance({
      actionsTaken: this.performance.actionsTaken + 1,
      opportunitiesFound: this.performance.opportunitiesFound + surfaced
    });
    this.log('info', `Surfaced ${surfaced} real crypto/web3 job listings from Remote OK`);
  }

  /**
   * Fetch real, public Remote OK crypto/web3 job listings. GET only, no auth.
   * The API's first array element is a legal/terms notice, not a job — skipped.
   * @returns {Promise<Array>}
   */
  async fetchRealCryptoJobs() {
    const { data } = await axios.get(REMOTE_OK_CRYPTO_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; free-money-app opportunity discovery)' }
    });

    return Array.isArray(data) ? data.filter(entry => entry && entry.id) : [];
  }

  buildOpportunity(job) {
    const salary = job.salary_min && job.salary_max
      ? `$${job.salary_min.toLocaleString()}–$${job.salary_max.toLocaleString()}/yr`
      : 'See listing';

    return {
      title: `${job.position || 'Remote Role'} at ${job.company || 'Unknown Company'}`,
      description: `Real remote job listing in the crypto/web3 industry via Remote OK. ` +
        `Note: this is a crypto-INDUSTRY job, not necessarily paid literally in cryptocurrency — ` +
        `check the listing for actual payment terms. ${job.location ? `Location: ${job.location}.` : ''}`,
      url: job.url,
      source: 'RemoteOK-real',
      type: 'freelance',
      reward: salary,
      requirements: [
        'Review the full listing and apply directly on Remote OK',
        'Verify payment terms (fiat vs. crypto) with the employer before accepting any work'
      ],
      tags: ['remoteok', 'real', 'crypto', 'web3', 'read-only-discovery', ...(job.tags || [])]
    };
  }

  async cleanup() {
    this.log('info', 'Cleaning up crypto gig hunter agent');
  }
}

module.exports = CryptoGigHunterAgent;

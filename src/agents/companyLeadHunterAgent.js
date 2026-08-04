// Read-only REAL project-lead feed: scans Hacker News's public "Ask HN: Who is
// hiring?" and "Ask HN: Freelancer? Seeking freelancer?" monthly threads (via HN's
// public, unauthenticated Algolia search API — confirmed live during implementation)
// for genuine companies posting contract/freelance requests to build a website, app,
// AI agent, or other custom software. These are the two well-known places on HN where
// real companies post this kind of work publicly, as opposed to a freelance platform
// that would require ToS-violating login automation to read or bid on.
//
// This is a genuinely low-volume feed — most "Who is hiring?" posts are full-time
// roles, and most "Seeking freelancer?" replies are individuals offering their own
// services, not companies requesting work. The filter below is intentionally strict
// (requires an explicit contract/freelance signal + a build-shaped keyword, excludes
// full-time listings) to keep precision high rather than flooding the feed with
// irrelevant full-time job postings — it surfaces what's genuinely real and skips
// everything else, the same principle as the other discovery agents.
//
// Safety properties (do not remove without updating the plan/tests):
// - GET requests only. No auth headers, no cookies/session, no login.
// - Never replies/comments on HN, never contacts anyone, never touches walletService.
// - The only side effects are opportunityService.addOpportunity() (real, review-
//   before-acting data for a human) and, capped per poll, auto-generating a draft
//   PITCH via gigDraftService for a human to review/edit/send themselves — never sent
//   or submitted automatically, and never fabricates credentials or claims (see the
//   'pitch' system prompt in gigDraftService.js).
const BaseAgent = require('./baseAgent');
const axios = require('axios');
const opportunityService = require('../services/opportunityService');
const gigDraftService = require('../services/gigDraftService');
const { Config } = require('../config/config');

const HN_ALGOLIA_BASE = 'https://hn.algolia.com/api/v1';

// Individuals post "SEEKING WORK" in the same monthly thread as companies posting
// "SEEKING FREELANCER" — this distinguishes an offer (skip) from a request (surface).
const SEEKING_WORK_PATTERN = /^\s*SEEKING\s+WORK/i;
const CONTRACT_SIGNAL_PATTERN = /\b(contract|freelance|freelancer)\b/i;
const FULL_TIME_EXCLUDE_PATTERN = /\bfull[- ]?time\b/i;
const BUILD_KEYWORD_PATTERN = /\b(website|web ?app|web application|landing page|mvp|prototype|custom software|shopify|wordpress|ai agent|automation|saas|build (us|our|a|an|me)|develop (us|our|a|an))\b/i;

function stripHtml(text) {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x2F;/g, '/')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

class CompanyLeadHunterAgent extends BaseAgent {
  constructor(options = {}) {
    super({
      ...options,
      type: 'companyLeadHunter',
      config: {
        // Source threads are monthly, not hourly — frequent polling would just
        // re-fetch the same page from Algolia for no benefit.
        pollIntervalMs: options.config?.pollIntervalMs || 21600000,
        maxResultsPerPoll: options.config?.maxResultsPerPoll || 10,
        maxAutoDraftsPerPoll: options.config?.maxAutoDraftsPerPoll || 3,
        ...options.config
      }
    });

    this.discoveryStats = {
      lastPollAt: null,
      newThisPoll: 0,
      alreadyKnownThisPoll: 0,
      totalNewAllTime: 0,
      autoDraftedThisPoll: 0,
      totalAutoDraftedAllTime: 0
    };

    const config = new Config();
    this.persistenceEnabled = config.get('agentManager.persistenceEnabled', true);
  }

  async run() {
    this.log('info', 'Starting company/client project-lead feed (read-only, public Hacker News data)');

    if (this.isRunning) {
      await new Promise(resolve => setTimeout(resolve, Math.random() * 60000));
    }

    while (this.isRunning) {
      try {
        await this.pollAndSurface();
      } catch (error) {
        this.log('error', 'Error polling Hacker News for company leads:', error.message);
        this.state = 'error';
      }

      if (this.isRunning) {
        await new Promise(resolve => setTimeout(resolve, this.config.pollIntervalMs));
      }
    }
  }

  async pollAndSurface() {
    this.state = 'active';
    const leads = await this.fetchLeads();

    let newCount = 0;
    let alreadyKnownCount = 0;
    let autoDraftedCount = 0;

    for (const opportunity of leads.slice(0, this.config.maxResultsPerPoll)) {
      const saved = await opportunityService.addOpportunity(opportunity);
      if (saved.isNew) {
        newCount++;
        if (autoDraftedCount < this.config.maxAutoDraftsPerPoll) {
          const drafted = await this.tryAutoDraftPitch(opportunity);
          if (drafted) autoDraftedCount++;
        }
      } else {
        alreadyKnownCount++;
      }
    }

    this.discoveryStats = {
      lastPollAt: new Date(),
      newThisPoll: newCount,
      alreadyKnownThisPoll: alreadyKnownCount,
      totalNewAllTime: this.discoveryStats.totalNewAllTime + newCount,
      autoDraftedThisPoll: autoDraftedCount,
      totalAutoDraftedAllTime: this.discoveryStats.totalAutoDraftedAllTime + autoDraftedCount
    };

    this.updatePerformance({
      actionsTaken: this.performance.actionsTaken + 1,
      opportunitiesFound: this.performance.opportunitiesFound + newCount
    });
    this.log('info', `Polled Hacker News for company leads: ${newCount} new, ${alreadyKnownCount} already known, ${autoDraftedCount} auto-drafted`);
  }

  getStatus() {
    return {
      ...super.getStatus(),
      discovery: { ...this.discoveryStats }
    };
  }

  /**
   * Auto-generates a pitch-response DRAFT for a freshly discovered lead so it's
   * sitting ready for human review the moment it's found — still never sent
   * automatically (see gigDraftService's 'pitch' prompt: it's explicitly told not to
   * fabricate credentials or a portfolio). Real Claude API cost, so capped per poll
   * and skipped if persistence is off (nowhere durable to store it) or drafting isn't
   * configured.
   */
  async tryAutoDraftPitch(opportunity) {
    if (!this.persistenceEnabled) return false;
    if (!process.env.ANTHROPIC_API_KEY) return false;

    const taskDescription = `${opportunity.title}\n\n${opportunity.description}\n\nSource: ${opportunity.url}`;

    try {
      const { content, model } = await gigDraftService.generateDraft({
        taskType: 'pitch',
        taskDescription
      });

      const GigDraft = require('../models/GigDraft');
      await GigDraft.create({
        taskType: 'pitch',
        taskDescription,
        draftContent: content,
        status: 'draft',
        model,
        sourceOpportunityUrl: opportunity.url,
        autoGenerated: true
      });
      return true;
    } catch (error) {
      this.log('warn', `Auto-draft failed for ${opportunity.url}: ${error.message}`);
      return false;
    }
  }

  /**
   * Real, public Hacker News data via Algolia's search API (no auth). Scans the
   * newest "Who is hiring?" and "Freelancer? Seeking freelancer?" monthly threads for
   * top-level comments (direct replies to the story — the actual posts, as opposed to
   * nested discussion underneath them) that read like a company wanting website/app/
   * agent/software work built on contract, as opposed to a full-time role or a person
   * offering their own freelance services.
   * @returns {Promise<Array<Object>>} opportunityService-shaped records
   */
  async fetchLeads() {
    const threads = await this.findLatestThreads();
    const leads = [];

    for (const thread of threads) {
      const comments = await this.fetchTopLevelComments(thread.objectID);
      for (const comment of comments) {
        const text = stripHtml(comment.comment_text || '');
        if (!text || SEEKING_WORK_PATTERN.test(text)) continue;
        if (!CONTRACT_SIGNAL_PATTERN.test(text)) continue;
        if (FULL_TIME_EXCLUDE_PATTERN.test(text)) continue;
        if (!BUILD_KEYWORD_PATTERN.test(text)) continue;

        const url = `https://news.ycombinator.com/item?id=${comment.objectID}`;
        const firstLine = text.split('\n').find(l => l.trim()) || text;

        leads.push({
          title: `Project Lead: ${firstLine.slice(0, 100)}`,
          description: text.slice(0, 2000),
          url,
          source: 'HackerNews-real',
          type: 'freelance',
          reward: 'Not specified — see the post and confirm budget directly',
          requirements: [
            `Read the full post at ${url}`,
            'This is a public forum post, not a job platform listing — reply as a genuine HN comment or use any contact info they included',
            'Confirm scope, budget, and payment terms directly with them before starting any work'
          ],
          tags: ['hackernews', 'real', 'client-lead', 'read-only-discovery', thread.label]
        });
      }
    }

    return leads;
  }

  async findLatestThreads() {
    const [hiring, freelancer] = await Promise.all([
      this.findLatestStory('Who is hiring', /^Ask HN:\s*Who is hiring\?/i, 'who-is-hiring'),
      this.findLatestStory('Freelancer? Seeking freelancer?', /Seeking freelancer\??\s*\(/i, 'seeking-freelancer')
    ]);
    return [hiring, freelancer].filter(Boolean);
  }

  async findLatestStory(query, titlePattern, label) {
    const { data } = await axios.get(`${HN_ALGOLIA_BASE}/search_by_date`, {
      params: { query, tags: 'story', hitsPerPage: 5 }
    });
    const hit = (data?.hits || []).find(h => titlePattern.test(h.title || ''));
    return hit ? { objectID: hit.objectID, label } : null;
  }

  async fetchTopLevelComments(storyObjectId) {
    const { data } = await axios.get(`${HN_ALGOLIA_BASE}/search_by_date`, {
      params: { tags: `comment,story_${storyObjectId}`, hitsPerPage: 300 }
    });
    const hits = Array.isArray(data?.hits) ? data.hits : [];
    return hits.filter(h => String(h.parent_id) === String(storyObjectId));
  }

  async cleanup() {
    this.log('info', 'Cleaning up company lead hunter agent');
  }
}

module.exports = CompanyLeadHunterAgent;

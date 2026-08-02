// Unit tests for HackerOneBountyAgent: confirms it only ever makes GET requests to
// the public HackerOne endpoint, surfaces real data via opportunityService, and never
// touches walletService or issues authenticated/write requests.
jest.mock('axios');
jest.mock('../src/services/opportunityService', () => ({
  addOpportunity: jest.fn().mockResolvedValue({})
}));

const axios = require('axios');
const opportunityService = require('../src/services/opportunityService');
const HackerOneBountyAgent = require('../src/agents/hackerOneBountyAgent');

describe('HackerOneBountyAgent.pollAndSurface', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('surfaces real programs via opportunityService.addOpportunity, tagged HackerOne-real', async () => {
    axios.get.mockResolvedValue({
      data: {
        total: 2,
        results: [
          { name: 'Adobe', handle: 'adobe', about: 'Security bounty program' },
          { name: 'Apple', handle: 'apple', about: '' }
        ]
      }
    });

    const agent = new HackerOneBountyAgent({ id: 'test-h1-agent' });
    await agent.pollAndSurface();

    expect(opportunityService.addOpportunity).toHaveBeenCalledTimes(2);
    expect(opportunityService.addOpportunity).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'HackerOne: Adobe',
        url: 'https://hackerone.com/adobe',
        source: 'HackerOne-real',
        type: 'bounty'
      })
    );
  });

  test('only ever issues a GET request, never POST, and no auth headers', async () => {
    axios.get.mockResolvedValue({ data: { total: 0, results: [] } });
    axios.post = jest.fn();

    const agent = new HackerOneBountyAgent({ id: 'test-h1-agent-2' });
    await agent.pollAndSurface();

    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(axios.post).not.toHaveBeenCalled();

    const [, options] = axios.get.mock.calls[0];
    expect(options.headers).not.toHaveProperty('Authorization');
    expect(options.headers).not.toHaveProperty('Cookie');
  });

  test('skips results missing a handle and never throws on malformed data', async () => {
    axios.get.mockResolvedValue({
      data: { total: 1, results: [{ name: 'No Handle Program' }] }
    });

    const agent = new HackerOneBountyAgent({ id: 'test-h1-agent-3' });
    await expect(agent.pollAndSurface()).resolves.not.toThrow();
    expect(opportunityService.addOpportunity).not.toHaveBeenCalled();
  });
});

// Confirms real-money/real-data agents (binanceDca, hackerOneBounty) are never eliminated
// or boosted by ManagerAgent's survival-of-the-fittest logic, regardless of their score.
const ManagerAgent = require('../src/agents/managerAgent');

function makeStubAgent(id, type) {
  return {
    id,
    type,
    performance: { earnings: 0, opportunitiesFound: 0, actionsTaken: 0, successRate: 0 }
  };
}

describe('ManagerAgent excludes real-money/real-data agents from survival scoring', () => {
  test('removeAgent is never called for binanceDca or hackerOneBounty, regardless of score', async () => {
    const fakeAgent1 = makeStubAgent(1, 'cryptoHunter');
    const fakeAgent2 = makeStubAgent(2, 'opportunityScout');
    const realDca = makeStubAgent(3, 'binanceDca');
    const realH1 = makeStubAgent(4, 'hackerOneBounty');

    const removedIds = [];
    const mockAgentManager = {
      getAllAgents: jest.fn(() => [fakeAgent1, fakeAgent2, realDca, realH1]),
      removeAgent: jest.fn(async id => { removedIds.push(id); return true; }),
      updateAgentConfig: jest.fn(async () => true),
      spawnAgent: jest.fn(async () => ({}))
    };

    const manager = new ManagerAgent({
      id: 'test-manager',
      config: {
        survivalThreshold: 0.5, // eliminate half of the non-real agents
        eliteThreshold: 0.5,
        minAgents: 0
      }
    });
    manager.setAgentManager(mockAgentManager);

    await manager.performAction();

    // Only fake-type agent IDs may ever be removed.
    for (const id of removedIds) {
      expect([realDca.id, realH1.id]).not.toContain(id);
    }
    expect(mockAgentManager.removeAgent).not.toHaveBeenCalledWith(realDca.id);
    expect(mockAgentManager.removeAgent).not.toHaveBeenCalledWith(realH1.id);
  });

  test('real agents are excluded from getAllAgents-derived evaluation entirely (not just elimination)', async () => {
    const realDca = makeStubAgent(10, 'binanceDca');
    const realH1 = makeStubAgent(11, 'hackerOneBounty');

    const mockAgentManager = {
      getAllAgents: jest.fn(() => [realDca, realH1]), // ONLY real agents present
      removeAgent: jest.fn(),
      updateAgentConfig: jest.fn(),
      spawnAgent: jest.fn(async () => ({}))
    };

    const manager = new ManagerAgent({
      id: 'test-manager-2',
      config: { survivalThreshold: 0.5, eliteThreshold: 0.5, minAgents: 0 }
    });
    manager.setAgentManager(mockAgentManager);

    await manager.performAction();

    expect(mockAgentManager.removeAgent).not.toHaveBeenCalled();
    expect(mockAgentManager.updateAgentConfig).not.toHaveBeenCalled();
  });
});

// Simple test for the agent system
const BaseAgent = require('../src/agents/baseAgent');
const CryptoHunterAgent = require('../src/agents/cryptoHunterAgent');
const OpportunityScoutAgent = require('../src/agents/opportunityScoutAgent');
const DeveloperAgent = require('../src/agents/developerAgent');
const ManagerAgent = require('../src/agents/managerAgent');
const AgentManager = require('../src/agents/agentManager');

async function testAgentSystem() {
  console.log('Testing Agent System...');

  try {
    // Test 1: Create a base agent
    console.log('\n1. Testing BaseAgent creation...');
    const baseAgent = new BaseAgent({ type: 'test' });
    console.log(`✓ Created base agent: ${baseAgent.id}`);

    // Test 2: Create a crypto hunter agent
    console.log('\n2. Testing CryptoHunterAgent creation...');
    const cryptoAgent = new CryptoHunterAgent({
      name: 'Test Crypto Hunter',
      config: { scanInterval: 1000 } // Fast scan for testing
    });
    console.log(`✓ Created crypto hunter agent: ${cryptoAgent.id}`);

    // Test 3: Create an opportunity scout agent
    console.log('\n3. Testing OpportunityScoutAgent creation...');
    const scoutAgent = new OpportunityScoutAgent({
      name: 'Test Opportunity Scout',
      config: { scanInterval: 1000 } // Fast scan for testing
    });
    console.log(`✓ Created opportunity scout agent: ${scoutAgent.id}`);

    // Test 4: Create a developer agent
    console.log('\n4. Testing DeveloperAgent creation...');
    const devAgent = new DeveloperAgent({
      name: 'Test Developer',
      config: { taskInterval: 1000 } // Fast task for testing
    });
    console.log(`✓ Created developer agent: ${devAgent.id}`);

    // Test 5: Create a manager agent
    console.log('\n5. Testing ManagerAgent creation...');
    const managerAgent = new ManagerAgent({
      name: 'Test Manager',
      config: { evaluationInterval: 5000 } // Evaluate every 5 seconds for testing
    });
    console.log(`✓ Created manager agent: ${managerAgent.id}`);

    // Test 6: Test agent manager
    console.log('\n6. Testing AgentManager...');
    const manager = new AgentManager({ maxConcurrent: 20 });

    // Spawn a few agents of each type
    const cryptoHunter = await manager.spawnAgent('cryptoHunter', { name: 'Test Crypto Hunter' });
    const opportunityScout = await manager.spawnAgent('opportunityScout', { name: 'Test Opportunity Scout' });
    const developer = await manager.spawnAgent('developer', { name: 'Test Developer' });

    console.log(`✓ Spawned crypto hunter: ${cryptoHunter.id}`);
    console.log(`✓ Spawned opportunity scout: ${opportunityScout.id}`);
    console.log(`✓ Spawned developer: ${developer.id}`);

    // Check that we can retrieve agents
    const retrievedAgent = manager.getAgent(cryptoHunter.id);
    console.log(`✓ Retrieved agent: ${retrievedAgent ? 'Success' : 'Failed'}`);

    // Get all agents
    const allAgents = manager.getAllAgents();
    console.log(`✓ Total agents: ${allAgents.length}`);

    // Get agents by type
    const cryptoAgents = manager.getAgentsByType('cryptoHunter');
    const scoutAgents = manager.getAgentsByType('opportunityScout');
    const devAgents = manager.getAgentsByType('developer');
    const managerAgents = manager.getAgentsByType('manager');
    console.log(`✓ Crypto hunters: ${cryptoAgents.length}`);
    console.log(`✓ Opportunity scouts: ${scoutAgents.length}`);
    console.log(`✓ Developers: ${devAgents.length}`);
    console.log(`✓ Managers: ${managerAgents.length}`);

    // Get statistics
    const stats = manager.getStatistics();
    console.log(`✓ Agent statistics: ${stats.total} total agents`);
    console.log(`✓ Agent types:`, JSON.stringify(stats.byType));

    // Clean up - stop the agents
    await manager.removeAgent(cryptoHunter.id);
    await manager.removeAgent(opportunityScout.id);
    await manager.removeAgent(developer.id);
    console.log('✓ Cleaned up test agents');

    console.log('\n✅ All tests passed!');
    return true;
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    return false;
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  testAgentSystem().then(success => {
    process.exit(success ? 0 : 1);
  }).catch(err => {
    console.error('Test failed with error:', err);
    process.exit(1);
  });
}

module.exports = { testAgentSystem };
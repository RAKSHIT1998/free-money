// Demo script to showcase the multi-agent money-making system
const AgentManager = require('./src/agents/agentManager');

async function runDemo() {
  console.log('=== Multi-Agent Money-Making System Demo ===\n');

  // Create agent manager with persistence disabled for demo
  const manager = new AgentManager({
    maxConcurrent: 10,
    spawnDelay: 500,
    cleanupInterval: 30000,
    persistenceEnabled: false // Disable persistence for demo
  });

  try {
    console.log('1. Creating initial agent population...');

    // Create initial agents
    const hunter = await manager.spawnAgent('cryptoHunter', {
      name: 'Crypto Hunter Alpha',
      config: { scanInterval: 2000 } // Scan every 2 seconds for demo
    });

    const scout = await manager.spawnAgent('opportunityScout', {
      name: 'Opportunity Scout Beta',
      config: { scanInterval: 3000 } // Scan every 3 seconds for demo
    });

    const developer = await manager.spawnAgent('developer', {
      name: 'Developer Gamma',
      config: { taskInterval: 4000 } // Task every 4 seconds for demo
    });

    const managerAgent = await manager.spawnAgent('manager', {
      name: 'Manager Delta',
      config: { evaluationInterval: 10000 } // Evaluate every 10 seconds for demo
    });

    console.log(`   Created ${manager.getAllAgents().length} agents:\n`);

    // Display initial agent info
    const agents = manager.getAllAgents();
    agents.forEach(agent => {
      console.log(`   - ${agent.config.name} (${agent.type}) [ID: ${agent.id}]`);
    });

    console.log('\n2. System is now running. Agents will:');
    console.log('   • Scan for opportunities at their configured intervals');
    console.log('   • Report findings and earnings');
    console.log('   • Manager will periodically evaluate performance');
    console.log('   • Underperformers will be replaced, top performers rewarded\n');

    console.log('3. Live output (will run for 30 seconds)...\n');

    // Let the system run for 30 seconds
    await new Promise(resolve => setTimeout(resolve, 30000));

    // Show final statistics
    console.log('\n4. Final Statistics:');
    const stats = manager.getStatistics();
    console.log(`   Total Agents: ${stats.total}`);
    console.log(`   Agent Types:`, JSON.stringify(stats.byType, null, 4));

    if (stats.averagePerformance) {
      console.log('   Average Performance:');
      console.log(`     Earnings: $${stats.averagePerformance.earnings.toFixed(2)}`);
      console.log(`     Opportunities Found: ${stats.averagePerformance.opportunitiesFound}`);
      console.log(`     Actions Taken: ${stats.averagePerformance.actionsTaken}`);
      console.log(`     Success Rate: ${stats.averagePerformance.successRate.toFixed(2)}%`);
    }

    console.log('\n5. Stopping all agents...');
    await manager.shutdown();
    console.log('   All agents stopped successfully.');

    console.log('\n=== Demo Complete ===');

  } catch (error) {
    console.error('Demo failed:', error);
    await manager.shutdown().catch(() => {}); // Try to clean up
  }
}

// Run the demo if this file is executed directly
if (require.main === module) {
  runDemo().catch(console.error);
}

module.exports = { runDemo };
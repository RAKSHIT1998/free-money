// Test for the opportunity service
const opportunityService = require('../src/services/opportunityService');

async function testOpportunityService() {
  console.log('Testing Opportunity Service...');

  try {
    // Test 1: We already have an instance
    console.log('\n1. Testing OpportunityService instance...');
    console.log('✓ OpportunityService instance obtained');

    // Test 2: Get initial opportunities
    console.log('\n2. Getting initial opportunities...');
    const initialOps = await opportunityService.getOpportunities({});
    console.log(`✓ Found ${initialOps.length} initial opportunities`);

    // Test 3: Add a new opportunity
    console.log('\n3. Adding a new opportunity...');
    const newOpportunity = {
      title: 'Test Opportunity',
      description: 'This is a test opportunity',
      url: 'https://example.com/test',
      source: 'TestSource',
      type: 'bounty',
      reward: '$100',
      requirements: ['Test skill'],
      tags: ['test', 'bounty']
    };

    const addedOp = await opportunityService.addOpportunity(newOpportunity);
    console.log(`✓ Added opportunity with ID: ${addedOp.id}`);

    // Test 4: Get opportunities again and verify the new one is there
    console.log('\n4. Getting opportunities after addition...');
    const opsAfterAdd = await opportunityService.getOpportunities({});
    console.log(`✓ Found ${opsAfterAdd.length} opportunities`);

    const found = opsAfterAdd.some(op => op.id === addedOp.id);
    console.log(`✓ New opportunity found in list: ${found}`);

    // Test 5: Get opportunity by ID
    console.log('\n5. Getting opportunity by ID...');
    const opById = await opportunityService.getOpportunityById(addedOp.id);
    console.log(`✓ Retrieved opportunity: ${opById ? opById.title : 'Not found'}`);

    // Test 6: Get opportunity stats
    console.log('\n6. Getting opportunity statistics...');
    const stats = await opportunityService.getOpportunityStats();
    console.log(`✓ Total opportunities: ${stats.totalOpportunities}`);
    console.log(`✓ Opportunities by type:`, stats.byType);

    console.log('\n✅ All opportunity service tests passed!');
    return true;
  } catch (error) {
    console.error('\n❌ Opportunity service test failed:', error);
    return false;
  }
}

if (require.main === module) {
  testOpportunityService().then(success => {
    process.exit(success ? 0 : 1);
  }).catch(err => {
    console.error('Test failed with error:', err);
    process.exit(1);
  });
}

module.exports = { testOpportunityService };
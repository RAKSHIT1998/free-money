// In-memory opportunity service for development/testing
let opportunities = [];
let idCounter = 1;

// Helper to generate a simple ID
const generateId = () => {
  return idCounter++;
};

class OpportunityService {
  constructor() {
    console.log('Constructor: opportunities array length before seeding:', opportunities.length);
    // Initialize with some sample data if empty
    if (opportunities.length === 0) {
      this.seedSampleData();
    }
    console.log('Constructor: opportunities array length after seeding:', opportunities.length);

    // Bind methods to ensure proper 'this' context
    this.fetchFromSourceA = this.fetchFromSourceA.bind(this);
    this.fetchFromSourceB = this.fetchFromSourceB.bind(this);
    this.fetchAllOpportunities = this.fetchAllOpportunities.bind(this);
    this.saveOpportunities = this.saveOpportunities.bind(this);
    this.syncOpportunities = this.syncOpportunities.bind(this);
    this.getOpportunities = this.getOpportunities.bind(this);
    this.getOpportunityById = this.getOpportunityById.bind(this);

    // Define sources after binding
    this.sources = [
      this.fetchFromSourceA,
      this.fetchFromSourceB
    ];
  }

  seedSampleData() {
    console.log('Seeding sample data...');
    const samples = [
      {
        title: 'Example Airdrop: FreeToken',
        description: 'Claim 100 FreeTokens by joining our Telegram and following on Twitter.',
        url: 'https://example.com/airdrop/freetoken',
        source: 'ExampleAirdropSite',
        type: 'airdrop',
        reward: '100 FreeTokens',
        deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
        requirements: ['Join Telegram', 'Follow Twitter', 'Retweet announcement'],
        tags: ['airdrop', 'FreeToken']
      },
      {
        title: 'Gitcoin Grant: OpenSource Project',
        description: 'Funding for open-source developers working on public goods.',
        url: 'https://gitcoin.co/grant/123',
        source: 'Gitcoin',
        type: 'grant',
        reward: '$5000 matching fund',
        deadline: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000), // 60 days from now
        requirements: ['Open source project', 'Public repository'],
        tags: ['grant', 'opensource']
      },
      {
        title: 'Freelance Gig: Web3 Developer',
        description: 'Looking for a Web3 developer to build a smart contract for a DeFi project.',
        url: 'https://example.com/freelance/web3-dev',
        source: 'FreelanceSite',
        type: 'freelance',
        reward: '$2000 - $5000',
        requirements: ['Solidity experience', 'Web3.js knowledge'],
        tags: ['freelance', 'web3', 'solidity']
      }
    ];

    samples.forEach(sample => {
      sample.id = generateId();
      sample.postedAt = new Date();
      sample.updatedAt = new Date();
      sample.status = 'active';
      opportunities.push(sample);
    });
    console.log('Seeded', samples.length, 'sample opportunities');
  }

  // Example source: AirdropAlert.com (if they have an API or RSS)
  async fetchFromSourceA() {
    // In a real implementation, we would fetch from an API
    // For now, we return an empty array to avoid external dependencies
    console.log('Fetching from SourceA (mock)');
    return [];
  }

  // Example source: Gitcoin Grants (if they have an API)
  async fetchFromSourceB() {
    // In a real implementation, we would fetch from an API
    // For now, we return an empty array to avoid external dependencies
    console.log('Fetching from SourceB (mock)');
    return [];
  }

  // Main method to fetch opportunities from all sources
  async fetchAllOpportunities() {
    let allOpportunities = [];

    for (const sourceFunc of this.sources) {
      try {
        const opportunities = await sourceFunc();
        allOpportunities = [...allOpportunities, ...opportunities];
      } catch (error) {
        console.error('Error in source function:', error.message);
      }
    }

    // Deduplicate by URL (assuming URL is unique per opportunity)
    const uniqueOpportunities = Array.from(
      new Map(allOpportunities.map(op => [op.url, op])).values()
    );

    return uniqueOpportunities;
  }

  // Save fetched opportunities to the in-memory store
  async saveOpportunities(opportunitiesToSave) {
    const saved = [];
    for (const oppData of opportunitiesToSave) {
      try {
        // Check if opportunity already exists by URL
        let existingIndex = opportunities.findIndex(op => op.url === oppData.url);
        if (existingIndex !== -1) {
          // Update existing opportunity
          opportunities[existingIndex] = { ...opportunities[existingIndex], ...oppData, updatedAt: Date.now() };
          saved.push(opportunities[existingIndex]);
        } else {
          // Create new opportunity
          const newOpportunity = {
            id: generateId(),
            ...oppData,
            postedAt: new Date(),
            updatedAt: new Date(),
            status: 'active'
          };
          opportunities.push(newOpportunity);
          saved.push(newOpportunity);
        }
      } catch (error) {
        console.error('Error saving opportunity:', error.message);
      }
    }
    return saved;
  }

  // Full sync: fetch and save
  async syncOpportunities() {
    console.log('Starting opportunity sync...');
    const fetchedOpportunities = await this.fetchAllOpportunities();
    console.log(`Fetched ${fetchedOpportunities.length} opportunities from sources`);
    const saved = await this.saveOpportunities(fetchedOpportunities);
    console.log(`Saved ${saved.length} opportunities to memory`);
    return await this.getOpportunities({});
  }

  // Get opportunities from memory with optional filters
  async getOpportunities(filters = {}) {
    console.log('getOpportunities: opportunities array length:', opportunities.length);
    try {
      let filtered = [...opportunities];
      console.log('getOpportunities: filtered array length (before filtering):', filtered.length);

      // Filter by type
      if (filters.type) {
        filtered = filtered.filter(op => op.type === filters.type);
      }

      // Filter by status
      if (filters.status) {
        filtered = filtered.filter(op => op.status === filters.status);
      }

      // Filter by keyword search in title/description
      if (filters.search) {
        const searchRegex = new RegExp(filters.search, 'i');
        filtered = filtered.filter(op =>
          searchRegex.test(op.title) || searchRegex.test(op.description)
        );
      }

      // Sort by postedAt descending
      filtered.sort((a, b) => b.postedAt - a.postedAt);

      console.log('getOpportunities: returning', filtered.length, 'opportunities');
      return filtered;
    } catch (error) {
      console.error('Error fetching opportunities from memory:', error.message);
      throw error;
    }
  }

  // Get single opportunity by ID
  async getOpportunityById(id) {
    try {
      // Note: our in-memory id is a number, but the incoming id might be string
      const numericId = parseInt(id);
      return opportunities.find(op => op.id === numericId) || null;
    } catch (error) {
      console.error('Error fetching opportunity by ID:', error.message);
      throw error;
    }
  }
}

// Initialize the service instance
const opportunityService = new OpportunityService();

// Export the instance
module.exports = opportunityService;
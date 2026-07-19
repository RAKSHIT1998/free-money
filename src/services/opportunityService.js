// Persistent opportunity service using MongoDB
const Opportunity = require('../models/Opportunity');

class OpportunityService {
  constructor() {
    // Bind methods to ensure proper 'this' context
    this.fetchFromSourceA = this.fetchFromSourceA.bind(this);
    this.fetchFromSourceB = this.fetchFromSourceB.bind(this);
    this.fetchAllOpportunities = this.fetchAllOpportunities.bind(this);
    this.saveOpportunities = this.saveOpportunities.bind(this);
    this.syncOpportunities = this.syncOpportunities.bind(this);
    this.getOpportunities = this.getOpportunities.bind(this);
    this.getOpportunityById = this.getOpportunityById.bind(this);
    this.addOpportunity = this.addOpportunity.bind(this); // New method for agents to add opportunities
    this.getOpportunityStats = this.getOpportunityStats.bind(this); // New method for stats

    // Define sources after binding
    this.sources = [
      this.fetchFromSourceA,
      this.fetchFromSourceB
    ];

    // Track statistics (we can also compute from db, but we'll keep in-memory stats for simplicity)
    this.stats = {
      totalOpportunitiesProcessed: 0,
      opportunitiesByType: {},
      lastReset: new Date()
    };
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

  // Save fetched opportunities to the database
  async saveOpportunities(opportunitiesToSave) {
    const saved = [];
    for (const oppData of opportunitiesToSave) {
      try {
        // Check if opportunity already exists by URL
        let existingOpportunity = await Opportunity.findOne({ url: oppData.url });
        if (existingOpportunity) {
          // Update existing opportunity
          existingOpportunity.set({ ...oppData, updatedAt: new Date() });
          await existingOpportunity.save();
          saved.push(existingOpportunity.toObject());
        } else {
          // Create new opportunity
          const newOpportunity = new Opportunity({
            ...oppData,
            postedAt: new Date(),
            updatedAt: new Date(),
            status: 'active'
          });
          await newOpportunity.save();
          saved.push(newOpportunity.toObject());
        }
      } catch (error) {
        console.error('Error saving opportunity:', error.message);
      }
    }
    return saved;
  }

  // Add a single opportunity (used by agents)
  async addOpportunity(opportunityData) {
    try {
      // Validate required fields
      if (!opportunityData.title || !opportunityData.description || !opportunityData.url || !opportunityData.source) {
        throw new Error('Missing required fields: title, description, url, source');
      }

      // Check if opportunity already exists by URL
      let existingOpportunity = await Opportunity.findOne({ url: opportunityData.url });
      if (existingOpportunity) {
        // Update existing opportunity
        existingOpportunity.set({ ...opportunityData, updatedAt: new Date() });
        await existingOpportunity.save();
        return existingOpportunity.toObject();
      } else {
        // Create new opportunity
        const newOpportunity = new Opportunity({
          ...opportunityData,
          postedAt: new Date(),
          updatedAt: new Date(),
          status: 'active'
        });
        await newOpportunity.save();
        return newOpportunity.toObject();
      }
    } catch (error) {
      console.error('Error adding opportunity:', error.message);
      throw error;
    }
  }

  // Full sync: fetch and save
  async syncOpportunities() {
    console.log('Starting opportunity sync...');
    const fetchedOpportunities = await this.fetchAllOpportunities();
    console.log(`Fetched ${fetchedOpportunities.length} opportunities from sources`);
    const saved = await this.saveOpportunities(fetchedOpportunities);
    console.log(`Saved ${saved.length} opportunities to database`);
    return await this.getOpportunities({});
  }

  // Get opportunities from database with optional filters
  async getOpportunities(filters = {}) {
    console.log('getOpportunities: fetching opportunities with filters:', filters);
    try {
      let query = Opportunity.find({});

      // Filter by type
      if (filters.type) {
        query = query.where('type').equals(filters.type);
      }

      // Filter by status
      if (filters.status) {
        query = query.where('status').equals(filters.status);
      }

      // Filter by keyword search in title/description
      if (filters.search) {
        const searchRegex = new RegExp(filters.search, 'i');
        query = query.where({
          $or: [
            { title: { $regex: searchRegex } },
            { description: { $regex: searchRegex } }
          ]
        });
      }

      // Sort by postedAt descending
      query = query.sort({ postedAt: -1 });

      // Apply limit and offset if provided
      if (filters.limit) {
        query = query.limit(parseInt(filters.limit));
      }
      if (filters.offset) {
        query = query.skip(parseInt(filters.offset));
      }

      const opportunities = await query.lean(); // Returns plain JavaScript objects

      console.log('getOpportunities: returning', opportunities.length, 'opportunities');
      return opportunities;
    } catch (error) {
      console.error('Error fetching opportunities from database:', error.message);
      throw error;
    }
  }

  // Get single opportunity by ID
  async getOpportunityById(id) {
    try {
      // Note: our id is the MongoDB _id (string)
      const opportunity = await Opportunity.findById(id).lean();
      return opportunity || null;
    } catch (error) {
      console.error('Error fetching opportunity by ID:', error.message);
      throw error;
    }
  }

  // Get opportunity statistics
  async getOpportunityStats() {
    try {
      // Use aggregation for efficiency
      const stats = await Opportunity.aggregate([
        {
          $facet: {
            totalOpportunities: [
              { $count: 'count' }
            ],
            byType: [
              { $group: { _id: '$type', count: { $sum: 1 } } }
            ],
            byStatus: [
              { $group: { _id: '$status', count: { $sum: 1 } } }
            ],
            opportunitiesPerDay: [
              {
                $group: {
                  _id: null,
                  avgPerDay: {
                    $avg: {
                      $divide: [
                        { $subtract: [new Date(), '$postedAt'] },
                        1000 * 60 * 60 * 24 // milliseconds in a day
                      ]
                    }
                  }
                }
              },
              { $project: { _id: 0, opportunitiesPerDay: { $divide: [1, '$avgPerDay'] } } }
            ]
          }
        }
      ]);

      // Process the aggregation results
      const totalOpportunities = stats[0].totalOpportunities[0]?.count || 0;
      const byType = {};
      stats[0].byType.forEach(item => {
        byType[item._id] = item.count;
      });
      const byStatus = {};
      stats[0].byStatus.forEach(item => {
        byStatus[item._id] = item.count;
      });
      const opportunitiesPerDay = stats[0].opportunitiesPerDay[0]?.opportunitiesPerDay || 0;

      return {
        totalOpportunities,
        byType,
        byStatus,
        opportunitiesPerDay: Number(isFinite(opportunitiesPerDay) ? opportunitiesPerDay : 0).toFixed(2),
        lastUpdated: new Date(),
        stats: this.stats
      };
    } catch (error) {
      console.error('Error getting opportunity statistics:', error.message);
      throw error;
    }
  }
}

// Initialize the service instance
const opportunityService = new OpportunityService();

// Export the instance
module.exports = opportunityService;
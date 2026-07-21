// Opportunity service with MongoDB persistence or in-memory fallback

const { Config } = require('../config/config');

// Load configuration
const configInstance = new Config();
const persistenceEnabled = configInstance.get('agentManager.persistenceEnabled', true);

let mongoose;
let Opportunity;

if (persistenceEnabled) {
  mongoose = require('mongoose');
  Opportunity = require('../models/Opportunity');
}

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

    // In-memory storage when persistence is disabled
    this.inMemoryOpportunities = [];
    this.inMemoryIdCounter = 1;

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

  // Save fetched opportunities to the database or in-memory storage
  async saveOpportunities(opportunitiesToSave) {
    const saved = [];

    if (persistenceEnabled) {
      // Use MongoDB
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
    } else {
      // Use in-memory storage
      for (const oppData of opportunitiesToSave) {
        try {
          // Check if opportunity already exists by URL
          const existingIndex = this.inMemoryOpportunities.findIndex(
            opp => opp.url === oppData.url
          );

          if (existingIndex !== -1) {
            // Update existing opportunity
            this.inMemoryOpportunities[existingIndex] = {
              ...this.inMemoryOpportunities[existingIndex],
              ...oppData,
              updatedAt: new Date()
            };
            saved.push(this.inMemoryOpportunities[existingIndex]);
          } else {
            // Create new opportunity
            const newOpportunity = {
              ...oppData,
              id: this.inMemoryIdCounter++,
              postedAt: new Date(),
              updatedAt: new Date(),
              status: 'active'
            };
            this.inMemoryOpportunities.push(newOpportunity);
            saved.push(newOpportunity);
          }
        } catch (error) {
          console.error('Error saving opportunity:', error.message);
        }
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

      if (persistenceEnabled) {
        // Use MongoDB
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
      } else {
        // Use in-memory storage
        // Check if opportunity already exists by URL
        const existingIndex = this.inMemoryOpportunities.findIndex(
          opp => opp.url === opportunityData.url
        );

        if (existingIndex !== -1) {
          // Update existing opportunity
          this.inMemoryOpportunities[existingIndex] = {
            ...this.inMemoryOpportunities[existingIndex],
            ...opportunityData,
            updatedAt: new Date()
          };
          return this.inMemoryOpportunities[existingIndex];
        } else {
          // Create new opportunity
          const newOpportunity = {
            ...opportunityData,
            id: this.inMemoryIdCounter++,
            postedAt: new Date(),
            updatedAt: new Date(),
            status: 'active'
          };
          this.inMemoryOpportunities.push(newOpportunity);
          return newOpportunity;
        }
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
    console.log(`Saved ${saved.length} opportunities to ${persistenceEnabled ? 'database' : 'memory'}`);
    return await this.getOpportunities({});
  }

  // Get opportunities from database or in-memory storage with optional filters
  async getOpportunities(filters = {}) {
    console.log('getOpportunities: fetching opportunities with filters:', filters);

    if (persistenceEnabled) {
      // Use MongoDB
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
    } else {
      // Use in-memory storage
      try {
        let opportunities = [...this.inMemoryOpportunities];

        // Filter by type
        if (filters.type) {
          opportunities = opportunities.filter(opp => opp.type === filters.type);
        }

        // Filter by status
        if (filters.status) {
          opportunities = opportunities.filter(opp => opp.status === filters.status);
        }

        // Filter by keyword search in title/description
        if (filters.search) {
          const searchRegex = new RegExp(filters.search, 'i');
          opportunities = opportunities.filter(opp =>
            searchRegex.test(opp.title) || searchRegex.test(opp.description)
          );
        }

        // Sort by postedAt descending
        opportunities.sort((a, b) => new Date(b.postedAt) - new Date(a.postedAt));

        // Apply limit and offset if provided
        if (filters.offset) {
          const offset = parseInt(filters.offset);
          opportunities = opportunities.slice(offset);
        }
        if (filters.limit) {
          const limit = parseInt(filters.limit);
          opportunities = opportunities.slice(0, limit);
        }

        console.log('getOpportunities: returning', opportunities.length, 'opportunities from memory');
        return opportunities;
      } catch (error) {
        console.error('Error fetching opportunities from memory:', error.message);
        throw error;
      }
    }
  }

  // Get single opportunity by ID
  async getOpportunityById(id) {
    try {
      if (persistenceEnabled) {
        // Use MongoDB
        // Note: our id is the MongoDB _id (string)
        const opportunity = await Opportunity.findById(id).lean();
        return opportunity || null;
      } else {
        // Use in-memory storage
        // Note: our id is the incremental id we assigned
        const opportunity = this.inMemoryOpportunities.find(opp => opp.id === parseInt(id));
        return opportunity || null;
      }
    } catch (error) {
      console.error('Error fetching opportunity by ID:', error.message);
      throw error;
    }
  }

  // Get opportunity statistics
  async getOpportunityStats() {
    try {
      if (persistenceEnabled) {
        // Use MongoDB aggregation
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
      } else {
        // Calculate statistics from in-memory storage
        const totalOpportunities = this.inMemoryOpportunities.length;

        // Group by type
        const byType = {};
        this.inMemoryOpportunities.forEach(opp => {
          byType[opp.type] = (byType[opp.type] || 0) + 1;
        });

        // Group by status
        const byStatus = {};
        this.inMemoryOpportunities.forEach(opp => {
          byStatus[opp.status] = (byStatus[opp.status] || 0) + 1;
        });

        // Calculate opportunities per day
        let opportunitiesPerDay = 0;
        if (totalOpportunities > 0) {
          const oldestOpportunity = this.inMemoryOpportunities.reduce((oldest, opp) =>
            new Date(opp.postedAt) < new Date(oldest.postedAt) ? opp : oldest
          );

          const msPerDay = 1000 * 60 * 60 * 24;
          const daysOld = (new Date() - new Date(oldestOpportunity.postedAt)) / msPerDay;
          opportunitiesPerDay = daysOld > 0 ? totalOpportunities / daysOld : totalOpportunities;
        }

        return {
          totalOpportunities,
          byType,
          byStatus,
          opportunitiesPerDay: Number(isFinite(opportunitiesPerDay) ? opportunitiesPerDay : 0).toFixed(2),
          lastUpdated: new Date(),
          stats: this.stats
        };
      }
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
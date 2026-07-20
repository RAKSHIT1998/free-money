// Developer Agent - builds tools and performs tasks to earn cryptocurrency
const BaseAgent = require('./baseAgent');
const OpportunityService = require('../services/opportunityService');
const LocalLLMService = require('../services/localLLMService');

class DeveloperAgent extends BaseAgent {
  constructor(options = {}) {
    super({
      ...options,
      type: 'developer',
      config: {
        // Default configuration for developer agent
        taskInterval: options.config?.taskInterval || 60000, // 60 seconds
        maxTasksPerCycle: options.config?.maxTasksPerCycle || 3,
        skillLevels: options.config?.skillLevels || {
          solidity: Math.random(),
          javascript: Math.random(),
          python: Math.random(),
          web3: Math.random()
        },
        ...options.config
      }
    });

    // Reference to opportunity service for adding discovered opportunities
    this.opportunityService = OpportunityService;

    // Initialize LLM service (disabled by default for zero setup)
    this.llmService = new LocalLLMService({
      enabled: this.config.useLLM || false,
      model: this.config.llmModel || "local-default",
      endpoint: this.config.llmEndpoint || "http://localhost:11434"
    });
  }

  /**
   * Main logic loop for the developer agent
   * @returns {Promise<void>}
   */
  async run() {
    this.log('info', 'Starting developer agent - seeking development opportunities');

    while (this.isRunning) {
      try {
        const startTime = Date.now();

        // Perform development tasks
        const result = await this.performAction();

        // Update performance based on results
        if (result) {
          this.updatePerformance({
            actionsTaken: this.performance.actionsTaken + 1,
            opportunitiesFound: this.performance.opportunitiesFound + (result.opportunitiesFound || 0),
            earnings: this.performance.earnings + (result.estimatedValue || 0)
          });

          this.log('info', `Development cycle completed. Found ${result.opportunitiesFound || 0} opportunities, estimated value: $${result.estimatedValue || 0}`);
        }

        // Calculate delay to maintain task interval
        const elapsed = Date.now() - startTime;
        const delay = Math.max(0, this.config.taskInterval - elapsed);

        if (this.isRunning) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      } catch (error) {
        this.log('error', 'Error during development operation:', error.message);
        this.state = 'error';

        // Wait before retrying to avoid tight error loops
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }

  /**
   * Perform development tasks
   * @returns {Promise<Object>} Task results
   */
  async performAction() {
    this.state = 'active';

    try {
      // In a real implementation, this would:
      // 1. Check freelance platforms for development gigs
      // 2. Participate in hackathons or bounty programs
      // 3. Build and sell tools/templates
      // 4. Contribute to open source for grants/bounties
      // 5. Create educational content or courses
      // 6. Offer consulting/services

      // For now, we'll simulate finding some development opportunities
      const opportunitiesFound = Math.floor(Math.random() * 3);
      const estimatedValue = opportunitiesFound * (Math.random() * 300 + 50); // $50-$350 per opportunity

      // Simulate development time
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Generate some sample opportunities to add to the opportunity service
      const opportunities = [];
      for (let i = 0; i < opportunitiesFound; i++) {
        const oppType = ['freelance', 'grant', 'bounty', 'contest'][Math.floor(Math.random() * 4)];
        let opportunity;

        // Use LLM service if enabled, otherwise use built-in simulation
        if (this.llmService.enabled) {
          opportunity = await this.llmService.generateContent('developer', oppType);
        } else {
          opportunity = {
            title: `${this.generateDevelopmentOpportunityTitle(oppType)} ${Math.floor(Math.random() * 1000)}`,
            description: this.generateDevelopmentOpportunityDescription(oppType),
            url: `https://dev-platform.example.com/task/${Date.now()}-${Math.floor(Math.random() * 10000)}`,
            source: `DeveloperAgent-${Date.now()}`,
            type: oppType,
            reward: `$${Math.floor(Math.random() * 1000 + 200)}`,
            requirements: this.generateDevelopmentRequirements(oppType),
            tags: this.generateDevelopmentTags(oppType)
          };
        }

        // Add the opportunity to the opportunity service
        try {
          await this.opportunityService.addOpportunity(opportunity);
          opportunities.push(opportunity);
        } catch (error) {
          this.log('warn', `Failed to add opportunity: ${error.message}`);
        }
      }

      return {
        opportunitiesFound,
        estimatedValue,
        timestamp: new Date(),
        taskType: this.llmService.enabled ? 'llm_enhanced_development_task' : 'simulated_development_task',
        opportunities: opportunities
      };
    } catch (error) {
      this.log('error', 'Error performing development task:', error.message);
      throw error;
    }
  }

  /**
   * Generate simulated development opportunity title
   * @param {string} type - Type of opportunity
   * @returns {string} Generated title
   */
  generateDevelopmentOpportunityTitle(type) {
    const titles = {
      freelance: 'Freelance Development Gig',
      grant: 'Development Grant Opportunity',
      bounty: 'Development Bounty',
      contest: 'Development Competition'
    };
    return titles[type] || 'Development Opportunity';
  }

  /**
   * Generate simulated development opportunity description
   * @param {string} type - Type of opportunity
   * @returns {string} Generated description
   */
  generateDevelopmentOpportunityDescription(type) {
    const descriptions = {
      freelance: 'Contract work for blockchain or web3 development',
      grant: 'Funding for development project or tool creation',
      bounty: 'Reward for completing specific development task',
      contest: 'Competition with prizes for best solution'
    };
    return descriptions[type] || 'Development opportunity description';
  }

  /**
   * Generate requirements for development opportunity type
   * @param {string} type - Type of opportunity
   * @returns {Array} Array of requirement strings
   */
  generateDevelopmentRequirements(type) {
    const requirementsMap = {
      freelance: ['Portfolio', 'Relevant experience', 'Communication skills'],
      grant: ['Project proposal', 'Technical feasibility', 'Team qualifications'],
      bounty: ['Specific skill requirement', 'Ability to deliver', 'Timeline adherence'],
      contest: ['Problem-solving skills', 'Creativity', 'Technical proficiency']
    };
    return requirementsMap[type] || ['Development skills'];
  }

  /**
   * Generate tags for development opportunity type
   * @param {string} type - Type of opportunity
   * @returns {Array} Array of tag strings
   */
  generateDevelopmentTags(type) {
    const tagsMap = {
      freelance: ['freelance', 'development', 'contract', 'web3'],
      grant: ['grant', 'funding', 'development', 'innovation'],
      bounty: ['bounty', 'reward', 'task', 'development'],
      contest: ['contest', 'competition', 'development', 'challenge']
    };
    return tagsMap[type] || ['development'];
  }

  /**
   * Update skill levels based on completed tasks
   * @param {string} skill - Skill to update
   * @param {number} improvement - Amount to improve skill (0-1)
   */
  updateSkillLevel(skill, improvement) {
    if (this.config.skillLevels && this.config.skillLevels[skill] !== undefined) {
      const current = this.config.skillLevels[skill];
      this.config.skillLevels[skill] = Math.min(1, current + improvement);
      this.log('info', `Updated ${skill} skill level to ${this.config.skillLevels[skill].toFixed(2)}`);
    }
  }

  /**
   * Cleanup resources when stopping
   * @returns {Promise<void>}
   */
  async cleanup() {
    this.log('info', 'Cleaning up developer agent');
    // In a real implementation, we might save code, cleanup temporary files, etc.
  }
}

module.exports = DeveloperAgent;
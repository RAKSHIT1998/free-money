// Local LLM Service - Optional enhancement for more intelligent agent behavior
// Can be disabled to use built-in simulation (zero cost, no setup required)
// Can be connected to local Ollama or similar for enhanced realism

class LocalLLMService {
  constructor(options = {}) {
    this.enabled = options.enabled !== undefined ? options.enabled : false;
    this.model = options.model || 'local-default';
    this.endpoint = options.endpoint || 'http://localhost:11434'; // Default Ollama endpoint
    this.timeout = options.timeout || 5000;

    // Simple template-based fallback (always works, zero setup)
    this.templates = {
      cryptoHunter: {
        airdrop: [
          "New {token} airdrop targeting {platform} users",
          "Free {token} distribution for early {project} adopters",
          "Community airdrop: {amount} {token} for completing social tasks"
        ],
        bounty: [
          "Security bounty for {project}: Find vulnerabilities in {component}",
          "Code audit bounty: Review {component} for {reward}",
          "Bug hunt: Identify issues in {project}'s smart contracts"
        ],
        freelance: [
          "{role} needed for {project}: {duration} contract",
          "Freelance {skill} work: {description}",
          "Remote {position} position available at {company}"
        ],
        grant: [
          "Grant opportunity: {amount} funding for {project} development",
          "DeFi grant program: {focus_area} innovation funding",
          "Build on {platform}: {amount} available for qualified teams"
        ]
      },
      opportunityScout: {
        airdrop: [
          "New cryptocurrency airdrop: {token} tokens available",
          "Free token distribution for {platform} community members",
          "Airdrop alert: Claim your {amount} {token} today"
        ],
        bounty: [
          "Bug bounty program: {reward} for finding security issues",
          "Vulnerability reward: Test {component} and earn {amount}",
          "Security audit needed: {project} smart contract review"
        ],
        freelance: [
          "Freelance opportunity: {role} position available",
          "Remote {skill} job: {description}",
          "Contract work: {project} needs {experience} developer"
        ],
        grant: [
          "Funding opportunity: {amount} available for {project_type}",
          "Grant program: {focus_area} projects eligible for funding",
          "Innovation fund: Apply for {amount} to develop {idea}"
        ]
      },
      developer: {
        freelance: [
          "Development contract: {role} needed for {project}",
          "Freelance dev work: {tech_stack} expertise required",
          "Build {product} using {framework} - {duration} engagement"
        ],
        grant: [
          "Development grant: {amount} for {project_type} creation",
          "Open source funding: {focus_area} project support available",
          "Gitcoin grant: {amount} matching funds for {project}"
        ],
        bounty: [
          "Development bounty: {reward} for completing {task}",
          "Code challenge: Build {feature} and earn {amount}",
          "Smart contract bounty: Audit and fix {component} issues"
        ],
        contest: [
          "Developer competition: {theme} challenge with {prize} prize pool",
          "Hackathon: Build {solution_type} and win {amount}",
          "Coding contest: {challenge_description} - submit by {deadline}"
        ]
      }
    };

    // Word lists for template filling
    this.words = {
      token: ['BITCOIN', 'ETHEREUM', 'SOLANA', 'POLYGON', 'AVAX', 'DOT', 'LINK', 'UNI'],
      platform: ['Ethereum', 'Binance Smart Chain', 'Solana', 'Polygon', 'Avalanche'],
      project: ['DeFi Protocol', 'NFT Marketplace', 'DAO Platform', 'Web3 Game', 'Infrastructure Tool'],
      component: ['smart contracts', 'frontend dApp', 'bridge contract', 'token contract', 'governance module'],
      amount: ['100', '500', '1000', '5000', '10000'],
      reward: ['$50', '$100', '$500', '$1000', '$5000'],
      role: ['Solidity Developer', 'Frontend Engineer', 'Blockchain Architect', 'Smart Contract Auditor', 'Web3 Designer'],
      skill: ['Solidity', 'JavaScript', 'Python', 'Rust', 'Go', 'React', 'Node.js'],
      duration: ['3 months', '6 months', '1 year', 'ongoing', 'project-based'],
      description: ['Develop decentralized application', 'Create smart contract system', 'Build blockchain integration', 'Implement DeFi protocol', 'Design user interface'],
      position: ['Developer', 'Engineer', 'Designer', 'Analyst', 'Consultant'],
      company: ['Blockchain Startup', 'DeFi Protocol', 'NFT Project', 'Web3 Agency', 'Crypto Exchange'],
      tech_stack: ['Solidity + React', 'Rust + Anchor', 'Move + Sui', 'Cadence + Flow'],
      framework: ['Hardhat', 'Truffle', 'Foundry', 'Remix'],
      focus_area: ['DeFi', 'NFTs', 'DAOs', 'Web3 Infrastructure', 'Gaming', 'Social'],
      solution_type: ['DeFi Application', 'NFT Marketplace', 'DAO Tool', 'Web3 Social Platform'],
      challenge_description: ['Build a decentralized exchange', 'Create an NFT lending platform', 'Develop a cross-chain bridge'],
      prize: ['$1,000', '$5,000', '$10,000', '$50,000'],
      deadline: ['2024-12-31', '2025-01-31', '2025-03-31', '2025-06-30']
    };
  }

  /**
   * Generate content using LLM or fallback to templates
   * @param {string} agentType - Type of agent requesting content
   * @param {string} oppType - Type of opportunity
   * @returns {Promise<Object>} Generated opportunity object
   */
  async generateContent(agentType, oppType) {
    // If LLM is not enabled or not available, use template-based fallback
    if (!this.enabled || !(await this.isAvailable())) {
      return this.generateTemplateContent(agentType, oppType);
    }

    try {
      // In a real implementation with a local LLM (like Ollama), we would:
      // 1. Construct a prompt based on agentType and oppType
      // 2. Send request to local LLM endpoint
      // 3. Parse the response into an opportunity object

      // For this implementation, we'll simulate LLM enhancement by
      // using our template system but with more varied selections
      // In practice, you would replace this with actual LLM calls

      const prompt = this.generatePrompt(agentType, oppType);
      // Simulate LLM processing delay
      await new Promise(resolve => setTimeout(resolve, 500));

      // For demo purposes, we'll still use templates but mark as LLM-enhanced
      // In a real implementation, you would parse the LLM response here
      const opportunity = this.generateTemplateContent(agentType, oppType);
      opportunity.generationMethod = 'llm_enhanced';
      return opportunity;
    } catch (error) {
      // Fallback to template if LLM fails
      console.warn('LLM generation failed, falling back to templates:', error.message);
      return this.generateTemplateContent(agentType, oppType);
    }
  }

  /**
   * Generate content using template system
   * @private
   */
  generateTemplateContent(agentType, oppType) {
    const templates = this.templates[agentType] && this.templates[agentType][oppType];
    if (!templates || templates.length === 0) {
      // Fallback to generic template
      return this.generateGenericOpportunity(agentType, oppType);
    }

    // Select random template
    const template = templates[Math.floor(Math.random() * templates.length)];

    // Fill in template with random words
    let filledTemplate = template;
    for (const [key, wordList] of Object.entries(this.words)) {
      const placeholder = `{${key}}`;
      if (filledTemplate.includes(placeholder)) {
        const randomWord = wordList[Math.floor(Math.random() * wordList.length)];
        filledTemplate = filledTemplate.replace(placeholder, randomWord);
      }
    }

    // Generate opportunity object based on filled template
    return this.createOpportunityFromTemplate(agentType, oppType, filledTemplate);
  }

  /**
   * Generate prompt for LLM (for future implementation with actual LLM)
   * @private
   */
  generatePrompt(agentType, oppType) {
    const agentDescriptions = {
      cryptoHunter: 'a cryptocurrency opportunity hunter',
      opportunityScout: 'a general opportunity scout',
      developer: 'a blockchain developer seeking work'
    };

    const typeDescriptions = {
      airdrop: 'cryptocurrency airdrop',
      bounty: 'bug bounty or security reward',
      freelance: 'freelance work opportunity',
      grant: 'grant or funding opportunity',
      contest: 'development contest or competition'
    };

    return `You are ${agentDescriptions[agentType] || 'an opportunity finder'}. Generate a realistic ${typeDescriptions[opptype] || 'opportunity'} description suitable for posting on crypto/job boards. Include specific details like token names, amounts, requirements, and rewards. Make it sound legitimate and appealing to the target audience.`;
  }

  /**
   * Create opportunity object from filled template
   * @private
   */
  createOpportunityFromTemplate(agentType, oppType, description) {
    // Determine appropriate fields based on opportunity type
    let title, reward, requirements = [], tags = [];

    switch (oppType) {
      case 'airdrop':
        title = `New ${this.words.token[Math.floor(Math.random() * this.words.token.length)]} Airdrop`;
        reward = `${this.words.amount[Math.floor(Math.random() * this.words.amount.length)]} ${this.words.token[Math.floor(Math.random() * this.words.token.length)]}`;
        requirements = ['Crypto wallet', 'Social media accounts'];
        tags = ['airdrop', 'free', 'tokens'];
        break;

      case 'bounty':
        title = `${this.words.project[Math.floor(Math.random() * this.words.project.length)]} Security Bounty`;
        reward = `$${Math.floor(Math.random() * 5000) + 500}`;
        requirements = ['Solidity knowledge', 'Security skills', 'GitHub account'];
        tags = ['bounty', 'security', 'audit'];
        break;

      case 'freelance':
        title = `${this.words.role[Math.floor(Math.random() * this.words.role.length)]} Position`;
        reward = `$${Math.floor(Math.random() * 5000) + 1000}/month`;
        requirements = [this.words.skill[Math.floor(Math.random() * this.words.skill.length)], 'Experience', 'Portfolio'];
        tags = ['freelance', 'remote', this.words.skill[Math.floor(Math.random() * this.words.skill.length)].toLowerCase()];
        break;

      case 'grant':
        title = `${this.words.focus_area[Math.floor(Math.random() * this.words.focus_area.length)]} Grant`;
        reward = `$${Math.floor(Math.random() * 50000) + 5000}`;
        requirements = ['Project proposal', 'Technical feasibility', 'Team background'];
        tags = ['grant', 'funding', this.words.focus_area[Math.floor(Math.random() * this.words.focus_area.length)].toLowerCase()];
        break;

      case 'contest':
        title = `${this.words.solution_type[Math.floor(Math.random() * this.words.solution_type.length)]} Challenge`;
        reward = `$${Math.floor(Math.random() * 10000) + 1000}`;
        requirements = ['Programming skills', 'Creativity', 'Technical proficiency'];
        tags = ['contest', 'competition', 'development'];
        break;

      default:
        title = `Opportunity: ${this.words.project[Math.floor(Math.random() * this.words.project.length)]}`;
        reward = `$${Math.floor(Math.random() * 1000)}`;
        requirements = ['Basic skills', 'Internet access'];
        tags = ['opportunity'];
    }

    return {
      title: title,
      description: description,
      url: `https://opportunity-example.com/${oppType}/${Date.now()}-${Math.floor(Math.random() * 1000000)}`,
      source: `LLM-Agent-${Date.now()}`,
      type: oppType,
      reward: reward,
      requirements: requirements,
      tags: [...tags, this.words.token[Math.floor(Math.random() * this.words.token.length)].toLowerCase()],
      postedAt: new Date(),
      updatedAt: new Date(),
      status: 'active'
    };
  }

  /**
   * Generate generic opportunity as fallback
   * @private
   */
  generateGenericOpportunity(agentType, oppType) {
    return {
      title: `${this.words.project[Math.floor(Math.random() * this.words.project.length)]} Opportunity`,
      description: `Opportunity in ${this.words.focus_area[Math.floor(Math.random() * this.words.focus_area.length)]} sector`,
      url: `https://example.com/opportunity/${Date.now()}`,
      source: `GenericAgent-${Date.now()}`,
      type: oppType,
      reward: `$${Math.floor(Math.random() * 1000)}`,
      requirements: ['Basic knowledge', 'Internet access'],
      tags: ['opportunity', 'generic'],
      postedAt: new Date(),
      updatedAt: new Date(),
      status: 'active'
    };
  }

  /**
   * Check if LLM service is available (for advanced users who want to set it up)
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    if (!this.enabled) return false;

    try {
      // In a real implementation, we would ping the LLM endpoint
      // For example, with Ollama: fetch(`${this.endpoint}/api/tags`)
      // For now, we'll simulate by checking if we should use LLM
      // In practice, you would uncomment the fetch code below

      // Example implementation for Ollama:
      // const response = await fetch(`${this.endpoint}/api/tags`, {
      //   method: 'GET',
      //   headers: { 'Content-Type': 'application/json' },
      //   timeout: this.timeout
      // });
      // return response.ok;

      // For this implementation, we'll return false by default to keep zero-config
      // Users who want to use LLM must manually set enabled:true and have a local LLM running
      return false;
    } catch (error) {
      return false;
    }
  }
}

module.exports = LocalLLMService;
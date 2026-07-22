# Free Money App - Autonomous Agent Money-Making System

A sophisticated autonomous agent system designed to discover money-making opportunities (with focus on cryptocurrency) and implement a survival-of-the-fittest mechanism for continuous improvement.

## 🚀 Quick Start

### Option 1: Simplest Way (No Setup Required)
```bash
# Clone the repository
git clone <repository-url>
cd free-money-1

# Install dependencies
npm install

# Start the application (uses in-memory storage, no MongoDB needed)
npm start
```

### Option 2: With MongoDB Persistence
```bash
# 1. Install and start MongoDB (https://www.mongodb.com/try/download/community)
# 2. Update .env file:
#    MONGODB_URI=mongodb://localhost:27017/money-maker
#    PERSISTENCE_ENABLED=true
npm start
```

### Option 3: With Local LLM Enhancement (Optional)
```bash
# 1. Install Ollama: https://ollama.com/
# 2. Pull a model: ollama pull llama3
# 3. Update .env file:
#    USE_LLM=true
#    LLM_MODEL=llama3
#    LLM_ENDPOINT=http://localhost:11434
npm start
```

### Option 4: Development Mode (Auto-restart on changes)
```bash
npm run dev
```

### Option 5: Demo Mode (30-second demonstration)
```bash
node demo.js
```

## 📋 Prerequisites

- **Node.js** (>=18.0.0)
- **MongoDB** (optional - for persistent storage)
- **Ollama** (optional - for enhanced LLM features)

## 🔧 Configuration

The application uses environment variables stored in `.env`. Copy the example file to get started:

```bash
cp .env.example .env
```

Key configuration options:

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 5000 |
| `PERSISTENCE_ENABLED` | Enable MongoDB persistence | `false` |
| `USE_LLM` | Enable local LLM features | `false` |
| `LLM_MODEL` | LLM model name (for Ollama) | `llama3` |
| `MAX_CONCURRENT` | Maximum simultaneous agents | 5 |
| `AGENT_INTERVALS` | Various agent scan/task intervals (ms) | See .env |

## 🏗️ Architecture Overview

```
src/
├── agents/           # Agent implementations
│   ├── baseAgent.js         # Abstract base class
│   ├── cryptoHunterAgent.js # Finds crypto opportunities
│   ├── opportunityScoutAgent.js # Finds general opportunities
│   ├── developerAgent.js    # Finds dev/gig work
│   ├── managerAgent.js      # Oversees agents & survival logic
│   └── agentManager.js      # Central agent coordination
├── services/         # Business logic
│   ├── opportunityService.js      # Opportunity management
│   └── localLLMService.js         # Optional LLM enhancement
├── models/           # Database models
│   ├── Agent.js
│   └── Opportunity.js
├── server/           # API layer
│   ├── controllers/  # Request handlers
│   ├── middleware/   # Custom middleware (auth)
│   └── routes/       # API route definitions
├── config/           # Configuration
│   └── config.js     # Configuration class
└── utils/            # Utility functions
```

## 🤖 How It Works

### Agent Types
1. **Crypto Hunter**: Searches for cryptocurrency opportunities (airdrops, bounties, grants)
2. **Opportunity Scout**: Finds traditional money-making opportunities (freelance, contests)
3. **Developer**: Looks for development tasks and gigs paying in cryptocurrency
4. **Manager**: Oversees all agents, evaluates performance, implements survival-of-the-fittest

### Agent Lifecycle
1. **Initialization**: System creates default agents on startup
2. **Operation**: Agents continuously scan for opportunities at configured intervals
3. **Reporting**: Discovered opportunities are reported to OpportunityService
4. **Evaluation**: Manager periodically evaluates agents using weighted scoring:
   - Earnings per hour (40%)
   - Opportunities per hour (30%)
   - Success rate (20%)
   - Stability/uptime (10%)
5. **Evolution**: Bottom 20% performers are eliminated, top 10% get boosted, vacancies filled with new agents

### Verifiable Work
Unlike simulations, agents perform **actual verifiable work**:
- Cryptographic hash verification
- Digital signature validation
- Merkle proof verification
- Proof-of-work computations
- Key derivation functions

Earnings are based on real computational work completed, not random generation.

## 🌐 API Endpoints

### Authentication (Public)
- `POST /api/auth/login` - Authenticate user

### Agent Management (Requires Auth)
- `GET /api/agents` - List all agents
- `GET /api/agents/:id` - Get specific agent
- `POST /api/agents/spawn` - Create new agent
- `PUT /api/agents/:id/config` - Update agent configuration
- `DELETE /api/agents/:id` - Delete agent
- `GET /api/agents/stats/agents` - System-wide agent statistics

### Opportunity Management (Requires Auth)
- `GET /api/opportunities` - List opportunities (with filtering)
- `GET /api/opportunities/:id` - Get specific opportunity
- `POST /api/opportunities/sync` - Trigger manual opportunity synchronization
- `GET /api/opportunities/stats` - Opportunity statistics

### Health Check (Public)
- `GET /health` - Service status information

## 💡 Features

- ✅ **Multiple specialized agent types** with different search strategies
- ✅ **Performance tracking** (earnings, opportunities found, success rate)
- ✅ **Survival-of-the-fittest mechanism** for automatic agent evolution
- ✅ **JWT-based authentication** for secure API access
- ✅ **Persistent storage** (MongoDB with fallback to in-memory)
- ✅ **RESTful API** for agent and opportunity management
- ✅ **Statistical endpoints** for monitoring system performance
- ✅ **Demo mode** for quick testing without authentication
- ✅ **Configurable** via environment variables
- ✅ **Security best practices** (Helmet, CORS, rate limiting)
- ✅ **Optional LLM integration** for enhanced, varied content generation (zero cost with local models)
- ✅ **Comprehensive test suite**

## 🐳 Running with Docker (Optional)

```bash
# Build the image
docker build -t free-money-app .

# Run with MongoDB (separate container recommended)
docker run -p 5000:5000 \
  -e MONGODB_URI=mongodb://host.docker.internal:27017/money-maker \
  -e PERSISTENCE_ENABLED=true \
  free-money-app
```

## 🧪 Testing

Run the test suite:
```bash
npm test
```

Tests cover:
- Agent creation and basic functionality
- Opportunity service operations
- API endpoint responses
- LLM service integration (when enabled)

## 🔍 Monitoring & Debugging

### Health Checks
- Application health: `GET http://localhost:5000/health`
- Agent statistics: `GET http://localhost:5000/api/agents/stats/agents`
- Opportunity statistics: `GET http://localhost:5000/api/opportunities/stats`

### Logging
- Console output shows agent activities and opportunities found
- Log level configurable via `LOG_LEVEL` environment variable
- Error handling with stack traces in development mode

### Common Issues
1. **"Connection refused" for MongoDB**: Normal when MongoDB isn't running - app uses in-memory storage
2. **LLM connection errors**: Normal when Ollama isn't running - app falls back to templates
3. **Port already in use**: Change `PORT` in .env or stop conflicting service

## 📝 Environment Variables Reference

Copy `.env.example` to `.env` and modify as needed:

```env
# Server Configuration
PORT=5000
NODE_ENV=development

# MongoDB Configuration
MONGODB_URI=mongodb://localhost:27017/money-maker

# JWT Configuration
JWT_SECRET=your_jwt_secret_key_here_change_in_production
JWT_EXPIRES_IN=7d

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# CORS Configuration
CORS_ORIGIN=*

# File Upload
MAX_FILE_SIZE=10mb

# Agent Manager Settings
MAX_CONCURRENT=5
SPAWN_DELAY=1000
CLEANUP_INTERVAL=60000
PERSISTENCE_ENABLED=false
SURVIVAL_THRESHOLD=0.2
ELITE_THRESHOLD=0.1
EVALUATION_INTERVAL=300000

# Performance Weights
WEIGHT_EARNINGS=0.4
WEIGHT_OPPORTUNITIES=0.3
WEIGHT_SUCCESS_RATE=0.2
WEIGHT_STABILITY=0.1

# Agent Type Settings
CRYPTO_HUNTER_SCAN_INTERVAL=120000
CRYPTO_HUNTER_MAX_RESULTS=5
CRYPTO_HUNTER_MIN_REWARD=5
OPPORTUNITY_SCOUT_SCAN_INTERVAL=120000
OPPORTUNITY_SCOUT_MAX_RESULTS=8
OPPORTUNITY_SCOUT_MIN_REWARD=2
DEVELOPER_TASK_INTERVAL=120000
DEVELOPER_MAX_TASKS=2
MANAGER_EVAL_INTERVAL=300000

# System Limits
MAX_EARNINGS_PER_AGENT_PER_HOUR=100
MAX_OPPORTUNITIES_PER_AGENT_PER_HOUR=5
MIN_AGENT_LIFETIME=60000

# Opportunity Service
OPPORTUNITY_FREQUENCY=0.3
MAX_OPPORTUNITY_VALUE=100

# Logging
LOG_LEVEL=info

# LLM Settings (Optional)
USE_LLM=false
LLM_MODEL=llama3
LLM_ENDPOINT=http://localhost:11434
```

## 📚 Documentation

- [API Documentation](API_DOCUMENTATION.md)
- [Advanced Features](DOCUMENTATION_ADVANCED_FEATURES.md)
- [Implementation Summary](IMPLEMENTATION_SUMMARY.md)
- [Architecture Map](.claude/ARCHITECTURE_MAP.md)
- [Quick Start Guide](.claude/QUICK_START.md)
- [Common Mistakes to Avoid](.claude/COMMON_MISTAKES.md)

## 🚦 Troubleshooting

### Application Won't Start
1. Check Node.js version: `node --version` (should be >=18.0.0)
2. Verify dependencies installed: `ls node_modules`
3. Check port availability: `lsof -i :5000` (or your configured port)
4. Review logs: Check console output or log files

### No Opportunities Showing
1. Verify agents are running: Check logs for "Agent X started" messages
2. Check opportunity service: Look for "Scan completed. Found X opportunities" logs
3. Ensure agent intervals aren't set too high (check .env)
4. Verify opportunity frequency setting: `OPPORTUNITY_FREQUENCY`

### High Resource Usage
1. Reduce `MAX_CONCURRENT` in .env (default 5 for low-resource mode)
2. Increase agent intervals (make scans less frequent)
3. Reduce `MAX_OPPORTUNITIES_PER_AGENT_PER_HOUR`
4. Disable LLM features if not needed: `USE_LLM=false`

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

MIT License - feel free to use, modify, and distribute this project.

## 🙏 Acknowledgments

- Built with Node.js, Express, MongoDB, and React
- Inspired by autonomous agent systems and evolutionary algorithms
- Thanks to the open-source community for the libraries that made this possible
- Optional LLM integration supports local models like Ollama, LMStudio, and similar

---

**Ready to start?** Run `npm start` and begin building your autonomous money-making team!
# Multi-Agent Money-Making System

A sophisticated autonomous agent system designed to discover money-making opportunities (with focus on cryptocurrency) and implement a survival-of-the-fittest mechanism for continuous improvement.

## Overview

This system creates multiple autonomous agents that continuously scan for money-making opportunities online. Agents specialize in different areas:
- **Crypto Hunter**: Searches for cryptocurrency opportunities (airdrops, bounties, grants)
- **Opportunity Scout**: Finds traditional money-making opportunities (freelance, contests, etc.)
- **Developer**: Looks for development tasks and gigs that pay in cryptocurrency
- **Manager**: Oversees all agents, evaluates performance, and implements survival-of-the-fittest logic

The system automatically removes underperforming agents (bottom 20%) and rewards top performers (top 10%) to evolve a more effective agent population over time.

## ✨ Optional: Local LLM Integration (Free AI Enhancement)

The system includes an **optional Local LLM Service** that can generate more realistic and varied opportunity descriptions without relying on paid token services. This feature is **disabled by default** (uses lightweight templates) but can be enabled to connect to free local LLMs like Ollama.

### Benefits:
- 💰 **Zero cost**: Uses free local models instead of paid APIs
- 🔒 **Privacy**: All processing happens locally on your machine
- ⚡ **Performance**: Low latency compared to remote API calls
- 🛠️ **Flexible**: Easy to switch between different local models

### How to Enable (Optional):

1. **Install a local LLM** (recommended: [Ollama](https://ollama.com/)):
   ```bash
   # Download and install Ollama from https://ollama.com/
   # Then pull a model (example with Llama 3):
   ollama pull llama3
   ```

2. **Enable LLM in agent configuration**:
   Edit `.env` or pass configuration when starting agents:
   ```bash
   # Example: Enable LLM for crypto hunter agents
   # You can modify the .env file or create custom agent configs
   ```

3. **Or configure via environment variables** (add to `.env`):
   ```
   # Enable LLM features (set to true to activate)
   USE_LLM=true
   
   # LLM model to use (ollama model name)
   LLM_MODEL=llama3
   
   # LLM endpoint (default Ollama)
   LLM_ENDPOINT=http://localhost:11434
   ```

### How It Works:
- **Default mode (disabled)**: Uses intelligent template system - zero setup, always works
- **LLM mode (enabled)**: Connects to your local LLM (like Ollama) for enhanced generation
- **Fallback**: If LLM is unavailable, automatically reverts to templates

### Configuration Options:
| Variable | Description | Default |
|----------|-------------|---------|
| `USE_LLM` | Enable LLM features | `false` |
| `LLM_MODEL` | Model name (for Ollama/LMStudio) | `llama3` |
| `LLM_ENDPOINT` | Local LLM API endpoint | `http://localhost:11434` |

## Features

- 🤖 Multiple specialized agent types with different search strategies
- 💰 Performance tracking (earnings, opportunities found, success rate)
- 🔄 Survival-of-the-fittest mechanism for automatic agent evolution
- 🔐 JWT-based authentication for secure API access
- 💾 Persistent storage for opportunities (MongoDB with fallback to in-memory)
- 🌐 RESTful API for agent and opportunity management
- 📊 Statistical endpoints for monitoring system performance
- 🧪 Demo mode for quick testing without authentication
- ⚙️ Configurable via environment variables
- 🛡️ Security best practices (Helmet, CORS, rate limiting)
- 🧠 **Optional**: Local LLM integration for enhanced, varied content generation
- 🧪 Comprehensive test suite

## Prerequisites

- Node.js (>=18.0.0)
- MongoDB (optional - system will work with in-memory storage if MongoDB unavailable)
- For LLM features: [Ollama](https://ollama.com/) or similar local LLM service (optional)

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd free-money-1
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
   - Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
   - Edit `.env` to configure:
     - `PORT` (default: 5000)
     - `MONGODB_URI` (default: mongodb://localhost:27017/money-maker)
     - `JWT_SECRET` (important: change this in production!)
     - Optional LLM settings: `USE_LLM`, `LLM_MODEL`, `LLM_ENDPOINT`
     - Other agent and system configuration options

## Running the Application

### Development Mode
```bash
npm run dev
```
Uses nodemon for automatic restart on file changes.

### Production Mode
```bash
npm start
```
Or simply:
```bash
node server.js
```

### Demo Mode (No Authentication Required)
```bash
node demo.js
```
This runs a 30-second demonstration showing:
- Agent spawning
- Opportunity discovery  
- Performance tracking
- Manager evaluation and survival mechanics

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 5000 |
| `NODE_ENV` | Environment (development/production) | development |
| `MONGODB_URI` | MongoDB connection string | mongodb://localhost:27017/money-maker |
| `JWT_SECRET` | Secret for signing JWT tokens | your_jwt_secret_key_here_change_in_production |
| `JWT_EXPIRES_IN` | Token expiration time | 7d |
| `RATE_LIMIT_WINDOW_MS` | Rate limit window in ms | 900000 (15 minutes) |
| `RATE_LIMIT_MAX_REQUESTS` | Max requests per window | 100 |
| `CORS_ORIGIN` | Allowed CORS origin | * |
| `MAX_FILE_SIZE` | Max upload size | 10MB |
| `MAX_CONCURRENT` | Max concurrent agents | 50 |
| `SPAWN_DELAY` | Delay between agent spawns (ms) | 1000 |
| `CLEANUP_INTERVAL` | Agent cleanup interval (ms) | 60000 |
| `PERSISTENCE_ENABLED` | Enable/disable DB persistence | true |
| `SURVIVAL_THRESHOLD` | Bottom percentage to eliminate | 0.2 (20%) |
| `ELITE_THRESHOLD` | Top percentage to reward | 0.1 (10%) |
| `EVALUATION_INTERVAL` | Manager evaluation interval (ms) | 300000 (5 minutes) |
| `WEIGHT_EARNINGS` | Earnings weight in scoring | 0.4 |
| `WEIGHT_OPPORTUNITIES` | Opportunities weight in scoring | 0.3 |
| `WEIGHT_SUCCESS_RATE` | Success rate weight | 0.2 |
| `WEIGHT_STABILITY` | Stability weight | 0.1 |
| `CRYPTO_HUNTER_SCAN_INTERVAL` | Crypto hunter scan interval (ms) | 30000 |
| `CRYPTO_HUNTER_MAX_RESULTS` | Max results per scan | 10 |
| `CRYPTO_HUNTER_MIN_REWARD` | Minimum reward threshold | 10 |
| `OPPORTUNITY_SCOUT_SCAN_INTERVAL` | Opportunity scout scan interval (ms) | 45000 |
| `OPPORTUNITY_SCOUT_MAX_RESULTS` | Max results per scan | 15 |
| `OPPORTUNITY_SCOUT_MIN_REWARD` | Minimum reward threshold | 5 |
| `DEVELOPER_TASK_INTERVAL` | Developer task interval (ms) | 60000 |
| `DEVELOPER_MAX_TASKS` | Max tasks per cycle | 3 |
| `MANAGER_EVAL_INTERVAL` | Manager evaluation interval (ms) | 300000 |
| `MAX_EARNINGS_PER_AGENT_PER_HOUR` | Earnings cap per hour | 10000 |
| `MAX_OPPORTUNITIES_PER_AGENT_PER_HOUR` | Opportunities cap per hour | 100 |
| `MIN_AGENT_LIFETIME` | Minimum agent lifetime (ms) | 60000 |
| `OPPORTUNITY_FREQUENCY` | Opportunity generation probability | 0.3 |
| `MAX_OPPORTUNITY_VALUE` | Max opportunity value ($) | 1000 |
| `LOG_LEVEL` | Logging level | info |
| `USE_LLM` | Enable local LLM features | false |
| `LLM_MODEL` | LLM model name (e.g., for Ollama) | llama3 |
| `LLM_ENDPOINT` | Local LLM API endpoint | http://localhost:11434 |

## API Documentation

### Authentication
- **POST** `/api/auth/login`
  - Body: `{ "username": "string", "password": "string" }`
  - Returns: `{ success: true, message: "Login successful", data: { token, user } }`

### Agent Endpoints (Require Authorization)
All agent endpoints require `Authorization: Bearer <token>` header.

- **GET** `/api/agents`
  - Query: `type`, `state`, `running` (boolean)
  - Returns: List of agents with performance stats and system statistics

- **GET** `/api/agents/:id`
  - Returns: Detailed information for specific agent

- **POST** `/api/agents/spawn`
  - Body: `{ "type": "cryptoHunter|opportunityScout|developer|manager", "options": { "name": "string", "config": { /* agent-specific config */ } } }`
  - Returns: Created agent information

- **PUT** `/api/agents/:id/config`
  - Body: Configuration object to merge with existing config
  - Returns: Success message

- **DELETE** `/api/agents/:id`
  - Returns: Success message

- **GET** `/api/agents/stats/agents`
  - Returns: System-wide agent statistics

### Opportunity Endpoints (Require Authorization)
- **GET** `/api/opportunities`
  - Query: `type`, `status`, `search`, `limit`, `offset`
  - Returns: List of opportunities with filtering

- **GET** `/api/opportunities/:id`
  - Returns: Specific opportunity details

- **GET** `/api/opportunities/stats`
  - Returns: Opportunity statistics (by type, status, etc.)

- **POST** `/api/opportunities/sync`
  - Triggers manual opportunity synchronization
  - Returns: Synchronized opportunities

### Health Check (Public)
- **GET** `/health`
  - Returns: Service status information

## Project Structure

```
.
├── src/
│   ├── agents/                 # Agent implementations
│   │   ├── baseAgent.js        # Abstract base class
│   │   ├── cryptoHunterAgent.js
│   │   ├── opportunityScoutAgent.js
│   │   ├── developerAgent.js
│   │   ├── managerAgent.js
│   │   └── agentManager.js     # Central agent management
│   ├── services/               # Business logic services
│   │   ├── opportunityService.js
│   │   └── localLLMService.js  # Optional LLM enhancement
│   ├── models/                 # Database models
│   │   ├── Agent.js
│   │   └── Opportunity.js
│   ├── server/
│   │   ├── controllers/        # Request handlers
│   │   │   ├── agentController.js
│   │   │   ├── opportunityController.js
│   │   │   └── authController.js
│   │   ├── middleware/         # Custom middleware
│   │   │   └── auth.js         # JWT authentication
│   │   └── routes/             # API route definitions
│   │       ├── agentRoutes.js
│   │       ├── opportunityRoutes.js
│   │       └── authRoutes.js
│   ├── config/                 # Configuration files
│   │   ├── config.js           # Configuration class
│   │   └── default.js          # Default configuration
│   └── ...                     # Other utilities
├── test/                       # Test files
├── frontend/                   # React dashboard (in progress)
│   ├── package.json
│   │── public/
│   │── src/
├── .env                        # Environment variables
├── .env.example               # Environment variable template
├── server.js                   # Entry point
├── demo.js                     # Demonstration script
├── package.json
└── README.md
```

## How It Works

1. **Agent Initialization**: On startup, the system creates a default set of agents (one of each type) unless persistence is enabled and agents exist in the database.

2. **Agent Operation**: Each agent runs in a continuous loop:
   - Performs its specialized scanning/task at configured intervals
   - Reports any discovered opportunities to the OpportunityService
   - Updates its own performance metrics (earnings, opportunities found, etc.)

3. **Opportunity Management**:
   - Opportunities are stored in MongoDB (when available) with deduplication by URL
   - Agents can add new opportunities through the OpportunityService
   - System provides filtering, sorting, and pagination for opportunity queries

4. **Survival Mechanism** (Managed by ManagerAgent):
   - Periodically evaluates all agents using weighted scoring:
     - Earnings per hour (40%)
     - Opportunities per hour (30%)
     - Success rate (20%)
     - Stability/uptime (10%)
   - Eliminates agents in the bottom 20% by score
   - Provides resource boosts (configuration advantages) to top 10%
   - Fills vacant positions with new agents (randomly selected types for diversity)

5. **Optional LLM Enhancement**:
   - When enabled (`USE_LLM=true`), agents can use local LLMs (like Ollama) to generate more varied and realistic opportunity descriptions
   - Falls back to intelligent template system if LLM unavailable
   - Zero configuration required to use the template system

## Database Schema

### Agent Collection
Stores agent state and performance metrics:
- `agentId` (String, unique)
- `type` (String: cryptoHunter, opportunityScout, developer, manager)
- `name` (String)
- `config` (Object)
- `state` (String: idle, active, resting, error, finished)
- `isRunning` (Boolean)
- `performance` (Embedded document with earnings, opportunities, etc.)
- Timestamps (createdAt, lastActive, lastSeen)

### Opportunity Collection
Stores discovered opportunities:
- `title` (String, required)
- `description` (String, required)
- `url` (String, required, unique)
- `source` (String, required)
- `type` (String: airdrop, bounty, freelance, grant, contest, other)
- `reward` (String)
- `requirements` (Array of Strings)
- `tags` (Array of Strings)
- `postedAt` (Date)
- `updatedAt` (Date)
- `status` (String: active, expired, claimed)

## Testing

Run the test suite:
```bash
npm test
```

Tests cover:
- Agent creation and basic functionality
- Opportunity service operations
- API endpoint responses
- LLM service integration (when enabled)

## Deployment Considerations

1. **Security**:
   - Always change `JWT_SECRET` in production
   - Consider implementing HTTPS/TLS
   - Review CORS settings for production domains
   - Implement rate limiting appropriate for your traffic

2. **Scalability**:
   - Increase `MAX_CONCURRENT` for more agents
   - Consider horizontal scaling with load balancer (stateless services)
   - Monitor MongoDB performance with large datasets

3. **Monitoring**:
   - Use `/api/agents/stats/agents` and `/api/opportunities/stats` for monitoring
   - Implement logging aggregation for production
   - Set up alerts for agent failure rates
   - Monitor LLM usage if enabled

## Troubleshooting

### MongoDB Connection Issues
If you see "Continuing without MongoDB (using in-memory storage for opportunities)":
- Verify MongoDB is running: `mongod` or use a managed service
- Check `MONGODB_URI` in .env
- Ensure network access to MongoDB server

### Authentication Problems
- Ensure you're using the correct token format: `Authorization: Bearer <token>`
- Tokens expire based on `JWT_EXPIRES_IN` (default 7 days)
- Check that `JWT_SECRET` matches between server and token generation

### Agent Not Showing Up
- Verify agent was created successfully (check response from POST /agents/spawn)
- Check if agent exceeded `MAX_CONCURRENT` limit
- Review server logs for startup errors

### LLM Issues (if enabled)
- Verify your local LLM service is running (e.g., Ollama: `ollama serve`)
- Check `LLM_ENDPOINT` and `LLM_MODEL` settings
- Test LLM endpoint directly: `curl http://localhost:11434/api/tags`
- System will automatically fall back to templates if LLM unavailable

## License

MIT License - feel free to use, modify, and distribute this project.

## Acknowledgments

- Built with Node.js, Express, MongoDB, and React
- Inspired by autonomous agent systems and evolutionary algorithms
- Special thanks to the open-source community for the libraries that made this possible
- Optional LLM integration supports local models like Ollama, LMStudio, and similar

---

**Ready to start?** Run `node server.js` and begin building your autonomous money-making team!
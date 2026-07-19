# Multi-Agent Money-Making System API Documentation

## Overview
This document describes the RESTful API endpoints for managing the multi-agent money-making system.

## Base URL
```
/api
```

## Authentication
Currently, no authentication is implemented. In production, you should add authentication middleware.

## Agents Endpoints

### Get All Agents
```
GET /agents
```

**Description:** Retrieve all agents in the system with their current status and performance metrics.

**Query Parameters:**
- `type`: Filter by agent type (cryptoHunter, opportunityScout, developer, manager)
- `state`: Filter by agent state (idle, active, resting, error)
- `running`: Filter by running status (true/false)

**Response:**
```json
{
  "success": true,
  "data": {
    "agents": [
      {
        "id": 1,
        "type": "cryptoHunter",
        "name": "Crypto Hunter Alpha",
        "state": "active",
        "isRunning": true,
        "createdAt": "2023-01-01T00:00:00.000Z",
        "lastActive": "2023-01-01T00:05:00.000Z",
        "performance": {
          "earnings": 125.50,
          "opportunitiesFound": 5,
          "actionsTaken": 10,
          "successRate": 50.0,
          "lastUpdated": "2023-01-01T00:05:00.000Z"
        }
      }
    ],
    "statistics": {
      "total": 5,
      "byType": {
        "cryptoHunter": 2,
        "opportunityScout": 2,
        "developer": 1
      },
      "averagePerformance": {
        "earnings": 75.25,
        "opportunitiesFound": 3.2,
        "actionsTaken": 6.4,
        "successRate": 45.5
      },
      "uptime": 3600000
    }
  }
}
```

### Get Specific Agent
```
GET /agents/:id
```

**Description:** Retrieve a specific agent by ID.

**Path Parameters:**
- `id`: The agent ID

**Response:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "type": "cryptoHunter",
    "name": "Crypto Hunter Alpha",
    "state": "active",
    "isRunning": true,
    "createdAt": "2023-01-01T00:00:00.000Z",
    "lastActive": "2023-01-01T00:05:00.000Z",
    "performance": {
      "earnings": 125.50,
      "opportunitiesFound": 5,
      "actionsTaken": 10,
      "successRate": 50.0,
      "lastUpdated": "2023-01-01T00:05:00.000Z"
    },
    "config": {
      "scanInterval": 30000,
      "maxResultsPerScan": 10,
      "minRewardThreshold": 10
    }
  }
}
```

### Create New Agent
```
POST /agents
```

**Description:** Create a new agent of the specified type.

**Request Body:**
```json
{
  "type": "cryptoHunter",
  "options": {
    "name": "My Crypto Hunter",
    "config": {
      "scanInterval": 25000,
      "maxResultsPerScan": 15
    }
  }
}
```

**Agent Types:**
- `cryptoHunter`: Searches for cryptocurrency opportunities
- `opportunityScout`: Finds traditional money-making opportunities
- `developer`: Builds tools and performs development tasks
- `manager`: Oversees other agents and implements survival logic

**Response:**
```json
{
  "success": true,
  "message": "Agent spawned successfully",
  "data": {
    "id": 6,
    "type": "cryptoHunter",
    "state": "active",
    "isRunning": true
  }
}
```

### Update Agent Configuration
```
PUT /agents/:id/config
```

**Description:** Update the configuration for a specific agent.

**Path Parameters:**
- `id`: The agent ID

**Request Body:**
```json
{
  "scanInterval": 20000,
  "maxResultsPerScan": 20
}
```

**Response:**
```json
{
  "success": true,
  "message": "Agent configuration updated successfully"
}
```

### Delete Agent
```
DELETE /agents/:id
```

**Description:** Terminate and remove an agent from the system.

**Path Parameters:**
- `id`: The agent ID

**Response:**
```json
{
  "success": true,
  "message": "Agent terminated successfully"
}
```

### Get Agent Statistics
```
GET /agents/stats
```

**Description:** Get overall statistics about the agent population.

**Response:**
```json
{
  "success": true,
  "data": {
    "total": 5,
    "byType": {
      "cryptoHunter": 2,
      "opportunityScout": 2,
      "developer": 1
    },
    "averagePerformance": {
      "earnings": 75.25,
      "opportunitiesFound": 3.2,
      "actionsTaken": 6.4,
      "successRate": 45.5
    },
    "uptime": 3600000
  }
}
```

## Opportunities Endpoints

### Get All Opportunities
```
GET /opportunities
```

**Description:** Retrieve all opportunities discovered by agents.

**Query Parameters:**
- `type`: Filter by opportunity type (airdrop, bounty, freelance, grant, contest, other)
- `status`: Filter by opportunity status (active, expired, claimed)
- `search`: Search in title and description
- `limit`: Limit number of results (default: 50)
- `offset`: Offset for pagination (default: 0)

**Response:**
```json
{
  "success": true,
  "data": {
    "opportunities": [
      {
        "id": 1,
        "title": "New Airdrop: FreeToken",
        "description": "Claim 100 FreeTokens by joining our Telegram and following on Twitter.",
        "url": "https://example.com/airdrop/freetoken",
        "source": "ExampleAirdropSite",
        "type": "airdrop",
        "reward": "100 FreeTokens",
        "requirements": ["Join Telegram", "Follow Twitter", "Retweet announcement"],
        "tags": ["airdrop", "FreeToken"],
        "postedAt": "2023-01-01T00:00:00.000Z",
        "updatedAt": "2023-01-01T00:00:00.000Z",
        "status": "active"
      }
    ],
    "statistics": {
      "totalOpportunities": 25,
      "byType": {
        "airdrop": 5,
        "bounty": 8,
        "freelance": 7,
        "grant": 3,
        "contest": 2
      },
      "byStatus": {
        "active": 20,
        "expired": 3,
        "claimed": 2
      },
      "opportunitiesPerDay": 5.2
    }
  }
}
```

### Get Specific Opportunity
```
GET /opportunities/:id
```

**Description:** Retrieve a specific opportunity by ID.

**Path Parameters:**
- `id`: The opportunity ID

**Response:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "title": "New Airdrop: FreeToken",
    "description": "Claim 100 FreeTokens by joining our Telegram and following on Twitter.",
    "url": "https://example.com/airdrop/freetoken",
    "source": "ExampleAirdropSite",
    "type": "airdrop",
    "reward": "100 FreeTokens",
    "requirements": ["Join Telegram", "Follow Twitter", "Retweet announcement"],
    "tags": ["airdrop", "FreeToken"],
    "postedAt": "2023-01-01T00:00:00.000Z",
    "updatedAt": "2023-01-01T00:00:00.000Z",
    "status": "active"
  }
}
```

### Get Opportunity Statistics
```
GET /opportunities/stats
```

**Description:** Get statistics about discovered opportunities.

**Response:**
```json
{
  "success": true,
  "data": {
    "totalOpportunities": 25,
    "byType": {
      "airdrop": 5,
      "bounty": 8,
      "freelance": 7,
      "grant": 3,
      "contest": 2
    },
    "byStatus": {
      "active": 20,
      "expired": 3,
      "claimed": 2
    },
    "opportunitiesPerDay": 5.2,
    "lastUpdated": "2023-01-01T00:05:00.000Z"
  }
}
```

## System Endpoints

### Health Check
```
GET /health
```

**Description:** Check if the API is running.

**Response:**
```json
{
  "status": "OK",
  "timestamp": "2023-01-01T00:00:00.000Z",
  "service": "Money Making API",
  "version": "1.0.0"
}
```

## Error Responses

All endpoints follow this error format:
```json
{
  "success": false,
  "message": "Error description",
  "error": "Detailed error message (only in development)"
}
```

**HTTP Status Codes:**
- 200: Success
- 201: Created
- 400: Bad Request
- 404: Not Found
- 500: Internal Server Error

## Agent Types

### CryptoHunterAgent
- Scans for cryptocurrency opportunities (airdrops, bounties, grants)
- Configuration options: scanInterval, maxResultsPerScan, minRewardThreshold

### OpportunityScoutAgent
- Discovers traditional money-making opportunities (freelance, contests, etc.)
- Configuration options: scanInterval, maxResultsPerScan, minRewardThreshold

### DeveloperAgent
- Builds tools and performs development tasks to earn cryptocurrency
- Configuration options: taskInterval, maxTasksPerCycle

### ManagerAgent
- Oversees other agents and implements survival-of-the-fittest logic
- Configuration options: evaluationInterval

## Performance Metrics

Agents track the following metrics:
- **earnings**: Total value of opportunities found (in USD equivalent)
- **opportunitiesFound**: Number of opportunities discovered
- **actionsTaken**: Number of scanning/actions performed
- **successRate**: Percentage of actions that resulted in opportunities (opportunitiesFound/actionsTaken * 100)

## Survival Mechanism

The ManagerAgent periodically evaluates all agents based on:
1. Earnings per hour (40% weight)
2. Opportunities per hour (30% weight)
3. Success rate (20% weight)
4. Stability/uptime (10% weight)

Agents in the bottom 20% are terminated, while the top 10% receive resource boostes. Vacant positions are filled with new agents.

## Rate Limiting

By default, the API is limited to 100 requests per 15 minutes per IP address. These limits can be configured via environment variables.

## Environment Variables

Configuration can be customized using environment variables. See `.env.example` for a complete list of available options.

## Examples

### Get all active crypto hunter agents:
```
GET /agents?type=cryptoHunter&state=active
```

### Get opportunities from the last 24 hours with high value:
```
GET /opportunities?search=airdrop&limit=10
```

### Create a developer agent with custom settings:
```
POST /agents
{
  "type": "developer",
  "options": {
    "name": "Expert Developer",
    "config": {
      "taskInterval": 30000,
      "maxTasksPerCycle": 5
    }
  }
}
```
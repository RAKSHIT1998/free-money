const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
const JWT_SECRET = 'your-secret-key-change-in-production';

// Mock user for authentication
const users = [
  { id: 1, username: 'demo@example.com', password: '$2a$10$8YJ9tjJ4iT6R3hH7u5.lUuJZvX8jG7f6y5r4t3e2d1c0b9a8z7y6x5w4v3u2t1s', role: 'user' } // password: demo123
];

// In-memory data stores

// In-memory data stores
let wallet = {
  balance: 1000.00,
  transactions: [
    { id: 1, type: 'deposit', amount: 500.00, description: 'Initial deposit', timestamp: new Date(Date.now() - 86400000 * 30).toISOString() },
    { id: 2, type: 'earning', amount: 250.00, description: 'Freelance project completion', timestamp: new Date(Date.now() - 86400000 * 15).toISOString() },
    { id: 3, type: 'withdrawal', amount: 100.00, description: 'ATM withdrawal', timestamp: new Date(Date.now() - 86400000 * 7).toISOString() },
    { id: 4, type: 'earning', amount: 150.00, description: 'Referral bonus', timestamp: new Date(Date.now() - 86400000 * 3).toISOString() },
    { id: 5, type: 'deposit', amount: 200.00, description: 'Bank transfer', timestamp: new Date(Date.now() - 86400000 * 1).toISOString() }
  ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)) // Newest first
};

let agents = [
  { id: 1, name: 'Crypto Hunter Alpha', type: 'cryptoHunter', state: 'active', performance: { earnings: 245.50, opportunitiesFound: 12, successRate: 85.5, actionsTaken: 45 }, lastActive: new Date(Date.now() - 3600000).toISOString() }, // 1 hour ago
  { id: 2, name: 'Opportunity Scout Beta', type: 'opportunityScout', state: 'idle', performance: { earnings: 180.25, opportunitiesFound: 8, successRate: 78.0, actionsTaken: 32 }, lastActive: new Date(Date.now() - 7200000).toISOString() }, // 2 hours ago
  { id: 3, name: 'Developer Gamma', type: 'developer', state: 'active', performance: { earnings: 320.00, opportunitiesFound: 15, successRate: 92.0, actionsTaken: 67 }, lastActive: new Date(Date.now() - 1800000).toISOString() }, // 30 minutes ago
  { id: 4, name: 'Manager Delta', type: 'manager', state: 'resting', performance: { earnings: 410.75, opportunitiesFound: 22, successRate: 88.5, actionsTaken: 89 }, lastActive: new Date(Date.now() - 900000).toISOString() } // 15 minutes ago
];

let opportunities = [
  { id: 1, title: 'FreeToken Airdrop', description: 'Claim free tokens from new blockchain project', type: 'airdrop', status: 'active', reward: '50 FTK', source: 'CryptoAirdrops.com', postedAt: new Date(Date.now() - 86400000 * 2).toISOString(), tags: ['free', 'token', 'new'] },
  { id: 2, title: 'Bug Bounty Program', description: 'Find security vulnerabilities in web applications', type: 'bounty', status: 'active', reward: '$500-$5000', source: 'Bugcrowd', postedAt: new Date(Date.now() - 86400000 * 5).toISOString(), tags: ['security', 'web', 'payout'] },
  { id: 3, title: 'Freelance Web Development', description: 'Build e-commerce website for local business', type: 'freelance', status: 'active', reward: '$1500', source: 'Upwork', postedAt: new Date(Date.now() - 86400000 * 1).toISOString(), tags: ['web', 'development', 'freelance'] },
  { id: 4, title: 'Research Grant Application', description: 'Apply for AI research funding', type: 'grant', status: 'active', reward: '$10000', source: 'NSF Grants', postedAt: new Date(Date.now() - 86400000 * 10).toISOString(), tags: ['research', 'AI', 'grant'] },
  { id: 5, title: 'Coding Contest', description: 'Monthly algorithm challenge with prizes', type: 'contest', status: 'expired', reward: '$500', source: 'CodeChef', postedAt: new Date(Date.now() - 86400000 * 20).toISOString(), tags: ['contest', 'algorithm', 'prize'] }
];

// Auth middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// Auth routes
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;

  const user = users.find(u => u.username === username);
  if (!user) return res.status(400).json({ success: false, message: 'Invalid credentials' });

  bcrypt.compare(password, user.password, (err, result) => {
    if (!result) return res.status(400).json({ success: false, message: 'Invalid credentials' });

    const accessToken = jwt.sign({ username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '1h' });
    res.json({
      success: true,
      data: {
        token: accessToken,
        user: { id: user.id, username: user.username, role: user.role }
      }
    });
  });
});

// Wallet routes
app.get('/api/wallet', authenticateToken, (req, res) => {
  res.json({
    success: true,
    data: {
      balance: wallet.balance,
      transactions: wallet.transactions
    }
  });
});

app.post('/api/wallet/deposit', authenticateToken, (req, res) => {
  const { amount, description } = req.body;
  if (!amount || amount <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid amount' });
  }

  wallet.balance += parseFloat(amount);
  const transaction = {
    id: wallet.transactions.length + 1,
    type: 'deposit',
    amount: parseFloat(amount),
    description: description || 'Deposit',
    timestamp: new Date().toISOString()
  };
  wallet.transactions.unshift(transaction); // Add to beginning

  res.json({ success: true, data: { balance: wallet.balance } });
});

app.post('/api/wallet/withdraw', authenticateToken, (req, res) => {
  const { amount, description } = req.body;
  if (!amount || amount <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid amount' });
  }
  if (amount > wallet.balance) {
    return res.status(400).json({ success: false, message: 'Insufficient funds' });
  }

  wallet.balance -= parseFloat(amount);
  const transaction = {
    id: wallet.transactions.length + 1,
    type: 'withdrawal',
    amount: parseFloat(amount),
    description: description || 'Withdrawal',
    timestamp: new Date().toISOString()
  };
  wallet.transactions.unshift(transaction); // Add to beginning

  res.json({ success: true, data: { balance: wallet.balance } });
});

// Agent routes
app.get('/api/agents', authenticateToken, (req, res) => {
  const { type, state, running } = req.query;

  let filteredAgents = [...agents];

  if (type) filteredAgents = filteredAgents.filter(a => a.type === type);
  if (state) filteredAgents = filteredAgents.filter(a => a.state === state);
  if (running !== undefined) {
    const isRunning = state === 'active' || state === 'idle';
    filteredAgents = filteredAgents.filter(a =>
      (a.state === 'active' || a.state === 'idle') === (running === 'true')
    );
  }

  // Calculate statistics
  const total = filteredAgents.length;
  const active = filteredAgents.filter(a => a.state === 'active').length;
  const totalEarnings = filteredAgents.reduce((sum, a) => sum + a.performance.earnings, 0);
  const avgEarnings = total > 0 ? totalEarnings / total : 0;
  const avgSuccessRate = total > 0 ?
    filteredAgents.reduce((sum, a) => sum + a.performance.successRate, 0) / total : 0;

  const stats = {
    total,
    active,
    averagePerformance: {
      earnings: avgEarnings,
      opportunitiesFound: 0, // Would calculate avg in real app
      successRate: avgSuccessRate,
      actionsTaken: 0 // Would calculate avg in real app
    },
    byType: {
      cryptoHunter: filteredAgents.filter(a => a.type === 'cryptoHunter').length,
      opportunityScout: filteredAgents.filter(a => a.type === 'opportunityScout').length,
      developer: filteredAgents.filter(a => a.type === 'developer').length,
      manager: filteredAgents.filter(a => a.type === 'manager').length
    }
  };

  res.json({ success: true, data: { agents: filteredAgents, statistics: stats } });
});

app.post('/api/agents/spawn', authenticateToken, (req, res) => {
  const { type, name, config } = req.body;

  const newAgent = {
    id: agents.length + 1,
    name: name || `${type.charAt(0).toUpperCase() + type.slice(1)} Agent ${Date.now()}`,
    type,
    state: 'idle',
    performance: { earnings: 0, opportunitiesFound: 0, successRate: 0, actionsTaken: 0 },
    lastActive: new Date().toISOString(),
    config: config || {}
  };

  agents.push(newAgent);

  res.json({ success: true, data: newAgent });
});

app.put('/api/agents/:id/config', authenticateToken, (req, res) => {
  const { id } = req.params;
  const { config } = req.body;

  const agentIndex = agents.findIndex(a => a.id === parseInt(id));
  if (agentIndex === -1) {
    return res.status(404).json({ success: false, message: 'Agent not found' });
  }

  agents[agentIndex] = { ...agents[agentIndex], config };

  res.json({ success: true, message: 'Agent configuration updated' });
});

app.delete('/api/agents/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  const agentIndex = agents.findIndex(a => a.id === parseInt(id));

  if (agentIndex === -1) {
    return res.status(404).json({ success: false, message: 'Agent not found' });
  }

  agents.splice(agentIndex, 1);

  res.json({ success: true, message: 'Agent deleted' });
});

// Opportunities routes
app.get('/api/opportunities', authenticateToken, (req, res) => {
  const { type, status, search, limit, offset } = req.query;

  let filteredOpportunities = [...opportunities];

  if (type) filteredOpportunities = filteredOpportunities.filter(o => o.type === type);
  if (status) filteredOpportunities = filteredOpportunities.filter(o => o.status === status);
  if (search) {
    const searchLower = search.toLowerCase();
    filteredOpportunities = filteredOpportunities.filter(o =>
      o.title.toLowerCase().includes(searchLower) ||
      o.description.toLowerCase().includes(searchLower)
    );
  }

  // Apply pagination
  const start = parseInt(offset) || 0;
  const limitNum = parseInt(limit) || 10;
  const paginated = filteredOpportunities.slice(start, start + limitNum);

  // Calculate statistics
  const totalOpportunities = filteredOpportunities.length;
  const byStatus = {
    active: filteredOpportunities.filter(o => o.status === 'active').length,
    expired: filteredOpportunities.filter(o => o.status === 'expired').length,
    claimed: filteredOpportunities.filter(o => o.status === 'claimed').length
  };
  const byType = {
    airdrop: filteredOpportunities.filter(o => o.type === 'airdrop').length,
    bounty: filteredOpportunities.filter(o => o.type === 'bounty').length,
    freelance: filteredOpportunities.filter(o => o.type === 'freelance').length,
    grant: filteredOpportunities.filter(o => o.type === 'grant').length,
    contest: filteredOpportunities.filter(o => o.type === 'contest').length
  };
  const opportunitiesPerDay = totalOpportunities > 0 ?
    (totalOpportunities / 30).toFixed(1) : '0.0'; // Rough estimate

  const stats = {
    totalOpportunities,
    byStatus,
    byType,
    opportunitiesPerDay: parseFloat(opportunitiesPerDay)
  };

  res.json({ success: true, data: { opportunities: paginated, statistics: stats } });
});

app.post('/api/opportunities/sync', authenticateToken, (req, res) => {
  // Simulate syncing new opportunities
  const newOpportunities = [
    {
      id: opportunities.length + 1,
      title: 'New Bounty Opportunity',
      description: 'Recently added security bounty',
      type: 'bounty',
      status: 'active',
      reward: '$750',
      source: 'HackerOne',
      postedAt: new Date().toISOString(),
      tags: ['security', 'bounty', 'new']
    }
  ];

  opportunities.push(...newOpportunities);

  res.json({ success: true, data: { count: newOpportunities.length } });
});

// Health endpoint
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    data: {
      status: 'OK',
      service: 'Free Money API',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    }
  });
});

// Health endpoint without /api prefix (as used in frontend)
app.get('/health', (req, res) => {
  res.json({
    success: true,
    data: {
      status: 'OK',
      service: 'Free Money API',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    }
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
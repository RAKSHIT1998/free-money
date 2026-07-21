// Import required modules
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');
const authRoutes = require('./src/server/routes/authRoutes');
const opportunityRoutes = require('./src/server/routes/opportunityRoutes');
const agentRoutes = require('./src/server/routes/agentRoutes');
const authMiddleware = require('./src/server/middleware/auth');
const { Config } = require('./src/config/config');

// Load environment variables
dotenv.config();

// Load configuration
const configInstance = new Config();

// Initialize express app
const app = express();
const PORT = configInstance.get('server.port') || 5000;

// Middleware setup
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true
}));
app.use(express.json({ limit: process.env.MAX_FILE_SIZE || '10mb' }));
app.use(express.urlencoded({ extended: true, limit: process.env.MAX_FILE_SIZE || '10mb' }));
app.use(helmet());
app.use(morgan(process.env.LOG_LEVEL || 'combined'));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Authentication routes (public)
app.use('/api/auth', authRoutes);

// Apply authentication middleware to all API routes except auth
app.use('/api/opportunities', authMiddleware.authenticateToken, opportunityRoutes);
app.use('/api/agents', authMiddleware.authenticateToken, agentRoutes);

// Health check endpoint (public)
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'Money Making API',
    version: '1.0.0'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Something went wrong!',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Connect to MongoDB and start server
const startServer = async () => {
  // Only connect to MongoDB if persistence is enabled
  const persistenceEnabled = configInstance.get('agentManager.persistenceEnabled', true);
  if (persistenceEnabled) {
    try {
      await mongoose.connect(configInstance.get('database.uri') || 'mongodb://localhost:27017/money-maker', {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      });
      console.log('Connected to MongoDB');
    } catch (error) {
      console.error('Failed to connect to MongoDB:', error);
      console.log('Continuing without MongoDB (using in-memory storage for opportunities)');
    }
  } else {
    console.log('MongoDB persistence disabled - using in-memory storage for opportunities');
  }

  // Schedule automatic opportunity sync every 6 hours (only if persistence is enabled)
  if (persistenceEnabled) {
    cron.schedule('0 */6 * * *', async () => {
      console.log('Running scheduled opportunity sync...');
      try {
        const opportunityService = require('./src/services/opportunityService');
        const opportunities = await opportunityService.syncOpportunities();
        console.log(`Scheduled sync completed: ${opportunities.length} opportunities synced`);
      } catch (error) {
        console.error('Error during scheduled opportunity sync:', error);
      }
    });
  }

  // Run initial sync on startup (only if persistence is enabled)
  if (persistenceEnabled) {
    console.log('Running initial opportunity sync...');
    const opportunityService = require('./src/services/opportunityService');
    opportunityService.syncOpportunities().then(result => {
      console.log(`Initial sync completed: ${result.length} opportunities synced`);
    }).catch(err => {
      console.error('Error during initial sync:', err);
    });
  } else {
    console.log('Skipping opportunity sync - persistence disabled');
  }

  // Start the agent management system
  console.log('Starting agent management system...');
  const AgentManager = require('./src/agents/agentManager');
  const agentManager = new AgentManager({
    config: configInstance
  });

  // Start server and then spawn initial agents
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);

    // Spawn initial agents after server starts
    setTimeout(async () => {
      try {
        // Spawn initial set of agents based on configuration
        await agentManager.spawnAgent('cryptoHunter', {
          name: 'Initial Crypto Hunter',
          config: {
            scanInterval: configInstance.get('agentTypes.cryptoHunter.scanInterval') || 30000
          }
        });

        await agentManager.spawnAgent('opportunityScout', {
          name: 'Initial Opportunity Scout',
          config: {
            scanInterval: configInstance.get('agentTypes.opportunityScout.scanInterval') || 45000
          }
        });

        await agentManager.spawnAgent('developer', {
          name: 'Initial Developer',
          config: {
            taskInterval: configInstance.get('agentTypes.developer.taskInterval') || 60000
          }
        });

        await agentManager.spawnAgent('manager', {
          name: 'Initial Manager',
          config: {
            evaluationInterval: configInstance.get('agentTypes.manager.evaluationInterval') || 300000
          }
        });

        console.log('Initial agents spawned from configuration');
      } catch (error) {
        console.error('Error spawning initial agents:', error);
      }
    }, 5000); // Wait 5 seconds after server starts
  });
};

// Start the server
startServer();

module.exports = app;
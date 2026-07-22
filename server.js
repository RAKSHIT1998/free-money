// Import required modules
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Load environment variables first
dotenv.config();

// Load environment variables (duplicate line removed)
// dotenv.config();

// Function to get or generate a unique device ID
function getOrCreateDeviceId() {
  const idFile = path.join(process.cwd(), '.device-id');
  let deviceId;
  try {
    if (fs.existsSync(idFile)) {
      deviceId = fs.readFileSync(idFile, 'utf8').trim();
    } else {
      // Generate a semi-unique ID: hostname + random + timestamp
      const hostname = os.hostname().replace(/[^a-z0-9]/gi, '-').toLowerCase();
      const random = Math.random().toString(36).substring(2, 9);
      const timestamp = Date.now().toString(36);
      deviceId = `${hostname}-${random}-${timestamp}`;
      fs.writeFileSync(idFile, deviceId, { encoding: 'utf8' });
    }
  } catch (err) {
    console.warn('Could not read/write device ID file, falling back to random ID:', err);
    deviceId = `dev-${Math.random().toString(36).substring(2, 15)}-${Date.now()}`;
  }
  return deviceId;
}

// Initialize express app
const app = express();
const PORT = process.env.PORT || 5000;

// Generate/set device ID early so it's available throughout the app
const DEVICE_ID = getOrCreateDeviceId();
process.env.DEVICE_ID = DEVICE_ID;
console.log(`Device ID: ${DEVICE_ID}`);

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

// Routes
app.use('/api/auth', require('./src/server/routes/authRoutes'));
app.use('/api/opportunities', require('./src/server/middleware/auth').authenticateToken, require('./src/server/routes/opportunityRoutes'));
app.use('/api/agents', require('./src/server/middleware/auth').authenticateToken, require('./src/server/routes/agentRoutes'));
app.use('/api/wallet', require('./src/server/routes/walletRoutes'));

// Health check endpoint
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

// Start server
const startServer = async () => {
  // Load configuration
  const Config = require('./src/config/config').Config;
  const configInstance = new Config();

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
  const agentManager = AgentManager.initialize({
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
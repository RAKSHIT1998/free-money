const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');
const OpportunityService = require('./src/services/opportunityService');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true
}));
app.use(express.json({ limit: process.env.MAX_FILE_SIZE || '10mb' }));
app.use(express.urlencoded({ extended: true, limit: process.env.MAX_FILE_SIZE || '10mb' }));
app.use(helmet());
app.use(morgan('combined'));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'Money Making API'
  });
});

// Routes will be added here
const opportunityRoutes = require('./src/server/routes/opportunityRoutes');
app.use('/api/opportunities', opportunityRoutes);

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
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/money-maker', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('Connected to MongoDB');
  } catch (error) {
    console.error('Failed to connect to MongoDB:', error);
    console.log('Continuing without MongoDB (using in-memory storage for opportunities)');
  }

  // Schedule automatic opportunity sync every 6 hours
  cron.schedule('0 */6 * * *', async () => {
    console.log('Running scheduled opportunity sync...');
    try {
      const opportunities = await OpportunityService.syncOpportunities();
      console.log(`Scheduled sync completed: ${opportunities.length} opportunities synced`);
    } catch (error) {
      console.error('Error during scheduled opportunity sync:', error);
    }
  });

  // Run initial sync on startup
  console.log('Running initial opportunity sync...');
  OpportunityService.syncOpportunities().then(result => {
    console.log(`Initial sync completed: ${result.length} opportunities synced`);
  }).catch(err => {
    console.error('Error during initial sync:', err);
  });

  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
};

startServer();

module.exports = app;

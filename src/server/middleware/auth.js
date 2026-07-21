// Authentication middleware
const jwt = require('jsonwebtoken');
const { Config } = require('../../config/config');

// Load configuration to get JWT secret
const config = new Config();
const JWT_SECRET = config.get('jwtSecret') || process.env.JWT_SECRET || 'your-secret-key-change-in-production';

/**
 * Verify JWT token middleware
 * Bypasses authentication in development mode for easier testing
 */
const authenticateToken = (req, res, next) => {
  // Skip authentication in development mode
  if (process.env.NODE_ENV === 'development') {
    // Attach a default user for development
    req.user = {
      id: 'dev-user-id',
      username: 'dev-user',
      role: 'admin'
    };
    return next();
  }

  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Access token required'
    });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({
        success: false,
        message: 'Invalid or expired token'
      });
    }
    // Attach user to request
    req.user = user;
    next();
  });
};

module.exports = {
  authenticateToken
};
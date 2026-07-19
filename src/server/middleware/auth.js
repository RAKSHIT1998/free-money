// Authentication middleware
const jwt = require('jsonwebtoken');
const { Config } = require('../../config/config');

// Load configuration to get JWT secret
const config = new Config();
const JWT_SECRET = config.get('jwtSecret');

/**
 * Verify JWT token middleware
 */
const authenticateToken = (req, res, next) => {
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
// Authentication controller
const jwt = require('jsonwebtoken');
const { Config } = require('../../config/config');
const Agent = require('../../models/Agent');

// Load configuration
const config = new Config();
const JWT_SECRET = config.get('jwtSecret') || 'your-secret-key-change-in-production';

/**
 * Login endpoint - for demo purposes, we'll accept any credentials
 * In a real application, you would validate against a user database
 */
const login = async (req, res) => {
  try {
    // For demo, we accept any username/password
    // In production, you would validate against a user database
    const { username, password } = req.body;

    // Simple validation - in reality, check against user database
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username and password are required'
      });
    }

    // Create a user object (in real app, this would come from DB)
    const user = {
      id: 'demo-user-id',
      username: username,
      role: 'admin' // or determine role based on user data
    };

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' } // Token expires in 24 hours
    );

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        user: {
          id: user.id,
          username: user.username,
          role: user.role
        }
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

module.exports = {
  login
};
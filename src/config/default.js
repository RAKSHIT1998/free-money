// Default configuration file
// Copy to config/local.js and modify as needed for environment-specific settings

module.exports = {
  // JWT Configuration
  jwtSecret: process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production',

  // Session cookie settings (if using sessions)
  session: {
    cookie: {
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
  },

  // Rate limiting
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
  }
};
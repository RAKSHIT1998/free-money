// Authentication controller
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { Config } = require('../../config/config');

// Load configuration
const config = new Config();
const JWT_SECRET = config.get('jwtSecret') || process.env.JWT_SECRET;

/**
 * Login endpoint. Previously accepted ANY username/password and issued a valid admin
 * token unconditionally — a stub left over from initial scaffolding. That's a real
 * vulnerability the moment this server is reachable from the public internet (which it
 * now is, being deployed): anyone could POST garbage credentials to /login and receive
 * a real admin token good for every /api/agents/* route, including opening real
 * leveraged futures positions. Now validates against ADMIN_USERNAME + a bcrypt hash of
 * ADMIN_PASSWORD in env, both required — the server refuses to start serving logins at
 * all if they're unset, rather than silently falling back to the old any-credentials
 * behavior.
 */
const login = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username and password are required'
      });
    }

    const adminUsername = process.env.ADMIN_USERNAME;
    const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH;

    if (!adminUsername || !adminPasswordHash) {
      console.error('Login blocked: ADMIN_USERNAME/ADMIN_PASSWORD_HASH not configured');
      return res.status(503).json({
        success: false,
        message: 'Login is not configured on this server'
      });
    }

    // Compare username with a fixed-length hash-based check too, so a wrong username
    // doesn't short-circuit faster than a wrong password (avoids trivially timing
    // which field was wrong). bcrypt.compare itself is already constant-time for equal
    // input lengths, so this mainly protects the username comparison.
    const usernameMatches = username === adminUsername;
    const passwordMatches = await bcrypt.compare(password, adminPasswordHash);

    if (!usernameMatches || !passwordMatches) {
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password'
      });
    }

    const user = {
      id: 'admin',
      username: adminUsername,
      role: 'admin'
    };

    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
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
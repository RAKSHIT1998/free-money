// Authentication middleware
const jwt = require('jsonwebtoken');
const { Config } = require('../../config/config');

// Load configuration to get JWT secret. No hardcoded fallback string — this guards
// real-money endpoints (/api/agents/*), so a missing secret must fail loudly rather
// than silently accept a well-known placeholder value anyone could sign tokens with.
const config = new Config();
const JWT_SECRET = config.get('jwtSecret') || process.env.JWT_SECRET;

/**
 * Verify JWT token middleware.
 *
 * The dev-mode bypass below used to trigger on NODE_ENV==='development' alone — which
 * is exactly the misconfiguration this app was actually running under (checked
 * 2026-08-04): NODE_ENV=development in .env with real Binance credentials and
 * LIVE_TRADING_CONFIRMED=true, meaning every /api/agents/* route (including opening
 * real leveraged positions) was reachable with NO authentication at all. Now requires
 * a SECOND, explicit opt-in (ALLOW_DEV_AUTH_BYPASS=true) so the bypass can never
 * activate just from NODE_ENV being left at its default.
 */
const authenticateToken = (req, res, next) => {
  if (process.env.NODE_ENV === 'development' && process.env.ALLOW_DEV_AUTH_BYPASS === 'true') {
    req.user = {
      id: 'dev-user-id',
      username: 'dev-user',
      role: 'admin'
    };
    return next();
  }

  // OPEN ACCESS BY DEFAULT — set REQUIRE_LOGIN=true to restore authentication.
  //
  // Changed 2026-09-02 at the user's explicit, repeated request ("remove login and
  // password, let me enter direct"), after a long run of deploy friction made the
  // login screen the main thing standing between them and their own dashboard.
  // Defaulted ON (rather than gated behind an env var they'd have to add in a host
  // dashboard) specifically because adding env vars on the host was itself the
  // recurring failure point.
  //
  // What this means, plainly: every /api/agents/* route — spawning real-money
  // trading agents, reading wallet balances, closing positions — is reachable by
  // anyone who knows the URL, with no password. The repository is public, so the
  // URL is not a secret in any meaningful sense.
  //
  // To turn authentication back on: set REQUIRE_LOGIN=true in the environment.
  // Nothing was deleted — the full JWT path below still works and is used the
  // moment that flag is set.
  if (process.env.REQUIRE_LOGIN !== 'true') {
    req.user = { id: 'public-access', username: 'public', role: 'admin' };
    return next();
  }

  if (!JWT_SECRET) {
    console.error('Auth blocked: no JWT secret configured (set jwtSecret in config or JWT_SECRET env var)');
    return res.status(503).json({
      success: false,
      message: 'Authentication is not configured on this server'
    });
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
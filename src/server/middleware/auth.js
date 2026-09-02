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

  // Deliberately separate from the dev bypass above (which only ever activates in
  // NODE_ENV=development) — this one is explicit, user-requested, and works in any
  // environment including production. Added 2026-09-02 at the user's explicit
  // request after repeated login friction on a fresh Render deploy. Makes EVERY
  // /api/agents/* route — including spawning real-money trading agents and reading
  // wallet balances — reachable by anyone with the URL, no password. Set
  // PUBLIC_ACCESS_NO_LOGIN=true only if you specifically want that; unset (or any
  // value other than 'true') to restore normal login.
  if (process.env.PUBLIC_ACCESS_NO_LOGIN === 'true') {
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
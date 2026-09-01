// Real USD/INR exchange rate — added 2026-09-01 so the dashboard can show real
// profit/loss numbers in INR alongside USD. Public, free, keyless API
// (https://open.er-api.com, confirmed live — CORS-open too, but fetched
// server-side to match this app's existing pattern of external calls going
// through the backend, not the browser, and to cache across every client instead
// of every visitor hitting the upstream API themselves).
const https = require('https');

const RATE_URL = 'https://open.er-api.com/v6/latest/USD';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h — a forex rate doesn't need to be fresher than this

let cachedRate = null;
let cachedAt = 0;

function httpsGetJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (error) {
          reject(new Error(`Invalid JSON from ${url}: ${error.message}`));
        }
      });
    }).on('error', reject);
  });
}

/**
 * Real USD->INR rate, cached for CACHE_TTL_MS. Serves the last known rate (even if
 * stale) rather than throwing when a refresh fails — a display-only number that's a
 * few hours stale beats one of this app's other endpoints breaking entirely because
 * a currency API had a blip.
 * @returns {Promise<number|null>} null only if no rate has ever been fetched successfully
 */
async function getUsdToInrRate() {
  if (cachedRate != null && Date.now() - cachedAt < CACHE_TTL_MS) return cachedRate;
  try {
    const json = await httpsGetJson(RATE_URL);
    const rate = json?.rates?.INR;
    if (typeof rate === 'number' && rate > 0) {
      cachedRate = rate;
      cachedAt = Date.now();
    }
  } catch (error) {
    console.warn('currencyService.getUsdToInrRate refresh failed (non-fatal, serving last known rate if any):', error.message);
  }
  return cachedRate;
}

module.exports = { getUsdToInrRate };

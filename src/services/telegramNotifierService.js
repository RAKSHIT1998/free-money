// Real Telegram push notifications — added 2026-09-01. Plain HTTPS calls to
// Telegram's public Bot API (https://core.telegram.org/bots/api), no SDK
// dependency needed. No-ops cleanly (never throws) whenever TELEGRAM_BOT_TOKEN or
// TELEGRAM_CHAT_ID isn't configured, so every call site can fire-and-forget this
// without an extra "is it set up" check of its own — same pattern as
// smartMoneyTrackerService's Solana Tracker calls being optional.
//
// Setup (only the user can do this, it's their own Telegram account):
// 1. Message @BotFather on Telegram, send /newbot, follow the prompts -> get a bot
//    token (looks like 123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ).
// 2. Send any message (e.g. "hi") to the new bot from the Telegram account that
//    should receive alerts.
// 3. Set TELEGRAM_BOT_TOKEN in .env, then call getChatIdFromUpdates() once (see
//    below) to find the numeric chat_id from that message, and set
//    TELEGRAM_CHAT_ID in .env too.
const https = require('https');

function isConfigured() {
  return !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

function httpsRequestJson(url, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request(url, {
      method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch (error) {
          reject(new Error(`Telegram returned invalid JSON (${res.statusCode}): ${data.slice(0, 200)}`));
          return;
        }
        if (res.statusCode !== 200 || parsed.ok === false) {
          reject(new Error(`Telegram API error (${res.statusCode}): ${parsed.description || data.slice(0, 200)}`));
          return;
        }
        resolve(parsed);
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Sends one message to the configured chat. Silently skipped (never throws) if not
 * configured — callers use this fire-and-forget from real trading/governance code
 * paths, and a Telegram outage or missing config must never affect a real trade.
 * @param {string} text HTML-formatted (Telegram's "HTML" parse_mode subset)
 * @returns {Promise<{skipped: boolean, reason?: string}|Object>}
 */
async function sendMessage(text) {
  if (!isConfigured()) return { skipped: true, reason: 'TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not configured' };
  try {
    return await httpsRequestJson(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      body: { chat_id: process.env.TELEGRAM_CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true }
    });
  } catch (error) {
    console.warn('telegramNotifierService.sendMessage failed (non-fatal):', error.message);
    return { skipped: true, reason: error.message };
  }
}

/**
 * One-time setup helper — call this (e.g. via a throwaway script) after sending a
 * message to your bot, with TELEGRAM_BOT_TOKEN already set, to find the chat_id to
 * put in TELEGRAM_CHAT_ID. Not used by any agent; purely a setup utility.
 * @returns {Promise<Array<{chatId: string|number, from: string, text: string}>>}
 */
async function getChatIdFromUpdates() {
  if (!process.env.TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN not set');
  const result = await httpsRequestJson(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getUpdates`);
  return (result.result || [])
    .filter(u => u.message)
    .map(u => ({ chatId: u.message.chat.id, from: u.message.from?.username || u.message.from?.first_name, text: u.message.text }));
}

module.exports = { isConfigured, sendMessage, getChatIdFromUpdates };

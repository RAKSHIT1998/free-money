// Proactive, self-imposed request throttle — the missing half of this app's Binance
// protection. Every rate-limit gate added so far (realFuturesTradingService.js,
// realTradingService.js) is REACTIVE: it only knows to back off after Binance has
// already returned a 429/418. That's necessary but not sufficient — it means we only
// ever find the ceiling by hitting it. This is the PROACTIVE half: a sliding-window
// request counter that self-throttles comfortably below Binance's documented limits
// (2400 weight/min for futures, 6000 weight/min for spot, both per IP) so normal
// operation structurally can't approach a ban, regardless of how many agents are
// calling in, and regardless of whether some future agent forgets to pace itself.
//
// Deliberately counts REQUESTS, not precise per-endpoint weight — Binance's weights
// vary by endpoint and parameters in ways that would need constant upkeep to track
// exactly, and getting that subtly wrong in the optimistic direction is exactly the
// failure mode this exists to prevent. A conservative flat per-request budget, kept
// well under the real ceiling, is simpler to reason about and safer to be wrong about.
class ProactiveThrottle {
  /**
   * @param {Object} params
   * @param {number} params.maxRequests Requests allowed per window before acquire()
   *   starts delaying callers.
   * @param {number} params.windowMs Sliding window size in ms.
   * @param {string} [params.name] For log messages only.
   */
  constructor({ maxRequests, windowMs, name = 'default' }) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.name = name;
    this.timestamps = [];
    // Below, the window-only check has no floor on how fast grants can happen — with
    // timestamps empty (fresh process, or just after the window rolls over), it grants
    // up to maxRequests back-to-back as fast as the event loop can process them. That's
    // fine for a single caller, but this throttle is shared across every agent in the
    // process (11+ real futures agents), and their independent scan loops (breakout and
    // meanReversion each iterate every USDT perpetual, uncapped) all wake and fire their
    // first request together on every boot AND every Render free-tier wake-from-sleep.
    // Confirmed live 2026-08-06: a fresh Binance 418 landed 4 seconds after boot, well
    // under this throttle's nominal 300-req/60s ceiling — the requests were bursty
    // enough within those 4 seconds to trip Binance's own shorter-window abuse
    // detection despite being "under budget" by this throttle's per-minute count alone.
    // minSpacingMs enforces even pacing between grants (not just a per-window cap) so a
    // cold-start thundering herd can never produce a millisecond-scale burst again.
    this.minSpacingMs = Math.ceil(windowMs / maxRequests);
    this.lastGrantedAt = 0;
  }

  /**
   * Resolves once under budget for the current window AND at least minSpacingMs since
   * the last grant — evenly paces calls instead of allowing a burst up to maxRequests
   * followed by a cliff. Never throws — this is about pacing our own calls, not
   * rejecting them.
   * @returns {Promise<void>}
   */
  async acquire() {
    for (;;) {
      const now = Date.now();
      this.timestamps = this.timestamps.filter(t => now - t < this.windowMs);

      const sinceLastGrant = now - this.lastGrantedAt;
      if (this.timestamps.length < this.maxRequests && sinceLastGrant >= this.minSpacingMs) {
        this.timestamps.push(now);
        this.lastGrantedAt = now;
        return;
      }

      let waitMs = 25;
      if (this.timestamps.length >= this.maxRequests) {
        const oldest = this.timestamps[0];
        waitMs = Math.max(waitMs, this.windowMs - (now - oldest) + 10);
      }
      if (sinceLastGrant < this.minSpacingMs) {
        waitMs = Math.max(waitMs, this.minSpacingMs - sinceLastGrant);
      }
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
  }

  /**
   * Current request count within the active window — for status/debugging only.
   * @returns {number}
   */
  currentLoad() {
    const now = Date.now();
    this.timestamps = this.timestamps.filter(t => now - t < this.windowMs);
    return this.timestamps.length;
  }
}

module.exports = ProactiveThrottle;

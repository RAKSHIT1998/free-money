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
  }

  /**
   * Resolves immediately if under budget for the current window; otherwise waits
   * until the oldest request in the window ages out, then re-checks. Never throws —
   * this is about pacing our own calls, not rejecting them.
   * @returns {Promise<void>}
   */
  async acquire() {
    for (;;) {
      const now = Date.now();
      this.timestamps = this.timestamps.filter(t => now - t < this.windowMs);

      if (this.timestamps.length < this.maxRequests) {
        this.timestamps.push(now);
        return;
      }

      const oldest = this.timestamps[0];
      const waitMs = Math.max(25, this.windowMs - (now - oldest) + 10);
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

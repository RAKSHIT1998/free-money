// Real Telegram push notifications straight to the user's phone — added
// 2026-09-01. Two channels:
// 1. A periodic digest (this agent's own run loop) — real wallet balance, real
//    all-time P&L per strategy, and a count of every agent's current state.
// 2. Event alerts — hooked directly into the real trade-close / cull / boost code
//    paths in pumpFunSniperAgent.js and performanceGovernorAgent.js, fire-and-
//    forget, never able to affect (or be affected by) the real action they're
//    reporting on. See those files for the actual hook points.
//
// Read-only in the sense that matters here: this agent itself never trades,
// withdraws, or touches wallet funds — it only reads real state already produced
// by other agents/services and reports it. Silently does nothing (not an error
// state) if TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID aren't configured — see
// telegramNotifierService.js for setup.
const BaseAgent = require('./baseAgent');
const telegramNotifierService = require('../services/telegramNotifierService');

class TelegramNotifierAgent extends BaseAgent {
  constructor(options = {}) {
    super({
      ...options,
      type: 'telegramNotifier',
      config: {
        digestIntervalMs: options.config?.digestIntervalMs || 14400000, // 4h
        ...options.config
      }
    });
    this.lastDigestAt = null;
  }

  async run() {
    const configured = telegramNotifierService.isConfigured();
    this.log(
      'info',
      configured
        ? `Starting Telegram digest: every ${this.config.digestIntervalMs}ms, plus real-time trade/cull/boost alerts`
        : 'Starting Telegram notifier — idle, TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not set (see telegramNotifierService.js for setup)'
    );

    while (this.isRunning) {
      try {
        if (telegramNotifierService.isConfigured()) {
          await this.sendDigest();
        }
      } catch (error) {
        this.log('error', 'Digest send failed:', error.message);
        this.state = 'error';
      }

      if (this.isRunning) {
        await new Promise(resolve => setTimeout(resolve, this.config.digestIntervalMs));
      }
    }
  }

  async sendDigest() {
    this.state = 'active';

    // Lazy requires — avoids a circular require at module load time (agentManager
    // requires every agent type, including this one; agentController requires
    // agentManager).
    const AgentManager = require('./agentManager');
    const agentController = require('../server/controllers/agentController');

    const manager = AgentManager.getInstance();
    const agents = manager.getAllAgents();
    const stateCounts = agents.reduce((acc, a) => {
      acc[a.state] = (acc[a.state] || 0) + 1;
      return acc;
    }, {});
    const halted = agents.filter(a => a.haltedReason).map(a => `${a.type}#${a.id}: ${a.haltedReason}`);

    const [summary, wallets] = await Promise.all([
      agentController.buildRealMoneySummary().catch(() => null),
      agentController.buildRealWallets().catch(() => null)
    ]);

    const lines = [];
    lines.push(`📊 <b>Free Money Status</b>`);
    lines.push('');

    if (wallets?.solana) {
      lines.push(`💰 <b>Wallet:</b> $${wallets.solana.totalUsd.toFixed(2)} (${wallets.solana.freeSol.toFixed(4)} SOL free)`);
    }
    if (wallets?.binance) {
      lines.push(`💵 Binance USDT: $${wallets.binance.usdtFree.toFixed(2)}`);
    }
    lines.push('');

    if (summary) {
      const sign = summary.totalRealizedPnlUsd >= 0 ? '🟢' : '🔴';
      lines.push(`${sign} <b>Total Realized P&L (all-time):</b> $${summary.totalRealizedPnlUsd.toFixed(2)}`);
      if (summary.pumpFun) {
        lines.push(`  • Pump.fun: $${summary.pumpFun.totalRealizedPnlUsd.toFixed(2)} (${summary.pumpFun.closedTradeCount} trades, ${summary.pumpFun.winRatePct}% win)`);
      }
      if (summary.futuresHistory) {
        lines.push(`  • Futures: $${summary.futuresHistory.totalRealizedPnlUsd.toFixed(2)} (${summary.futuresHistory.closedTradeCount} trades)`);
      }
      if (summary.transferArbitrage) {
        lines.push(`  • Transfer arb: $${summary.transferArbitrage.totalRealizedPnlUsd.toFixed(2)} (${summary.transferArbitrage.closedTradeCount} trades)`);
      }
    }
    lines.push('');

    lines.push(`🤖 <b>Agents:</b> ${agents.length} total — ${Object.entries(stateCounts).map(([s, n]) => `${n} ${s}`).join(', ')}`);
    if (halted.length > 0) {
      lines.push(`⚠️ <b>Halted:</b>`);
      halted.forEach(h => lines.push(`  • ${h}`));
    }

    await telegramNotifierService.sendMessage(lines.join('\n'));
    this.lastDigestAt = new Date();
    this.updatePerformance({ actionsTaken: this.performance.actionsTaken + 1 });
    this.state = 'idle';
  }

  getStatus() {
    return {
      ...super.getStatus(),
      telegram: {
        configured: telegramNotifierService.isConfigured(),
        lastDigestAt: this.lastDigestAt
      }
    };
  }

  async cleanup() {
    this.log('info', 'Cleaning up Telegram notifier agent');
  }
}

module.exports = TelegramNotifierAgent;

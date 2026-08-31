// Ledger for REAL transfer-based cross-exchange arbitrage positions: buy on Binance,
// withdraw the real crypto to Coinbase, sell once it lands. Unlike
// RealFundingArbPosition (two legs open/closed together, market-neutral), this is a
// single asset moving through a multi-step, multi-day-possible pipeline with real
// transfer-timing risk at every step — the status enum below exists specifically to
// make each place that pipeline can go wrong visible to a human, rather than have a
// stuck withdrawal or a deposit that never lands hide inside a generic trade log.
const mongoose = require('mongoose');

const realTransferArbPositionSchema = new mongoose.Schema({
  agentId: {
    type: String,
    required: true
  },
  asset: {
    type: String,
    required: true
  },
  status: {
    // 'buying': Binance buy order in flight.
    // 'withdrawing': bought, Binance withdrawal call in flight.
    // 'awaiting_deposit': withdrawal accepted by Binance, waiting for it to land on Coinbase.
    // 'selling': deposit confirmed, Coinbase sell order in flight.
    // 'closed': sold — realizedPnlUsd reflects the actual outcome, whatever it was.
    // 'needs_manual_review': deposit landed but the spread moved against the position
    //   by more than maxAcceptableLossPct — the agent deliberately did NOT auto-sell
    //   into that loss. A human needs to look at this and decide (sell now, wait, etc).
    // 'stranded_after_buy': bought on Binance but the withdrawal call itself failed —
    //   the crypto is still sitting in the Binance account, not lost, just not deployed.
    // 'stranded_after_withdrawal': Binance accepted the withdrawal but it never
    //   landed on Coinbase within depositTimeoutMs — needs a human to trace the
    //   withdrawal (binanceWithdrawId) on a block explorer / Binance's withdrawal history.
    // 'failed': the Binance buy itself failed or didn't fill — nothing was ever at risk.
    type: String,
    enum: [
      'buying', 'withdrawing', 'awaiting_deposit', 'selling',
      'closed', 'needs_manual_review', 'stranded_after_buy',
      'stranded_after_withdrawal', 'failed'
    ],
    required: true
  },
  perTradeUsd: {
    type: Number,
    required: true
  },
  spreadAtDecisionPct: {
    type: Number
  },
  binanceBuyOrderId: {
    type: String
  },
  buyQty: {
    type: Number
  },
  buyFillPriceUsd: {
    type: Number
  },
  binanceWithdrawId: {
    type: String
  },
  withdrawAmount: {
    type: Number
  },
  withdrawAddress: {
    type: String
  },
  withdrawNetwork: {
    type: String
  },
  withdrawnAt: {
    type: Date
  },
  // Coinbase's balance for this asset immediately before the withdrawal was
  // initiated — the baseline hasDepositArrived() checks against, since the account
  // may already hold some of this asset from something unrelated.
  depositBaselineBalance: {
    type: Number
  },
  depositConfirmedAt: {
    type: Date
  },
  coinbaseSellOrderId: {
    type: String
  },
  sellQty: {
    type: Number
  },
  sellFillPriceUsd: {
    type: Number
  },
  realizedPnlUsd: {
    type: Number
  },
  note: {
    type: String
  },
  openedAt: {
    type: Date,
    default: Date.now
  },
  closedAt: {
    type: Date
  }
});

realTransferArbPositionSchema.index({ agentId: 1, status: 1 });

module.exports = mongoose.model('RealTransferArbPosition', realTransferArbPositionSchema);

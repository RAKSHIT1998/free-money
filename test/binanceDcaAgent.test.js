// Unit tests for BinanceDcaAgent's budget/day-boundary/halt logic. These mock
// realTradingService entirely — no real Binance calls happen in this suite.
jest.mock('../src/services/realTradingService');

const realTradingService = require('../src/services/realTradingService');
const BinanceDcaAgent = require('../src/agents/binanceDcaAgent');

function makeAgent(overrides = {}) {
  return new BinanceDcaAgent({
    id: 'test-dca-agent',
    config: {
      symbol: 'BTCUSDT',
      dailyBuyUsd: 5,
      budgetCapUsd: 20,
      checkIntervalMs: 3600000,
      ...overrides
    }
  });
}

describe('BinanceDcaAgent.maybePlaceDailyOrder', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('places an order on first run with an empty ledger', async () => {
    realTradingService.getTotalSpentUsd.mockResolvedValue(0);
    realTradingService.getLedger.mockResolvedValue([]);
    realTradingService.placeMarketBuyOrder.mockResolvedValue({
      filledQty: 0.0001,
      fillPrice: 50000
    });

    const agent = makeAgent();
    const result = await agent.maybePlaceDailyOrder();

    expect(realTradingService.placeMarketBuyOrder).toHaveBeenCalledTimes(1);
    expect(realTradingService.placeMarketBuyOrder).toHaveBeenCalledWith({
      symbol: 'BTCUSDT',
      quoteOrderQtyUsd: 5,
      agentId: 'test-dca-agent'
    });
    expect(result).toEqual({ filledQty: 0.0001, fillPrice: 50000 });
  });

  test('does not place a second order the same UTC day (survives restart)', async () => {
    const todayIso = new Date().toISOString();
    realTradingService.getTotalSpentUsd.mockResolvedValue(5);
    realTradingService.getLedger.mockResolvedValue([
      { timestamp: todayIso, filledQty: 0.0001, fillPrice: 50000 }
    ]);

    // Fresh agent instance simulates a process restart with no in-memory state.
    const agent = makeAgent();
    const result = await agent.maybePlaceDailyOrder();

    expect(realTradingService.placeMarketBuyOrder).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  test('places an order when the last order was on a previous UTC day', async () => {
    const yesterday = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    realTradingService.getTotalSpentUsd.mockResolvedValue(5);
    realTradingService.getLedger.mockResolvedValue([
      { timestamp: yesterday, filledQty: 0.0001, fillPrice: 50000 }
    ]);
    realTradingService.placeMarketBuyOrder.mockResolvedValue({
      filledQty: 0.0001,
      fillPrice: 51000
    });

    const agent = makeAgent();
    await agent.maybePlaceDailyOrder();

    expect(realTradingService.placeMarketBuyOrder).toHaveBeenCalledTimes(1);
  });

  test('halts permanently once the budget cap is reached, even across repeated calls', async () => {
    realTradingService.getTotalSpentUsd.mockResolvedValue(20); // == budgetCapUsd
    realTradingService.getLedger.mockResolvedValue([]);

    const agent = makeAgent();

    const first = await agent.maybePlaceDailyOrder();
    expect(first).toBeNull();
    expect(agent.haltedReason).toMatch(/Budget cap/);
    expect(realTradingService.placeMarketBuyOrder).not.toHaveBeenCalled();

    // Second call: even if getTotalSpentUsd were to (incorrectly) report room again,
    // the agent must stay halted once haltedReason is set.
    realTradingService.getTotalSpentUsd.mockResolvedValue(0);
    const second = await agent.maybePlaceDailyOrder();
    expect(second).toBeNull();
    expect(realTradingService.placeMarketBuyOrder).not.toHaveBeenCalled();
  });

  test('clamps the daily buy amount to the remaining budget', async () => {
    realTradingService.getTotalSpentUsd.mockResolvedValue(18); // only $2 remaining of $20 cap
    realTradingService.getLedger.mockResolvedValue([]);
    realTradingService.placeMarketBuyOrder.mockResolvedValue({
      filledQty: 0.00004,
      fillPrice: 50000
    });

    const agent = makeAgent();
    await agent.maybePlaceDailyOrder();

    expect(realTradingService.placeMarketBuyOrder).toHaveBeenCalledWith({
      symbol: 'BTCUSDT',
      quoteOrderQtyUsd: 2,
      agentId: 'test-dca-agent'
    });
  });

  test('has no dependency on walletService (fake-currency isolation invariant)', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(
      path.join(__dirname, '../src/agents/binanceDcaAgent.js'),
      'utf8'
    );
    expect(source).not.toMatch(/require\(.*walletService.*\)/);
  });
});

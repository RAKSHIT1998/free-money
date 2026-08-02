// Safety-gate tests: fabricated/simulated agent earnings must NEVER be able to reach a
// live Binance withdrawal call unless a human has both (a) set LIVE_TRADING_CONFIRMED=true
// and (b) configured real (non-placeholder) BINANCE_API_KEY/BINANCE_API_SECRET values.
//
// This guards against the scenario found during audit: placeholder .env values are
// non-empty strings, so a naive "are keys set?" check treats them as real credentials
// and unlocks the live withdrawal code path in walletService.withdrawCryptocurrency.

const PLACEHOLDER_KEY = 'your_binance_api_key_here';
const PLACEHOLDER_SECRET = 'your_binance_api_secret_here';
const REAL_LOOKING_KEY = 'A'.repeat(64);
const REAL_LOOKING_SECRET = 'B'.repeat(64);

const BASE_ENV = {
  CRYPTO_ENABLED: 'true',
  PERSISTENCE_ENABLED: 'false',
  DEVICE_ID: 'demo-user',
  BTC_USD: '30000',
  BINANCE_ENABLED: 'true'
};

function setEnv(overrides) {
  process.env = { ...process.env, ...BASE_ENV, ...overrides };
}

// Mock fs so withdrawCryptocurrency's file-mode wallet lookup returns a wallet with
// plenty of BTC balance, without touching the real wallet.json on disk.
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    existsSync: jest.fn(() => true),
    readFileSync: jest.fn(() =>
      JSON.stringify({
        wallets: [
          {
            userId: 'demo-user',
            balances: { BTC: 1 },
            transactions: []
          }
        ]
      })
    ),
    writeFileSync: jest.fn()
  };
});

jest.mock('axios');

describe('walletService.withdrawCryptocurrency live-money gate', () => {
  let axios;

  beforeEach(() => {
    jest.resetModules();
    axios = require('axios');
    axios.post = jest.fn().mockResolvedValue({
      data: { id: 'mock-withdraw-id', status: 'PENDING' }
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('placeholder keys, no opt-in flag -> simulation stays enabled, axios.post never called', async () => {
    setEnv({
      BINANCE_API_KEY: PLACEHOLDER_KEY,
      BINANCE_API_SECRET: PLACEHOLDER_SECRET,
      LIVE_TRADING_CONFIRMED: undefined,
      CRYPTO_SIMULATION_MODE: 'false'
    });
    delete process.env.LIVE_TRADING_CONFIRMED;

    const { Config } = require('../src/config/config');
    const config = new Config();
    expect(config.get('cryptocurrency.simulation.enabled')).toBe(true);

    const walletService = require('../src/services/walletService');
    const result = await walletService.withdrawCryptocurrency(
      15,
      'BTC',
      '1SomeDestinationAddress',
      'test withdrawal',
      undefined,
      'agent-1'
    );

    // Simulation path completes (success or simulated failure), but never a real network call.
    expect(result).toBeDefined();
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('real-looking keys but no opt-in flag -> still simulated, axios.post never called', async () => {
    setEnv({
      BINANCE_API_KEY: REAL_LOOKING_KEY,
      BINANCE_API_SECRET: REAL_LOOKING_SECRET,
      CRYPTO_SIMULATION_MODE: 'false'
    });
    delete process.env.LIVE_TRADING_CONFIRMED;

    const { Config } = require('../src/config/config');
    const config = new Config();
    expect(config.get('cryptocurrency.simulation.enabled')).toBe(true);

    const walletService = require('../src/services/walletService');
    const result = await walletService.withdrawCryptocurrency(
      15,
      'BTC',
      '1SomeDestinationAddress',
      'test withdrawal',
      undefined,
      'agent-1'
    );

    expect(result).toBeDefined();
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('placeholder keys WITH opt-in flag set -> config still forces simulation, axios.post never called', async () => {
    // Even with LIVE_TRADING_CONFIRMED=true, placeholder credentials alone can never
    // unlock the live path: config.js's simulation.enabled requires BOTH real-looking
    // keys AND the flag, so this stays simulated before walletService's own gate is
    // even reached.
    setEnv({
      BINANCE_API_KEY: PLACEHOLDER_KEY,
      BINANCE_API_SECRET: PLACEHOLDER_SECRET,
      LIVE_TRADING_CONFIRMED: 'true',
      CRYPTO_SIMULATION_MODE: 'false'
    });

    const { Config } = require('../src/config/config');
    const config = new Config();
    expect(config.get('cryptocurrency.simulation.enabled')).toBe(true);

    const walletService = require('../src/services/walletService');
    const result = await walletService.withdrawCryptocurrency(
      15,
      'BTC',
      '1SomeDestinationAddress',
      'test withdrawal',
      undefined,
      'agent-1'
    );

    expect(result).toBeDefined();
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('walletService gate directly: simulationMode forced false with placeholder keys -> throws blocked error', async () => {
    // Exercise walletService's own defense-in-depth gate in isolation, independent of
    // config.js's simulation.enabled computation, by monkey-patching the config module's
    // simulation.enabled to false (simulating a hypothetical bug/misconfiguration in
    // config.js) and confirming walletService still refuses to proceed with placeholder
    // credentials.
    setEnv({
      BINANCE_API_KEY: PLACEHOLDER_KEY,
      BINANCE_API_SECRET: PLACEHOLDER_SECRET,
      CRYPTO_SIMULATION_MODE: 'false'
    });
    delete process.env.LIVE_TRADING_CONFIRMED;

    jest.doMock('../src/config/config', () => {
      const actual = jest.requireActual('../src/config/config');
      class ForcedLiveConfig extends actual.Config {
        constructor(...args) {
          super(...args);
          this.mergedConfig.cryptocurrency.simulation.enabled = false;
        }
      }
      return { ...actual, Config: ForcedLiveConfig };
    });

    const walletService = require('../src/services/walletService');

    await expect(
      walletService.withdrawCryptocurrency(
        15,
        'BTC',
        '1SomeDestinationAddress',
        'test withdrawal',
        undefined,
        'agent-1'
      )
    ).rejects.toThrow(/Live cryptocurrency withdrawal blocked/);

    expect(axios.post).not.toHaveBeenCalled();
  });

  test('real-looking keys AND explicit opt-in flag -> live branch proceeds to call axios.post', async () => {
    setEnv({
      BINANCE_API_KEY: REAL_LOOKING_KEY,
      BINANCE_API_SECRET: REAL_LOOKING_SECRET,
      LIVE_TRADING_CONFIRMED: 'true',
      CRYPTO_SIMULATION_MODE: 'false'
    });

    const { Config } = require('../src/config/config');
    const config = new Config();
    expect(config.get('cryptocurrency.simulation.enabled')).toBe(false);

    const walletService = require('../src/services/walletService');
    await walletService.withdrawCryptocurrency(
      15,
      'BTC',
      '1SomeDestinationAddress',
      'test withdrawal',
      undefined,
      'agent-1'
    );

    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post.mock.calls[0][0]).toContain('api.binance.com');
  });
});

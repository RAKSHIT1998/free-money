import { useEffect, useState, useCallback } from 'react';
import api from '../services/api';
import { Card } from '../components/ui/Card';
import { Skeleton } from '../components/ui/Skeleton';
import { Button } from '../components/ui/Button';
import { FiTrendingUp, FiTrendingDown, FiRefreshCw, FiXCircle, FiActivity, FiRadio, FiPocket, FiExternalLink } from 'react-icons/fi';

interface RealAgent {
  id: number;
  type: string;
  state: string;
  isRunning: boolean;
  performance: { earnings: number; opportunitiesFound: number; actionsTaken: number; successRate: number };
}

interface PnlBreakdown {
  totalRealizedPnlUsd: number;
  closedTradeCount: number;
  winCount: number;
  lossCount: number;
  winRatePct?: number | null;
  lastTrade?: { symbol: string; pnlUsd: number; time: string } | null;
  bestTrade?: { symbol: string; pnlUsd: number; time: string } | null;
  worstTrade?: { symbol: string; pnlUsd: number; time: string } | null;
}

interface CulledAgent {
  type: string;
  symbol: string | null;
  reason: string;
  netRealizedPnlUsd?: number;
  closedTradeCount?: number;
  culledAt: string;
}

interface FeedEvent {
  source: 'futures' | 'pumpfun' | 'transferArbitrage' | 'governor';
  kind: 'win' | 'loss' | 'buy' | 'failed' | 'culled';
  symbol: string | null;
  pnlUsd: number | null;
  time: string;
  description: string;
}

interface TokenHolding {
  mint: string;
  symbol: string | null;
  amount: number;
  usdValue: number | null;
  note?: string;
}

interface SolanaWallet {
  address: string;
  freeSol: number;
  // Null when the USD price lookup is rate-limited — the on-chain balances above are
  // still valid and shown; only the dollar conversions are unavailable.
  freeSolUsd: number | null;
  solPrice: number | null;
  priceUnavailable?: boolean;
  tokenHoldings: TokenHolding[];
  tokenHoldingsUsd: number;
  totalUsd: number | null;
}

interface WithdrawableInfo {
  balanceSol: number;
  reservedSol: number;
  withdrawableSol: number;
  pinConfigured: boolean;
}

interface RealWallets {
  solana: SolanaWallet | null;
  solanaError: string | null;
  binance: { usdtFree: number } | null;
  binanceError: string | null;
}

interface RealAgentDetail {
  id: number;
  type: string;
  state: string;
  isRunning: boolean;
  performance: { earnings: number; opportunitiesFound: number; actionsTaken: number; successRate: number };
  real?: Record<string, unknown>;
  arbitrage?: Record<string, unknown>;
}

// One dedicated backend endpoint per real-money strategy (agentRoutes.js) — each
// returns richer per-instance detail (symbol, leverage, budget remaining, open
// positions, halted reason, etc.) than the generic /api/agents list does. Fetched
// together and grouped below into one real "everything in one place" strategy
// breakdown instead of a flat, detail-free agent list.
const STRATEGY_ENDPOINTS: Array<{ path: string; label: string }> = [
  { path: 'pumpfun-sniper', label: 'Pump.fun Sniper (Solana)' },
  { path: 'binance-dca', label: 'Binance Spot DCA' },
  { path: 'binance-earn', label: 'Binance Earn' },
  { path: 'binance-futures-dca', label: 'Binance Futures DCA' },
  { path: 'breakout-futures', label: 'Breakout Futures' },
  { path: 'mean-reversion-futures', label: 'Mean-Reversion Futures' },
  { path: 'funding-rate-arbitrage', label: 'Funding-Rate Arbitrage' },
  { path: 'grid-trading', label: 'Grid Trading' },
  { path: 'transfer-arbitrage', label: 'Transfer Arbitrage' },
];

// A handful of fields worth a human label when present, in priority order — kept
// generic rather than one bespoke renderer per strategy type, since the 9 endpoints
// above deliberately return different shapes. Arrays/objects are summarized as a
// count instead of dumped raw.
const REAL_FIELD_LABELS: Record<string, string> = {
  symbol: 'Symbol', leverage: 'Leverage', marginMode: 'Margin mode',
  budgetCapUsd: 'Budget cap', budgetRemainingUsd: 'Budget remaining',
  totalMarginSpentUsd: 'Margin spent', totalSpentSol: 'SOL spent',
  walletBalanceSol: 'Wallet SOL', currentPrice: 'Price', asset: 'Asset',
  freeSpotBalance: 'Free balance', reserveUsd: 'Reserve', perTradeUsd: 'Per trade',
};

function formatRealValue(key: string, value: unknown): string | null {
  if (value == null) return null;
  if (Array.isArray(value)) return value.length > 0 ? `${value.length}` : null;
  if (typeof value === 'object') return null;
  if (typeof value === 'number') {
    if (/usd|sol|price|balance|spent|remaining|reserve/i.test(key)) {
      return key.toLowerCase().includes('sol') && !key.toLowerCase().includes('usd')
        ? value.toFixed(4)
        : `$${value.toFixed(2)}`;
    }
    return String(value);
  }
  return String(value);
}

function StrategyInstanceRow({ agent }: { agent: RealAgentDetail }) {
  const real = agent.real || {};
  const halted = Boolean(real.halted);
  const haltedReason = typeof real.haltedReason === 'string' ? real.haltedReason : null;
  const openCount =
    (Array.isArray(real.openPositions) && real.openPositions.length) ||
    (typeof real.openPositionsCount === 'number' && real.openPositionsCount) ||
    (real.openPosition ? 1 : 0) || 0;

  const fields = Object.keys(REAL_FIELD_LABELS)
    .filter(k => k in real)
    .map(k => ({ label: REAL_FIELD_LABELS[k], value: formatRealValue(k, real[k]) }))
    .filter(f => f.value != null);

  return (
    <div className="p-3 border border-gray-100 rounded-md text-sm space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATE_COLOR[agent.state] || 'bg-gray-100 text-gray-800'}`}>
            {agent.state}
          </span>
          <span className="text-gray-400 text-xs">#{agent.id}</span>
          {openCount > 0 && (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">
              {openCount} open position{openCount === 1 ? '' : 's'}
            </span>
          )}
        </div>
        <span className="text-gray-400 text-xs">
          {agent.performance.actionsTaken} action{agent.performance.actionsTaken === 1 ? '' : 's'}
        </span>
      </div>
      {fields.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
          {fields.map((f, i) => (
            <span key={i}><span className="text-gray-400">{f.label}:</span> {f.value}</span>
          ))}
        </div>
      )}
      {halted && haltedReason && (
        <p className="text-xs text-orange-600">Halted: {haltedReason}</p>
      )}
    </div>
  );
}

interface RealMoneySummary {
  totalRealizedPnlUsd: number;
  futuresHistory: PnlBreakdown | null;
  pumpFun: PnlBreakdown | null;
  transferArbitrage: PnlBreakdown | null;
  culledAgents: CulledAgent[];
  agents: Array<{ id: number; type: string; state: string; haltedReason: string | null }>;
  usdInrRate: number | null;
}

const formatUsd = (n: number | null | undefined) => {
  if (n == null) return '$0.00';
  const sign = n > 0 ? '+' : '';
  return `${sign}$${n.toFixed(2)}`;
};

// Real USD->INR rate comes from the backend (currencyService.js, cached server-side)
// — never fabricated here. Renders nothing if the rate hasn't loaded yet rather than
// guessing at a conversion.
const formatInr = (n: number | null | undefined, rate: number | null | undefined) => {
  if (n == null || rate == null) return null;
  const sign = n > 0 ? '+' : '';
  return `${sign}₹${(n * rate).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
};

const pnlColor = (n: number | null | undefined) => {
  if (n == null || n === 0) return 'text-gray-500';
  return n > 0 ? 'text-green-600' : 'text-red-600';
};

const STATE_COLOR: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  idle: 'bg-yellow-100 text-yellow-800',
  resting: 'bg-blue-100 text-blue-800',
  error: 'bg-red-100 text-red-800',
};

const READ_ONLY_TYPES = new Set([
  'hackerOneBounty', 'cryptoGigHunter', 'githubBountyHunter', 'companyLeadHunter',
  'airdropClaimScanner', 'cryptoUpdatesTracker', 'smartMoneyTracker', 'telegramNotifier', 'crossExchangeArbitrage', 'realAgentMonitor', 'performanceGovernor'
]);

// Agent `type` values already covered by one of the 9 dedicated strategy endpoints
// above (STRATEGY_ENDPOINTS) — used to keep the "Other" fallback list below from
// duplicating every agent that's already shown in its own strategy group.
const STRATEGY_COVERED_TYPES = new Set([
  'pumpFunSniper', 'binanceDca', 'binanceEarn', 'binanceFuturesDca',
  'breakoutFutures', 'meanReversionFutures', 'fundingRateArbitrage',
  'gridTrading', 'crossExchangeTransferArbitrage',
]);

function PnlCard({ title, data, icon, inrRate }: { title: string; data: PnlBreakdown | null; icon: React.ReactNode; inrRate: number | null }) {
  if (!data) {
    return (
      <Card>
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-gray-700">{title}</h3>
          {icon}
        </div>
        <p className="text-sm text-gray-400">No data yet</p>
      </Card>
    );
  }
  const inr = formatInr(data.totalRealizedPnlUsd, inrRate);
  return (
    <Card>
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-gray-700">{title}</h3>
        {icon}
      </div>
      <p className={`text-2xl font-bold ${pnlColor(data.totalRealizedPnlUsd)}`}>
        {formatUsd(data.totalRealizedPnlUsd)}
      </p>
      {inr && <p className="text-sm text-gray-400">{inr}</p>}
      <p className="text-sm text-gray-500 mt-1">
        {data.closedTradeCount} closed trade{data.closedTradeCount === 1 ? '' : 's'}
        {data.winRatePct != null && ` · ${data.winRatePct.toFixed(0)}% win rate`}
      </p>
      {data.lastTrade && (
        <p className="text-xs text-gray-400 mt-2">
          Last: {data.lastTrade.symbol} {formatUsd(data.lastTrade.pnlUsd)}
        </p>
      )}
    </Card>
  );
}

const RealMoneyPage = () => {
  const [summary, setSummary] = useState<RealMoneySummary | null>(null);
  const [agents, setAgents] = useState<RealAgent[]>([]);
  const [feed, setFeed] = useState<FeedEvent[]>([]);
  const [wallets, setWallets] = useState<RealWallets | null>(null);
  const [strategyGroups, setStrategyGroups] = useState<Record<string, RealAgentDetail[]>>({});
  const [withdrawable, setWithdrawable] = useState<WithdrawableInfo | null>(null);
  const [wdAddress, setWdAddress] = useState('');
  const [wdAmount, setWdAmount] = useState('');
  const [wdPin, setWdPin] = useState('');
  const [wdBusy, setWdBusy] = useState(false);
  const [wdResult, setWdResult] = useState<{ ok: boolean; msg: string; url?: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryRes, agentsRes, feedRes] = await Promise.all([
        api.get('/agents/real/summary'),
        api.get('/agents'),
        api.get('/agents/real/feed?limit=50'),
      ]);
      setSummary(summaryRes.data.data);
      setAgents(agentsRes.data.data.agents);
      setFeed(feedRes.data.data);
      setLastRefreshed(new Date());
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Failed to load real-money data');
    } finally {
      setLoading(false);
    }
  }, []);

  // Faster than the summary cards need on their own — this is the "live feed", so
  // it should actually feel live. 5s still stays well clear of the backend's own
  // rate limit (RATE_LIMIT_MAX_REQUESTS, see .env.example) even with 3 calls/tick.
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Wallets endpoint does a real Solana RPC call plus one pump.fun price lookup
  // PER token actually held — heavier than the other three, so it gets its own
  // slower interval rather than riding the 5s feed tick.
  useEffect(() => {
    const fetchWallets = () => {
      api.get('/agents/real/wallets')
        .then(res => setWallets(res.data.data))
        .catch(() => {});
    };
    fetchWallets();
    const interval = setInterval(fetchWallets, 20000);
    return () => clearInterval(interval);
  }, []);

  const fetchWithdrawable = useCallback(() => {
    api.get('/agents/real/solana/withdrawable')
      .then(res => setWithdrawable(res.data.data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchWithdrawable();
    const interval = setInterval(fetchWithdrawable, 20000);
    return () => clearInterval(interval);
  }, [fetchWithdrawable]);

  const submitWithdrawal = async () => {
    setWdBusy(true);
    setWdResult(null);
    try {
      const res = await api.post('/agents/real/solana/withdraw', {
        toAddress: wdAddress.trim(),
        amountSol: wdAmount.trim().toLowerCase() === 'max' ? 'max' : wdAmount.trim(),
        pin: wdPin,
      });
      const d = res.data.data;
      setWdResult({
        ok: true,
        msg: `Sent ${d.amountSol.toFixed(6)} SOL to ${d.toAddress.slice(0, 8)}...${d.toAddress.slice(-6)}`,
        url: d.explorerUrl,
      });
      setWdAmount('');
      setWdPin('');
      fetchWithdrawable();
    } catch (err: any) {
      setWdResult({ ok: false, msg: err.response?.data?.message || err.message || 'Withdrawal failed' });
    } finally {
      setWdBusy(false);
    }
  };

  // 9 dedicated per-strategy endpoints, each returning richer detail than the
  // generic agent list — heavier than the 5s feed tick, so its own slower interval.
  useEffect(() => {
    const fetchStrategies = () => {
      Promise.allSettled(
        STRATEGY_ENDPOINTS.map(({ path }) => api.get(`/agents/real/${path}`))
      ).then(results => {
        const grouped: Record<string, RealAgentDetail[]> = {};
        results.forEach((result, i) => {
          if (result.status === 'fulfilled') {
            grouped[STRATEGY_ENDPOINTS[i].path] = result.value.data.data || [];
          }
        });
        setStrategyGroups(grouped);
      });
    };
    fetchStrategies();
    const interval = setInterval(fetchStrategies, 10000);
    return () => clearInterval(interval);
  }, []);

  if (loading && !summary) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map(i => <Card key={i}><Skeleton height={60} /></Card>)}
        </div>
        <Card><Skeleton height={200} /></Card>
      </div>
    );
  }

  const realAgents = agents.filter(a => !READ_ONLY_TYPES.has(a.type) && !STRATEGY_COVERED_TYPES.has(a.type));
  const readOnlyAgents = agents.filter(a => READ_ONLY_TYPES.has(a.type));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Real Money</h1>
          <p className="text-gray-500 text-sm">
            What every real-money agent has actually made or lost — no fabricated
            earnings, sourced directly from Binance, Solana, and each agent's own trade
            ledger.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastRefreshed && (
            <span className="text-xs text-gray-400">
              Updated {lastRefreshed.toLocaleTimeString()}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
            <FiRefreshCw size={14} className={`mr-2 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border-l-4 border-red-500 text-red-700 p-4 text-sm">{error}</div>
      )}

      {/* Headline number */}
      <Card className="text-center">
        <p className="text-sm text-gray-500 uppercase tracking-wide">Total Realized P&amp;L (all real-money agents, all time)</p>
        <p className={`text-5xl font-bold mt-2 ${pnlColor(summary?.totalRealizedPnlUsd)}`}>
          {formatUsd(summary?.totalRealizedPnlUsd)}
        </p>
        {formatInr(summary?.totalRealizedPnlUsd, summary?.usdInrRate) && (
          <p className="text-lg text-gray-400 mt-1">
            {formatInr(summary?.totalRealizedPnlUsd, summary?.usdInrRate)}
          </p>
        )}
        <p className="text-xs text-gray-400 mt-2">
          Sums closed-trade P&amp;L across Binance futures, pump.fun, and cross-exchange transfer-arbitrage.
          Excludes still-open/unrealized positions.
        </p>
      </Card>

      {/* Wallet balances -- read straight from the chain/exchange, never from any
          in-memory agent state (confirmed live that in-memory position tracking
          doesn't survive a restart, while the actual holdings obviously do). */}
      <Card>
        <div className="flex items-center gap-2 mb-3">
          <FiPocket className="text-indigo-500" />
          <h3 className="font-semibold">Wallet Balances</h3>
        </div>
        {wallets?.solana ? (
          <div className="space-y-3">
            {/* Deposit address, full and copyable — this is where the user sends funds
                to top the wallet up, so it must be unambiguous, not truncated. */}
            <div className="bg-indigo-50 border border-indigo-100 rounded-md p-3">
              <p className="text-xs font-medium text-indigo-900 mb-1">Deposit address (send SOL here to fund the agents)</p>
              <div className="flex items-center gap-2">
                <code className="text-xs bg-white border border-indigo-200 rounded px-2 py-1 flex-1 break-all">
                  {wallets.solana.address}
                </code>
                <Button
                  variant="outline" size="sm"
                  onClick={() => {
                    navigator.clipboard?.writeText(wallets.solana!.address);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                >
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <a
                href={`https://solscan.io/account/${wallets.solana.address}`}
                target="_blank" rel="noreferrer"
                className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1 mt-2"
              >
                View on Solscan <FiExternalLink size={10} />
              </a>
            </div>

            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-500">Total value</p>
              <p className="text-2xl font-bold">
                {wallets.solana.totalUsd != null ? `$${wallets.solana.totalUsd.toFixed(2)}` : '—'}
              </p>
            </div>
            <div className="text-xs text-gray-500">
              Free SOL: {wallets.solana.freeSol.toFixed(6)}
              {wallets.solana.freeSolUsd != null && wallets.solana.solPrice != null
                ? ` ($${wallets.solana.freeSolUsd.toFixed(2)}) @ $${wallets.solana.solPrice.toFixed(2)}/SOL`
                : ' · USD price temporarily unavailable (rate-limited) — balance above is live from the chain'}
            </div>
            {wallets.solana.tokenHoldings.length > 0 && (
              <div className="border-t border-gray-100 pt-2 space-y-1">
                {wallets.solana.tokenHoldings.map((t, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span className="text-gray-600">
                      {t.symbol || `${t.mint.slice(0, 8)}...`} — {t.amount.toLocaleString()} tokens
                      {t.note && <span className="text-orange-500 ml-1">({t.note})</span>}
                    </span>
                    <span className="font-medium">{t.usdValue != null ? `$${t.usdValue.toFixed(2)}` : '?'}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="border-t border-gray-100 pt-2 flex items-center justify-between text-sm">
              <span className="text-gray-500">Binance (USDT)</span>
              <span className="font-medium">${(wallets.binance?.usdtFree ?? 0).toFixed(2)}</span>
            </div>

            {/* Withdraw. Real, irreversible transfer — gated on a PIN rather than login,
                because the dashboard currently runs with authentication disabled and an
                unprotected withdraw endpoint would be drainable by anyone with the URL. */}
            <div className="border-t border-gray-100 pt-3">
              <p className="text-sm font-medium text-gray-700 mb-1">Withdraw SOL</p>
              {withdrawable && (
                <p className="text-xs text-gray-500 mb-2">
                  Available: <span className="font-medium">{withdrawable.withdrawableSol.toFixed(6)} SOL</span>
                  {' '}({withdrawable.reservedSol} SOL held back for transaction fees)
                </p>
              )}
              {withdrawable && !withdrawable.pinConfigured ? (
                <p className="text-xs text-orange-600 bg-orange-50 border border-orange-200 rounded p-2">
                  Withdrawals are disabled until <code className="font-mono">WITHDRAWAL_PIN</code> is set in the
                  environment. It's required because the dashboard currently has no login,
                  so an unprotected withdraw endpoint could be drained by anyone with this URL.
                </p>
              ) : (
                <div className="space-y-2">
                  <input
                    className="w-full text-xs border border-gray-200 rounded px-2 py-1.5"
                    placeholder="Destination Solana address"
                    value={wdAddress}
                    onChange={e => setWdAddress(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <input
                      className="flex-1 text-xs border border-gray-200 rounded px-2 py-1.5"
                      placeholder="Amount in SOL (or 'max')"
                      value={wdAmount}
                      onChange={e => setWdAmount(e.target.value)}
                    />
                    <input
                      className="flex-1 text-xs border border-gray-200 rounded px-2 py-1.5"
                      type="password"
                      placeholder="Withdrawal PIN"
                      value={wdPin}
                      onChange={e => setWdPin(e.target.value)}
                    />
                  </div>
                  <Button
                    size="sm"
                    disabled={wdBusy || !wdAddress.trim() || !wdAmount.trim() || !wdPin}
                    onClick={submitWithdrawal}
                  >
                    {wdBusy ? 'Sending...' : 'Send SOL'}
                  </Button>
                  <p className="text-xs text-gray-400">
                    Irreversible. Double-check the address — funds sent to a wrong address cannot be recovered.
                  </p>
                </div>
              )}
              {wdResult && (
                <div className={`mt-2 text-xs rounded p-2 ${wdResult.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                  {wdResult.msg}
                  {wdResult.url && (
                    <>
                      {' '}
                      <a href={wdResult.url} target="_blank" rel="noreferrer" className="underline">View transaction</a>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="text-sm text-gray-400">
            <p>{wallets?.solanaError || 'Loading wallet balances...'}</p>
            {/* Even when the balance lookup fails outright, the deposit address is
                derived locally and always knowable — the user still needs it to fund. */}
            {(wallets as any)?.solanaAddress && (
              <p className="mt-2 text-xs">
                Deposit address: <code className="break-all">{(wallets as any).solanaAddress}</code>
              </p>
            )}
          </div>
        )}
      </Card>

      {/* Per-strategy breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <PnlCard title="Binance Futures" data={summary?.futuresHistory ?? null} icon={<FiTrendingUp className="text-blue-500" />} inrRate={summary?.usdInrRate ?? null} />
        <PnlCard title="Pump.fun" data={summary?.pumpFun ?? null} icon={<FiActivity className="text-purple-500" />} inrRate={summary?.usdInrRate ?? null} />
        <PnlCard title="Transfer Arbitrage" data={summary?.transferArbitrage ?? null} icon={<FiTrendingDown className="text-teal-500" />} inrRate={summary?.usdInrRate ?? null} />
      </div>

      {/* Live activity feed -- every real event across every source, merged into one
          chronological stream. Refreshes every 5s (see fetchData's interval above). */}
      <Card>
        <div className="flex items-center gap-2 mb-1">
          <FiRadio className="text-red-500 animate-pulse" size={16} />
          <h3 className="font-semibold">Live Feed — All Time</h3>
        </div>
        <p className="text-xs text-gray-400 mb-3">
          Every real trade, buy, failure, and cull event across every agent, newest first. Refreshes every 5s.
        </p>
        <div className="max-h-96 overflow-y-auto space-y-1">
          {feed.length === 0 && <p className="text-sm text-gray-400 py-4 text-center">No real activity recorded yet.</p>}
          {feed.map((e, i) => (
            <div key={i} className="flex items-center justify-between py-2 px-3 text-sm border-b border-gray-50 last:border-0">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    e.kind === 'win' ? 'bg-green-500'
                    : e.kind === 'loss' ? 'bg-red-500'
                    : e.kind === 'failed' ? 'bg-orange-400'
                    : e.kind === 'culled' ? 'bg-red-700'
                    : 'bg-blue-400'
                  }`}
                />
                <span className="text-gray-500 text-xs uppercase flex-shrink-0">{e.source}</span>
                <span className="truncate">{e.description}</span>
              </div>
              <span className="text-gray-400 text-xs flex-shrink-0 ml-3">
                {new Date(e.time).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </Card>

      {/* Culled agents -- "managers killing underperforming agents" made visible */}
      <Card>
        <div className="flex items-center gap-2 mb-3">
          <FiXCircle className="text-red-500" />
          <h3 className="font-semibold">Culled by the Performance Governor</h3>
        </div>
        <p className="text-xs text-gray-400 mb-3">
          The performance governor reviews every real directional trading agent's REAL
          P&amp;L on an interval and permanently stops ones with a sustained real loss
          (never auto-resumed), while raising the budget of sustained real winners —
          this is that governor's kill list.
        </p>
        {summary?.culledAgents && summary.culledAgents.length > 0 ? (
          <div className="space-y-2">
            {summary.culledAgents.map((c, i) => (
              <div key={i} className="flex items-center justify-between p-3 bg-red-50 rounded-md text-sm">
                <div>
                  <span className="font-medium">{c.type}</span>
                  {c.symbol && <span className="text-gray-500"> ({c.symbol})</span>}
                  <p className="text-gray-500 text-xs mt-1">{c.reason}</p>
                </div>
                <div className="text-right">
                  <p className={`font-medium ${pnlColor(c.netRealizedPnlUsd)}`}>{formatUsd(c.netRealizedPnlUsd)}</p>
                  <p className="text-xs text-gray-400">{new Date(c.culledAt).toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-400">No agent has been permanently culled yet.</p>
        )}
      </Card>

      {/* Every real-money strategy, grouped, with the rich per-instance detail each
          dedicated backend endpoint returns (config, budget, open positions, halted
          reason) — not just a flat state list. This is the "everything in one place"
          view: pump.fun, every Binance strategy, funding-rate arb, grid trading,
          transfer arbitrage, all together. */}
      <Card>
        <h3 className="font-semibold mb-1">All Real-Money Strategies</h3>
        <p className="text-xs text-gray-400 mb-3">
          Every trading strategy this app runs with real money, grouped by type. Updates every 10s.
        </p>
        <div className="space-y-4">
          {STRATEGY_ENDPOINTS.map(({ path, label }) => {
            const instances = strategyGroups[path];
            if (!instances || instances.length === 0) return null;
            return (
              <div key={path}>
                <h4 className="text-sm font-medium text-gray-700 mb-2">{label}</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {instances.map(a => <StrategyInstanceRow key={a.id} agent={a} />)}
                </div>
              </div>
            );
          })}
          {Object.values(strategyGroups).every(v => !v || v.length === 0) && (
            <p className="text-sm text-gray-400">Loading strategy detail...</p>
          )}
        </div>
      </Card>

      {/* Fallback flat list — anything running that isn't one of the 9 dedicated
          strategy endpoints above (shouldn't normally happen, but keeps this page
          complete if a new real-money agent type is added before getting its own
          detail endpoint). */}
      {realAgents.length > 0 && (
        <Card>
          <h3 className="font-semibold mb-3 text-gray-500">Other Real-Money Agents</h3>
          <div className="space-y-2">
            {realAgents.map(a => (
              <div key={a.id} className="flex items-center justify-between p-3 border border-gray-100 rounded-md text-sm">
                <div className="flex items-center gap-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATE_COLOR[a.state] || 'bg-gray-100 text-gray-800'}`}>
                    {a.state}
                  </span>
                  <span className="font-medium">{a.type}</span>
                  <span className="text-gray-400 text-xs">#{a.id}</span>
                </div>
                <span className="text-gray-400 text-xs">
                  {a.performance.actionsTaken} actions · {a.performance.opportunitiesFound} found
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Read-only / oversight agents, collapsed lower since they're not money-moving */}
      <Card>
        <h3 className="font-semibold mb-3 text-gray-500">Read-Only &amp; Oversight Agents</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {readOnlyAgents.map(a => (
            <div key={a.id} className="flex items-center gap-2 p-2 text-xs">
              <span className={`w-2 h-2 rounded-full ${a.state === 'active' ? 'bg-green-500' : a.state === 'error' ? 'bg-red-500' : 'bg-yellow-400'}`} />
              <span className="text-gray-600">{a.type}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};

export default RealMoneyPage;

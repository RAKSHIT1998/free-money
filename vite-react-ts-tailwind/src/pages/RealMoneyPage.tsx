import { useEffect, useState, useCallback } from 'react';
import api from '../services/api';
import { Card } from '../components/ui/Card';
import { Skeleton } from '../components/ui/Skeleton';
import { Button } from '../components/ui/Button';
import { FiTrendingUp, FiTrendingDown, FiRefreshCw, FiXCircle, FiActivity } from 'react-icons/fi';

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

interface RealMoneySummary {
  totalRealizedPnlUsd: number;
  futuresHistory: PnlBreakdown | null;
  pumpFun: PnlBreakdown | null;
  transferArbitrage: PnlBreakdown | null;
  culledAgents: CulledAgent[];
  agents: Array<{ id: number; type: string; state: string; haltedReason: string | null }>;
}

const formatUsd = (n: number | null | undefined) => {
  if (n == null) return '$0.00';
  const sign = n > 0 ? '+' : '';
  return `${sign}$${n.toFixed(2)}`;
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
  'crossExchangeArbitrage', 'realAgentMonitor', 'performanceGovernor'
]);

function PnlCard({ title, data, icon }: { title: string; data: PnlBreakdown | null; icon: React.ReactNode }) {
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
  return (
    <Card>
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-gray-700">{title}</h3>
        {icon}
      </div>
      <p className={`text-2xl font-bold ${pnlColor(data.totalRealizedPnlUsd)}`}>
        {formatUsd(data.totalRealizedPnlUsd)}
      </p>
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryRes, agentsRes] = await Promise.all([
        api.get('/agents/real/summary'),
        api.get('/agents'),
      ]);
      setSummary(summaryRes.data.data);
      setAgents(agentsRes.data.data.agents);
      setLastRefreshed(new Date());
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Failed to load real-money data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [fetchData]);

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

  const realAgents = agents.filter(a => !READ_ONLY_TYPES.has(a.type));
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
        <p className="text-xs text-gray-400 mt-2">
          Sums closed-trade P&amp;L across Binance futures, pump.fun, and cross-exchange transfer-arbitrage.
          Excludes still-open/unrealized positions.
        </p>
      </Card>

      {/* Per-strategy breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <PnlCard title="Binance Futures" data={summary?.futuresHistory ?? null} icon={<FiTrendingUp className="text-blue-500" />} />
        <PnlCard title="Pump.fun" data={summary?.pumpFun ?? null} icon={<FiActivity className="text-purple-500" />} />
        <PnlCard title="Transfer Arbitrage" data={summary?.transferArbitrage ?? null} icon={<FiTrendingDown className="text-teal-500" />} />
      </div>

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

      {/* Real-money agent status */}
      <Card>
        <h3 className="font-semibold mb-3">Real-Money Agents</h3>
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
          {realAgents.length === 0 && <p className="text-sm text-gray-400">No real-money agents running.</p>}
        </div>
      </Card>

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

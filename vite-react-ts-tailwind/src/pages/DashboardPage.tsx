import { useEffect, useState } from 'react';
import { useWallet } from '../hooks';
import { useAgents } from '../hooks';
import { useOpportunities } from '../hooks';
import { formatDistanceToNow } from 'date-fns';
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts';
import { BarChart, Bar } from 'recharts';
import { PieChart, Pie, Cell } from 'recharts';
import { FiCreditCard, FiBriefcase, FiTruck, FiActivity, FiCpu, FiUsers } from 'react-icons/fi';
import { Button } from '../components/ui/Button';
import { Skeleton } from '../components/ui/Skeleton';
import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';

const DashboardPage = () => {
  const { balance, transactions, loading: walletLoading } = useWallet();
  const { agents, agentStats, loading: agentsLoading } = useAgents();
  const { opportunities, opportunityStats, loading: opportunitiesLoading } = useOpportunities();
  const [earningsData, setEarningsData] = useState([]);
  const [agentPerformanceData, setAgentPerformanceData] = useState([]);
  const [opportunityTypeData, setOpportunityTypeData] = useState([]);

  // Generate mock earnings data for the chart (in a real app, this would come from API)
  useEffect(() => {
    // Generate sample data for the last 7 days
    const data = [];
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      // Random earnings between $10 and $100
      const earnings = Math.floor(Math.random() * 90) + 10;
      data.push({
        date: date.toISOString().split('T')[0],
        earnings,
      });
    }
    setEarningsData(data);
  }, []);

  // Generate agent performance data for bar chart
  useEffect(() => {
    if (agents.length > 0) {
      const data = agents.map(agent => ({
        name: agent.name,
        earnings: agent.performance.earnings,
        opportunities: agent.performance.opportunitiesFound,
      }));
      setAgentPerformanceData(data);
    }
  }, [agents]);

  // Generate opportunity type distribution for pie chart
  useEffect(() => {
    if (opportunityStats) {
      const data = Object.entries(opportunityStats.byType)
        .filter(([_, count]) => count > 0)
        .map(([type, count]) => ({
          name: type.charAt(0).toUpperCase() + type.slice(1),
          value: count,
        }));
      setOpportunityTypeData(data);
    }
  }, [opportunityStats]);

  const formatCurrency = (amount) => {
    return `$${amount.toFixed(2)}`;
  };

  const formatDate = (dateString) => {
    return formatDistanceToNow(new Date(dateString), { addSuffix: true });
  };

  if (walletLoading || agentsLoading || opportunitiesLoading) {
    return (
      <div className="space-y-6">
        {/* Loading skeleton for overview cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="h-32">
            <Skeleton height={20} width="full" />
            <Skeleton height={16} width="1/2" className="mt-2" />
          </Card>
          <Card className="h-32">
            <Skeleton height={20} width="full" />
            <Skeleton height={16} width="1/2" className="mt-2" />
          </Card>
          <Card className="h-32">
            <Skeleton height={20} width="full" />
            <Skeleton height={16} width="1/2" className="mt-2" />
          </Card>
          <Card className="h-32">
            <Skeleton height={20} width="full" />
            <Skeleton height={16} width="1/2" className="mt-2" />
          </Card>
        </div>

        {/* Loading skeleton for charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="h-48">
            <Skeleton height={20} width="full" className="mb-2" />
            <Skeleton height={16} width="3/4" className="mb-1" />
            <Skeleton height={16} width="1/2" className="mb-1" />
            <Skeleton height={16} width="1/4" className="mb-1" />
          </Card>
          <Card className="h-48">
            <Skeleton height={20} width="full" className="mb-2" />
            <Skeleton height={16} width="3/4" className="mb-1" />
            <Skeleton height={16} width="1/2" className="mb-1" />
            <Skeleton height={16} width="1/4" className="mb-1" />
          </Card>
        </div>

        {/* Loading skeleton for activity feed */}
        <Card className="h-64">
          <Skeleton height={20} width="full" className="mb-3" />
          <div className="space-y-3 h-full">
            <Skeleton height={16} width="2/3" />
            <Skeleton height={16} width="1/2" />
            <Skeleton height={16} width="2/3" />
            <Skeleton height={16} width="1/2" />
            <Skeleton height={16} width="2/3" />
            <Skeleton height={16} width="1/2" />
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Wallet Balance */}
        <Card className="hover:shadow-lg transition-shadow duration-300">
          <div className="flex items-center justify-between p-4">
            <div>
              <h3 className="text-sm font-medium text-gray-500">Wallet Balance</h3>
              <p className="text-2xl font-bold">{balance ? formatCurrency(balance.balance) : '$0.00'}</p>
            </div>
            <div className="p-2 bg-green-100 rounded-full">
              <FiCreditCard size={24} className="text-green-600" />
            </div>
          </div>
          <div className="px-4 pb-4 text-sm text-gray-600">
            {balance ? `Last updated: ${formatDate(balance.lastUpdated)}` : 'Loading...'}
          </div>
        </Card>

        {/* Active Agents */}
        <Card className="hover:shadow-lg transition-shadow duration-300">
          <div className="flex items-center justify-between p-4">
            <div>
              <h3 className="text-sm font-medium text-gray-500">Active Agents</h3>
              <p className="text-2xl font-bold">
                {agentStats ? agentStats.total : 0}
              </p>
            </div>
            <div className="p-2 bg-blue-100 rounded-full">
              <FiBriefcase size={24} className="text-blue-600" />
            </div>
          </div>
          <div className="px-4 pb-4 text-sm text-gray-600">
            {agentStats ? (
              <>
                <div className="flex justify-between">
                  <span>Crypto Hunter:</span>
                  <span>{agentStats.byType?.cryptoHunter || 0}</span>
                </div>
                <div className="flex justify-between mt-1">
                  <span>Opportunity Scout:</span>
                  <span>{agentStats.byType?.opportunityScout || 0}</span>
                </div>
                <div className="flex justify-between mt-1">
                  <span>Developer:</span>
                  <span>{agentStats.byType?.developer || 0}</span>
                </div>
                <div className="flex justify-between mt-1">
                  <span>Manager:</span>
                  <span>{agentStats.byType?.manager || 0}</span>
                </div>
              </>
            ) : (
              'Loading...'
            )}
          </div>
        </Card>

        {/* Opportunities Found */}
        <Card className="hover:shadow-lg transition-shadow duration-300">
          <div className="flex items-center justify-between p-4">
            <div>
              <h3 className="text-sm font-medium text-gray-500">Opportunities Found</h3>
              <p className="text-2xl font-bold">
                {opportunityStats ? opportunityStats.totalOpportunities : 0}
              </p>
            </div>
            <div className="p-2 bg-orange-100 rounded-full">
              <FiTruck size={24} className="text-orange-600" />
            </div>
          </div>
          <div className="px-4 pb-4 text-sm text-gray-600">
            {opportunityStats ? (
              <>
                <div className="flex justify-between">
                  <span>Active:</span>
                  <span>{opportunityStats.byStatus?.active || 0}</span>
                </div>
                <div className="flex justify-between mt-1">
                  <span>Expired:</span>
                  <span>{opportunityStats.byStatus?.expired || 0}</span>
                </div>
                <div className="flex justify-between mt-1">
                  <span>Claimed:</span>
                  <span>{opportunityStats.byStatus?.claimed || 0}</span>
                </div>
              </>
            ) : (
              'Loading...'
            )}
          </div>
        </Card>

        {/* Earnings Today */}
        <Card className="hover:shadow-lg transition-shadow duration-300">
          <div className="flex items-center justify-between p-4">
            <div>
              <h3 className="text-sm font-medium text-gray-500">Earnings Today</h3>
              <p className="text-2xl font-bold">{formatCurrency(23.50)}</p>
            </div>
            <div className="p-2 bg-yellow-100 rounded-full">
              <FiActivity size={24} className="text-yellow-600" />
            </div>
          </div>
          <div className="px-4 pb-4 text-sm text-gray-600">
            <span className="text-green-500">+12.5% from yesterday</span>
          </div>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Earnings Trend */}
        <Card>
          <div className="flex items-center justify-between pb-4">
            <h3 className="text-lg font-semibold">Earnings Trend (7 Days)</h3>
            <Button variant="ghost" size="sm">
              <FiActivity size={16} /> Refresh
            </Button>
          </div>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={earningsData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={(value) => `$${value}`} tick={{ fontSize: 12 }} />
              <Tooltip formatter={(value) => `$${value}`} />
              <Legend verticalAlign="top" height={36} />
              <Line type="monotone" dataKey="earnings" stroke="#10B981" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        {/* Agent Performance */}
        <Card>
          <div className="flex items-center justify-between pb-4">
            <h3 className="text-lg font-semibold">Agent Performance</h3>
            <Button variant="ghost" size="sm">
              <FiUsers size={16} /> Details
            </Button>
          </div>
          {agentPerformanceData.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={agentPerformanceData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend verticalAlign="top" height={36} />
                <Bar dataKey="earnings" label="Earnings ($)" stackId="a" fill="#3B82F6" />
                <Bar dataKey="opportunities" label="Opportunities" stackId="a" fill="#10B981" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-center py-8 text-gray-500">
              No agent data available
            </div>
          )}
        </Card>
      </div>

      {/* Opportunity Type Distribution and Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Opportunity Types */}
        <Card>
          <div className="flex items-center justify-between pb-4">
            <h3 className="text-lg font-semibold">Opportunity Types</h3>
            <Button variant="ghost" size="sm">
              <FiTruck size={16} /> View All
            </Button>
          </div>
          {opportunityTypeData.length > 0 ? (
            <div className="h-[250px]">
              <PieChart>
                <Pie
                  data={opportunityTypeData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={{ position: 'inside' }}
                >
                  {opportunityTypeData.map((entry, index) => (
                    <Cell key={`cell-${index}`} color={['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40'][index % 6]} />
                  ))}
                </Pie>
              </PieChart>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              No opportunity data available
            </div>
          )}
        </Card>

        {/* Recent Activity Feed */}
        <Card>
          <div className="flex items-center justify-between pb-4">
            <h3 className="text-lg font-semibold">Recent Activity</h3>
            <Button variant="ghost" size="sm">
              <FiActivity size={16} /> View All
            </Button>
          </div>
          <div className="space-y-3">
            {/* Sample activity items - in a real app, these would come from an API */}
            <div className="p-3 bg-gray-50 rounded-lg">
              <div className="flex items-start space-x-3">
                <div className="flex-shrink-0">
                  <FiActivity size={20} className="text-blue-500" />
                </div>
                <div className="flex-1">
                  <p className="font-medium">New opportunity discovered: FreeToken Airdrop</p>
                  <p className="text-sm text-gray-500">
                    Found by Opportunity Scout • {formatDate(new Date().toISOString())}
                  </p>
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                    Active
                  </span>
                </div>
              </div>
            </div>
            <div className="p-3 bg-gray-50 rounded-lg">
              <div className="flex items-start space-x-3">
                <div className="flex-shrink-0">
                  <FiCreditCard size={20} className="text-green-500" />
                </div>
                <div className="flex-1">
                  <p className="font-medium">Earnings added: $12.50 from freelance task</p>
                  <p className="text-sm text-gray-500">
                    Wallet transaction • {formatDate(new Date(Date.now() - 3600000).toISOString())}
                  </p>
                </div>
              </div>
            </div>
            <div className="p-3 bg-gray-50 rounded-lg">
              <div className="flex items-start space-x-3">
                <div className="flex-shrink-0">
                  <FiBriefcase size={20} className="text-purple-500" />
                </div>
                <div className="flex-1">
                  <p className="font-medium">Agent spawned: Developer Agent Alpha</p>
                  <p className="text-sm text-gray-500">
                    Agent management • {formatDate(new Date(Date.now() - 7200000).toISOString())}
                  </p>
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                    Active
                  </span>
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default DashboardPage;
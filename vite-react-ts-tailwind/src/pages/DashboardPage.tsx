import { useEffect, useState } from 'react';
import { useWallet } from '../hooks';
import { useAgents } from '../hooks';
import { useOpportunities } from '../hooks';
import { formatDistanceToNow } from 'date-fns';
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts';
import { BarChart, Bar } from 'recharts';
import { PieChart, Pie, Cell } from 'recharts';
import { FiCreditCard, FiBriefcase, FiTruck, FiActivity, FiUsers } from 'react-icons/fi';
import { Button } from '../components/ui/Button';
import { Skeleton } from '../components/ui/Skeleton';
import { Card } from '../components/ui/Card';

const DashboardPage = () => {
  const { balance, transactions, loading: walletLoading, refresh: refreshWallet } = useWallet();
  const { agents, agentStats, loading: agentsLoading, refresh: refreshAgents } = useAgents();
  const { opportunityStats, loading: opportunitiesLoading, refresh: refreshOpportunities } = useOpportunities();
  const [earningsData, setEarningsData] = useState<{ date: string; earnings: number }[]>([]);
  const [agentPerformanceData, setAgentPerformanceData] = useState<{ name: string; earnings: number; opportunities: number }[]>([]);
  const [opportunityTypeData, setOpportunityTypeData] = useState<{ name: string; value: number }[]>([]);
  const [activityFeed, setActivityFeed] = useState<Array<any>>([]);

  // Generate earnings data from wallet transactions (last 7 days)
  useEffect(() => {
    if (transactions && transactions.length > 0) {
      // Group transactions by date and calculate daily earnings
      const dailyEarnings: Record<string, number> = {};

      transactions.forEach((tx: any) => {
        const date = tx.timestamp.split('T')[0]; // YYYY-MM-DD format
        if (!dailyEarnings[date]) {
          dailyEarnings[date] = 0;
        }

        // Only count earnings (deposits and earnings, not withdrawals)
        if (tx.type === 'deposit' || tx.type === 'earning') {
          dailyEarnings[date] += tx.amount;
        }
      });

      // Convert to array and sort by date
      const data = Object.entries(dailyEarnings)
        .map(([date, earnings]) => ({ date, earnings }))
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      // Keep only last 7 days
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const filteredData = data.filter(item =>
        new Date(item.date) >= sevenDaysAgo
      );

      setEarningsData(filteredData);
    }
  }, [transactions]);

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

  // Generate activity feed from various sources
  useEffect(() => {
    const activities: Array<any> = [];

    // Add wallet transactions as activities
    if (transactions && transactions.length > 0) {
      transactions.slice(0, 10).forEach((tx: any) => {
        let icon: any = FiActivity;
        let color = 'text-blue-500';
        let description = '';

        if (tx.type === 'deposit') {
          icon = FiCreditCard;
          color = 'text-green-500';
          description = `Deposit of $${tx.amount.toFixed(2)}`;
        } else if (tx.type === 'withdrawal') {
          icon = FiCreditCard;
          color = 'text-red-500';
          description = `Withdrawal of $${tx.amount.toFixed(2)}`;
        } else if (tx.type === 'earning') {
          icon = FiActivity;
          color = 'text-yellow-500';
          description = `Earnings: $${tx.amount.toFixed(2)}`;
        }

        activities.push({
          id: tx.id,
          type: 'transaction',
          icon,
          color,
          description,
          timestamp: tx.timestamp,
          agentName: tx.type === 'earning' ? 'Unknown Agent' : undefined
        });
      });
    }

    // Sort by timestamp descending (newest first)
    activities.sort((a: any, b: any) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    // Take top 10 activities
    setActivityFeed(activities.slice(0, 10));
  }, [transactions]);

  // Helper function to calculate today's earnings
  const calculateTodayEarnings = () => {
    if (!transactions || transactions.length === 0) return 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return transactions
      .filter((tx: any) => {
        const txDate = new Date(tx.timestamp);
        txDate.setHours(0, 0, 0, 0);
        return txDate.getTime() === today.getTime() &&
               (tx.type === 'deposit' || tx.type === 'earning');
      })
      .reduce((sum, tx: any) => sum + tx.amount, 0);
  };

  // Helper function to calculate yesterday's earnings for percentage change
  const calculateYesterdayEarnings = () => {
    if (!transactions || transactions.length === 0) return 0;

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    return transactions
      .filter((tx: any) => {
        const txDate = new Date(tx.timestamp);
        txDate.setHours(0, 0, 0, 0);
        return txDate.getTime() === yesterday.getTime() &&
               (tx.type === 'deposit' || tx.type === 'earning');
      })
      .reduce((sum, tx: any) => sum + tx.amount, 0);
  };

  // Helper function to calculate percentage change
  const calculateTodayEarningsChange = () => {
    const todayEarnings = calculateTodayEarnings();
    const yesterdayEarnings = calculateYesterdayEarnings();

    if (yesterdayEarnings === 0) {
      return todayEarnings > 0 ? 100 : 0;
    }

    return ((todayEarnings - yesterdayEarnings) / yesterdayEarnings) * 100;
  };

  const formatCurrency = (amount: number) => {
    return `$${amount.toFixed(2)}`;
  };

  const formatDate = (dateString: string) => {
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
                {agentStats ? agents.filter(agent => agent.state === 'active').length : 0}
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
              <p className="text-2xl font-bold">
                {balance ? formatCurrency(calculateTodayEarnings()) : '$0.00'}
              </p>
            </div>
            <div className="p-2 bg-yellow-100 rounded-full">
              <FiActivity size={24} className="text-yellow-600" />
            </div>
          </div>
          <div className="px-4 pb-4 text-sm text-gray-600">
            {balance ? (
              <>
                {calculateTodayEarningsChange() >= 0 ? (
                  <span className="text-green-500">
                    +{calculateTodayEarningsChange().toFixed(1)}% from yesterday
                  </span>
                ) : (
                  <span className="text-red-500">
                    {calculateTodayEarningsChange().toFixed(1)}% from yesterday
                  </span>
                )}
              </>
            ) : (
              'Loading...'
            )}
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
                <Bar dataKey="earnings" label={true} stackId="a" fill="#3B82F6" />
                <Bar dataKey="opportunities" label={true} stackId="a" fill="#10B981" />
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
                  {opportunityTypeData.map((_, index) => (
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
            {activityFeed.length > 0 ? (
              activityFeed.map((activity: any) => (
                <div key={activity.id} className="p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-start space-x-3">
                    <div className="flex-shrink-0">
                      {activity.icon && <activity.icon size={20} className={activity.color} />}
                    </div>
                    <div className="flex-1">
                      <p className="font-medium">{activity.description}</p>
                      <p className="text-sm text-gray-500">
                        {activity.agentName ?
                          `${activity.agentName} • ` : ''
                        }
                        {formatDate(activity.timestamp)}
                      </p>
                      {activity.agentName && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                          Active
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-gray-500">
                <p>No recent activity</p>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
};

export default DashboardPage;
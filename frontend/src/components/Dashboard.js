import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Doughnut, Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
} from 'chart.js';
import api from '../services/api';

// Register the required chart components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  ArcElement
);

const Dashboard = () => {
  const [agentStats, setAgentStats] = useState(null);
  const [opportunityStats, setOpportunityStats] = useState(null);
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchStats = useCallback(async () => {
    try {
      setLoading(true);
      // Fetch agent stats
      const agentRes = await api.getAgentStats();
      setAgentStats(agentRes.data);

      // Fetch opportunity stats
      const oppRes = await api.getOpportunityStats();
      setOpportunityStats(oppRes.data);

      // Fetch all agents to calculate total earnings
      const agentsRes = await api.getAllAgents();
      setAgents(agentsRes.data.agents || []);

      setError(null);
    } catch (err) {
      console.error('Failed to fetch stats:', err);
      setError('Failed to load dashboard statistics');
      setAgentStats(null);
      setOpportunityStats(null);
      setAgents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    // Refresh every 60 seconds
    const interval = setInterval(fetchStats, 60000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  if (loading) return <p className="loading">Loading dashboard...</p>;
  if (error) return <p className="error">{error}</p>;

  // Memoize total earnings calculation
  const totalEarnings = useMemo(() => {
    return agents.reduce((sum, agent) => {
      return sum + (agent.performance?.totalEarnings || 0);
    }, 0);
  }, [agents]);

  // Memoize agent type data for chart
  const agentTypeData = useMemo(() => {
    return {
      labels: agentStats?.byType ? Object.keys(agentStats.byType) : [],
      datasets: [
        {
          data: agentStats?.byType ? Object.values(agentStats.byType) : [],
          backgroundColor: [
            '#3498db',
            '#2c3e50',
            '#e74c3c',
            '#2ecc71',
            '#f39c12',
            '#9b59b6',
            '#1abc9c',
            '#f1c40f'
          ],
          borderWidth: 2,
          borderColor: '#fff'
        }
      ]
    };
  }, [agentStats]);

  // Memoize performance data for chart
  const performanceData = useMemo(() => {
    return {
      labels: ['Earnings ($/hr)', 'Opportunities/hr', 'Actions', 'Success Rate (%)'],
      datasets: [
        {
          label: 'Average Performance (per hour)',
          data: [
            agentStats?.averagePerformance?.earnings || 0,
            agentStats?.averagePerformance?.opportunitiesFound || 0,
            agentStats?.averagePerformance?.actionsTaken || 0,
            agentStats?.averagePerformance?.successRate || 0
          ],
          backgroundColor: [
            'rgba(52, 152, 219, 0.5)',
            'rgba(44, 62, 80, 0.5)',
            'rgba(231, 76, 60, 0.5)',
            'rgba(46, 204, 113, 0.5)'
          ],
          borderColor: [
            'rgba(52, 152, 219, 1)',
            'rgba(44, 62, 80, 1)',
            'rgba(231, 76, 60, 1)',
            'rgba(46, 204, 113, 1)'
          ],
          borderWidth: 2
        }
      ]
    };
  }, [agentStats]);

  return (
    <div className="dashboard">
      <div className="stats-grid">
        <div className="stat-card stat-agents">
          <div className="stat-icon">👥</div>
          <div className="stat-value">{agentStats?.total || 0}</div>
          <div className="stat-label">Total Agents</div>
        </div>
        <div className="stat-card stat-earnings">
          <div className="stat-icon">💰</div>
          <div className="stat-value">${totalEarnings.toFixed(2)}</div>
          <div className="stat-label">Total Earnings</div>
        </div>
        <div className="stat-card stat-opportunities">
          <div className="stat-icon">💵</div>
          <div className="stat-value">${(agentStats?.averagePerformance?.earnings || 0).toFixed(2)}/hr</div>
          <div className="stat-label">Avg Earnings/Hour</div>
        </div>
        <div className="stat-card stat-success-rate">
          <div className="stat-icon">🎯</div>
          <div className="stat-value">{opportunityStats?.totalOpportunities || 0}</div>
          <div className="stat-label">Total Opportunities</div>
        </div>
      </div>

      <div className="charts-container">
        <div className="chart-card">
          <h3 className="chart-title">Agent Distribution</h3>
          <div>
            <Doughnut data={agentTypeData} />
          </div>
        </div>
        <div className="chart-card">
          <h3 className="chart-title">Performance Overview (Per Hour)</h3>
          <div>
            <Bar data={performanceData} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
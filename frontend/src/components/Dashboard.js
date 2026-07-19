import React, { useEffect, useState } from 'react';
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        setLoading(true);
        // Fetch agent stats
        const agentRes = await api.getAgentStats();
        setAgentStats(agentRes.data);

        // Fetch opportunity stats
        const oppRes = await api.getOpportunityStats();
        setOpportunityStats(oppRes.data);

        setError(null);
      } catch (err) {
        console.error('Failed to fetch stats:', err);
        setError('Failed to load dashboard statistics');
        setAgentStats(null);
        setOpportunityStats(null);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
    // Refresh every 60 seconds
    const interval = setInterval(fetchStats, 60000);
    return () => clearInterval(interval);
  }, []);

  if (loading) return <p className="loading">Loading dashboard...</p>;
  if (error) return <p className="error">{error}</p>;

  // Prepare data for agent distribution doughnut chart
  const agentTypeData = {
    labels: agentStats?.byType ? Object.keys(agentStats.byType) : [],
    datasets: [
      {
        data: agentStats?.byType ? Object.values(agentStats.byType) : [],
        backgroundColor: [
          '#6a11cb',
          '#2575fc',
          '#17c9b2',
          '#f39c12',
          '#e74c3c',
          '#9b59b6',
          '#f1c40f',
          '#2ecc71'
        ],
        borderWidth: 2,
        borderColor: '#fff'
      }
    ]
  };

  // Prepare data for performance bar chart
  const performanceData = {
    labels: ['Earnings ($)', 'Opportunities', 'Actions', 'Success Rate (%)'],
    datasets: [
      {
        label: 'Average Performance',
        data: [
          agentStats?.averagePerformance?.earnings || 0,
          agentStats?.averagePerformance?.opportunitiesFound || 0,
          agentStats?.averagePerformance?.actionsTaken || 0,
          agentStats?.averagePerformance?.successRate || 0
        ],
        backgroundColor: [
          'rgba(106, 17, 203, 0.5)',
          'rgba(37, 117, 252, 0.5)',
          'rgba(23, 201, 178, 0.5)',
          'rgba(243, 156, 18, 0.5)'
        ],
        borderColor: [
          'rgba(106, 17, 203, 1)',
          'rgba(37, 117, 252, 1)',
          'rgba(23, 201, 178, 1)',
          'rgba(243, 156, 18, 1)'
        ],
        borderWidth: 2
      }
    ]
  };

  return (
    <div className="dashboard">
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon">👥</div>
          <div className="stat-value">{agentStats?.total || 0}</div>
          <div className="stat-label">Total Agents</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">💰</div>
          <div className="stat-value">${(agentStats?.averagePerformance?.earnings || 0).toFixed(2)}</div>
          <div className="stat-label">Avg Earnings</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">🎯</div>
          <div className="stat-value">{opportunityStats?.totalOpportunities || 0}</div>
          <div className="stat-label">Total Opportunities</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">⚡</div>
          <div className="stat-value">
            {/* Format uptime from agent stats if available, otherwise show 00:00:00 */}
            {agentStats?.uptime ? (
              new Date(agentStats.uptime).toISOString().substr(11, 8)
            ) : (
              '00:00:00'
            )}
          </div>
          <div className="stat-label">System Uptime</div>
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
          <h3 className="chart-title">Performance Overview</h3>
          <div>
            <Bar data={performanceData} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
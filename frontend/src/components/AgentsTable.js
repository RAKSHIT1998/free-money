import React, { useEffect, useState } from 'react';
import api from '../services/api';

const AgentsTable = () => {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchAgents = async () => {
      try {
        setLoading(true);
        const res = await api.getAgents();
        setAgents(res.data.agents || []);
        setError(null);
      } catch (err) {
        console.error('Failed to fetch agents:', err);
        setError('Failed to load agents');
        setAgents([]);
      } finally {
        setLoading(false);
      }
    };

    fetchAgents();
    // Refresh every 15 seconds
    const interval = setInterval(fetchAgents, 15000);
    return () => clearInterval(interval);
  }, []);

  if (loading) return <p className="loading">Loading agents...</p>;
  if (error) return <p className="error">{error}</p>;
  if (agents.length === 0) return <p className="loading">No agents found</p>;

  return (
    <table className="agent-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>Type</th>
          <th>Name</th>
          <th>State</th>
          <th>Earnings</th>
          <th>Opportunities</th>
          <th>Actions</th>
          <th>Success Rate</th>
          <th>Last Active</th>
        </tr>
      </thead>
      <tbody>
        {agents.map(agent => {
          const statusClass =
            agent.state === 'active' ? 'status-active' :
            agent.state === 'error' ? 'status-error' : 'status-idle';

          const lastActive = new Date(agent.lastActive);
          const timeAgo = getTimeAgo(lastActive);

          return (
            <tr key={agent.id}>
              <td>{agent.id}</td>
              <td>{capitalizeFirstLetter(agent.type)}</td>
              <td>{agent.name || 'Unnamed'}</td>
              <td><span className={`status-badge ${statusClass}`}>{agent.state}</span></td>
              <td>${(agent.performance?.earnings || 0).toFixed(2)}</td>
              <td>{agent.performance?.opportunitiesFound || 0}</td>
              <td>{agent.performance?.actionsTaken || 0}</td>
              <td>{(agent.performance?.successRate || 0).toFixed(1)}%</td>
              <td>{timeAgo}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
    );
};

// Helper function to get time ago string
function getTimeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 2592000) return `${Math.floor(seconds / 86400)}d ago`;

  return date.toLocaleDateString();
}

// Helper function to capitalize first letter
function capitalizeFirstLetter(string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

export default AgentsTable;
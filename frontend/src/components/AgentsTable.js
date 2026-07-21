import React, { useEffect, useState, useCallback, useMemo } from 'react';
import api from '../services/api';

const AgentsTable = () => {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchAgents = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    fetchAgents();
    // Refresh every 15 seconds
    const interval = setInterval(fetchAgents, 15000);
    return () => clearInterval(interval);
  }, [fetchAgents]);

  if (loading) return <p className="loading">Loading agents...</p>;
  if (error) return <p className="error">{error}</p>;
  if (agents.length === 0) return <p className="empty-state">No agents found</p>;

  // Memoize helper functions
  const getTimeAgo = useCallback((date) => {
    const seconds = Math.floor((new Date() - date) / 1000);

    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 2592000) return `${Math.floor(seconds / 86400)}d ago`;

    return date.toLocaleDateString();
  }, []);

  const capitalizeFirstLetter = useCallback((string) => {
    return string.charAt(0).toUpperCase() + string.slice(1);
  }, []);

  // Memoize the table rows to prevent unnecessary re-renders
  const tableRows = useMemo(() => {
    return agents.map(agent => {
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
          <td>${(agent.performance?.totalEarnings || 0).toFixed(2)}</td>
          <td>${(agent.performance?.earningsPerHour || 0).toFixed(2)}/hr</td>
          <td>{agent.performance?.opportunitiesFound || 0}</td>
          <td>{agent.performance?.actionsTaken || 0}</td>
          <td>{(agent.performance?.successRate || 0).toFixed(1)}%</td>
          <td>{timeAgo}</td>
        </tr>
      );
    });
  }, [agents, getTimeAgo, capitalizeFirstLetter]);

  return (
    <div className="agent-table-container">
      <h2>Agent Activity Details</h2>
      <table className="agent-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Type</th>
            <th>Name</th>
            <th>State</th>
            <th>Total Earnings</th>
            <th>Earnings/Hour</th>
            <th>Opportunities</th>
            <th>Actions</th>
            <th>Success Rate</th>
            <th>Last Active</th>
          </tr>
        </thead>
        <tbody>
          {tableRows}
        </tbody>
      </table>
    </div>
  );
};

export default AgentsTable;
import React, { useEffect, useState } from 'react';
import api from '../services/api';

const OpportunitiesList = () => {
  const [opportunities, setOpportunities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchOpportunities = async () => {
      try {
        setLoading(true);
        const res = await api.getOpportunities({ limit: 10 });
        setOpportunities(res.data || []);
        setError(null);
      } catch (err) {
        console.error('Failed to fetch opportunities:', err);
        setError('Failed to load opportunities');
        setOpportunities([]);
      } finally {
        setLoading(false);
      }
    };

    fetchOpportunities();
    // Refresh every 30 seconds
    const interval = setInterval(fetchOpportunities, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) return <p className="loading">Loading opportunities...</p>;
  if (error) return <p className="error">{error}</p>;
  if (opportunities.length === 0) return <p className="empty-state">No opportunities found</p>;

  // Helper function to get time ago string
  const getTimeAgo = (date) => {
    const seconds = Math.floor((new Date() - date) / 1000);

    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 2592000) return `${Math.floor(seconds / 86400)}d ago`;

    return date.toLocaleDateString();
  };

  // Helper function to get opportunity type color
  const getOpportunityTypeColor = (type) => {
    const colors = {
      airdrop: '#3498db',
      bounty: '#e74c3c',
      freelance: '#2ecc71',
      grant: '#f39c12',
      contest: '#9b59b6',
      other: '#95a5a6'
    };
    return colors[type] || '#95a5a6';
  };

  return (
    <div className="opportunities-list">
      {opportunities.map(opp => (
        <div key={opp.id} className="opportunity-card">
          <div className="opportunity-header">
            <h3>{opp.title}</h3>
            <span
              className={`opportunity-type type-${opp.type}`}
              style={{ backgroundColor: getOpportunityTypeColor(opp.type) }}
            >
              {opp.type}
            </span>
          </div>
          <p className="opportunity-description">{opp.description}</p>
          <div className="opportunity-meta">
            <span>💰 {opp.reward || 'Unknown value'}</span>
            <span>📍 {opp.source}</span>
            <span>🕒 {getTimeAgo(new Date(opp.postedAt))}</span>
          </div>
          {opp.requirements && opp.requirements.length > 0 && (
            <div className="opportunity-requirements">
              <strong>Requirements:</strong> {opp.requirements.join(', ')}
            </div>
          )}
          {opp.tags && opp.tags.length > 0 && (
            <div className="opportunity-tags">
              {opp.tags.map(tag => (
                <span key={tag} className="tag">{tag}</span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export default OpportunitiesList;
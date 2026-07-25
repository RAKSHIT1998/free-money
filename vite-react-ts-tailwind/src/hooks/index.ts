import { useState, useEffect, useCallback } from 'react';
import apiClient from '../services/api';
import {
  WalletData,
  WalletBalance,
  WalletTransaction,
  Agent,
  AgentStatistics,
  Opportunity,
  OpportunityStatistics,
  SystemHealth
} from '../types';

// Wallet hooks
export const useWallet = () => {
  const [balance, setBalance] = useState<WalletBalance | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchWallet = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiClient.get<ApiResponse<WalletData>>('/wallet');
      if (response.data.success) {
        setBalance(response.data.data.balance);
        setTransactions(response.data.data.transactions);
        setError(null);
      } else {
        setError(response.data.message || 'Failed to fetch wallet data');
      }
    } catch (err) {
      setError('Failed to fetch wallet data');
    } finally {
      setLoading(false);
    }
  }, []);

  const deposit = useCallback(async (amount: number, description: string) => {
    try {
      const response = await apiClient.post<ApiResponse<WalletBalance>>('/wallet/deposit', {
        amount,
        description
      });
      if (response.data.success) {
        setBalance(response.data.data);
        await fetchWallet(); // Refresh transactions
        return true;
      }
      return false;
    } catch (err) {
      return false;
    }
  }, [fetchWallet]);

  const withdraw = useCallback(async (amount: number, description: string) => {
    try {
      const response = await apiClient.post<ApiResponse<WalletBalance>>('/wallet/withdraw', {
        amount,
        description
      });
      if (response.data.success) {
        setBalance(response.data.data);
        await fetchWallet(); // Refresh transactions
        return true;
      }
      return false;
    } catch (err) {
      return false;
    }
  }, [fetchWallet]);

  // Fetch wallet data on mount
  useEffect(() => {
    fetchWallet();
  }, [fetchWallet]);

  return {
    balance,
    transactions,
    loading,
    error,
    deposit,
    withdraw,
    refresh: fetchWallet
  };
};

// Agent hooks
export const useAgents = () => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentStats, setAgentStats] = useState<AgentStatistics | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAgents = useCallback(async (filters: { type?: string; state?: string; running?: boolean } = {}) => {
    setLoading(true);
    try {
      const queryParams = new URLSearchParams();
      if (filters.type) queryParams.append('type', filters.type);
      if (filters.state) queryParams.append('state', filters.state);
      if (filters.running !== undefined) queryParams.append('running', filters.running.toString());

      const response = await apiClient.get<ApiResponse<{ agents: Agent[]; statistics: AgentStatistics }>>(
        `/agents${queryParams.toString() ? `?${queryParams.toString()}` : ''}`
      );
      if (response.data.success) {
        setAgents(response.data.data.agents);
        setAgentStats(response.data.data.statistics);
        setError(null);
      } else {
        setError(response.data.message || 'Failed to fetch agents');
      }
    } catch (err) {
      setError('Failed to fetch agents');
    } finally {
      setLoading(false);
    }
  }, []);

  const spawnAgent = useCallback(async (type: 'cryptoHunter' | 'opportunityScout' | 'developer' | 'manager', options: { name?: string; config?: any } = {}) => {
    try {
      const response = await apiClient.post<ApiResponse<{ data: Agent }>>('/agents/spawn', {
        type,
        ...options
      });
      if (response.data.success) {
        await fetchAgents(); // Refresh agents list
        return response.data.data;
      }
      return null;
    } catch (err) {
      return null;
    }
  }, [fetchAgents]);

  const updateAgentConfig = useCallback(async (id: number, config: any) => {
    try {
      const response = await apiClient.put<ApiResponse<{ message: string }>>(`/agents/${id}/config`, config);
      return response.data.success;
    } catch (err) {
      return false;
    }
  }, []);

  const deleteAgent = useCallback(async (id: number) => {
    try {
      const response = await apiClient.delete<ApiResponse<{ message: string }>>(`/agents/${id}`);
      if (response.data.success) {
        await fetchAgents(); // Refresh agents list
        return true;
      }
      return false;
    } catch (err) {
      return false;
    }
  }, [fetchAgents]);

  // Fetch agents on mount
  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  return {
    agents,
    agentStats,
    loading,
    error,
    fetchAgents,
    spawnAgent,
    updateAgentConfig,
    deleteAgent,
    refresh: fetchAgents
  };
};

// Opportunities hooks
export const useOpportunities = () => {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [opportunityStats, setOpportunityStats] = useState<OpportunityStatistics | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOpportunities = useCallback(async (filters: {
    type?: string;
    status?: string;
    search?: string;
    limit?: number;
    offset?: number
  } = {}) => {
    setLoading(true);
    try {
      const queryParams = new URLSearchParams();
      if (filters.type) queryParams.append('type', filters.type);
      if (filters.status) queryParams.append('status', filters.status);
      if (filters.search) queryParams.append('search', filters.search);
      if (filters.limit) queryParams.append('limit', filters.limit.toString());
      if (filters.offset) queryParams.append('offset', filters.offset.toString());

      const response = await apiClient.get<ApiResponse<{ opportunities: Opportunity[]; statistics: OpportunityStatistics }>>(
        `/opportunities${queryParams.toString() ? `?${queryParams.toString()}` : ''}`
      );
      if (response.data.success) {
        setOpportunities(response.data.data.opportunities);
        setOpportunityStats(response.data.data.statistics);
        setError(null);
      } else {
        setError(response.data.message || 'Failed to fetch opportunities');
      }
    } catch (err) {
      setError('Failed to fetch opportunities');
    } finally {
      setLoading(false);
    }
  }, []);

  const syncOpportunities = useCallback(async () => {
    try {
      const response = await apiClient.post<ApiResponse<{ count: number }>>('/opportunities/sync');
      if (response.data.success) {
        await fetchOpportunities(); // Refresh opportunities list
        return response.data.data.count;
      }
      return 0;
    } catch (err) {
      return 0;
    }
  }, [fetchOpportunities]);

  // Fetch opportunities on mount
  useEffect(() => {
    fetchOpportunities();
  }, [fetchOpportunities]);

  return {
    opportunities,
    opportunityStats,
    loading,
    error,
    fetchOpportunities,
    syncOpportunities,
    refresh: fetchOpportunities
  };
};

// System health hook
export const useSystemHealth = () => {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    try {
      // Note: Health endpoint is at /health, not /api/health based on server.js
      const response = await apiClient.get<ApiResponse<SystemHealth>>('/health');
      if (response.data.success) {
        setHealth(response.data.data);
        setError(null);
      } else {
        setError(response.data.message || 'Failed to fetch system health');
      }
    } catch (err) {
      setError('Failed to fetch system health');
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch health on mount and set up periodic refresh
  useEffect(() => {
    fetchHealth();

    // Set up interval to refresh health every 30 seconds
    const interval = setInterval(fetchHealth, 30000);
    return () => clearInterval(interval);
  }, [fetchHealth]);

  return {
    health,
    loading,
    error,
    refresh: fetchHealth
  };
};
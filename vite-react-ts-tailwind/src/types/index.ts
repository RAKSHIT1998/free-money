// Authentication types
export interface LoginResponse {
  success: boolean;
  token: string;
  user: User;
}

export interface User {
  id: number;
  username: string;
  email: string;
  // Add other user properties as needed
}

// Agent types
export interface AgentPerformance {
  earnings: number;
  opportunitiesFound: number;
  actionsTaken: number;
  successRate: number;
  lastUpdated: string;
}

export interface AgentConfig {
  scanInterval?: number;
  maxResultsPerScan?: number;
  minRewardThreshold?: number;
  taskInterval?: number;
  maxTasksPerCycle?: number;
  evaluationInterval?: number;
  // Add other config properties as needed
}

export interface Agent {
  id: number;
  type: 'cryptoHunter' | 'opportunityScout' | 'developer' | 'manager';
  name: string;
  state: 'idle' | 'active' | 'resting' | 'error';
  isRunning: boolean;
  createdAt: string;
  lastActive: string;
  performance: AgentPerformance;
  config?: AgentConfig;
}

export interface AgentStatistics {
  total: number;
  byType: {
    cryptoHunter: number;
    opportunityScout: number;
    developer: number;
    manager: number;
  };
  averagePerformance: {
    earnings: number;
    opportunitiesFound: number;
    actionsTaken: number;
    successRate: number;
  };
  uptime: number; // in milliseconds
}

// Opportunity types
export interface Opportunity {
  id: number;
  title: string;
  description: string;
  url?: string;
  source?: string;
  type: 'airdrop' | 'bounty' | 'freelance' | 'grant' | 'contest' | 'other';
  reward: string;
  requirements?: string[];
  tags?: string[];
  postedAt: string;
  updatedAt: string;
  status: 'active' | 'expired' | 'claimed';
}

export interface OpportunityStatistics {
  totalOpportunities: number;
  byType: {
    airdrop: number;
    bounty: number;
    freelance: number;
    grant: number;
    contest: number;
    other: number;
  };
  byStatus: {
    active: number;
    expired: number;
    claimed: number;
  };
  opportunitiesPerDay: number;
  lastUpdated: string;
}

// Wallet types
export interface WalletTransaction {
  id: number;
  type: 'deposit' | 'withdrawal' | 'earning';
  amount: number;
  description: string;
  timestamp: string;
  referenceId?: number;
  referenceType?: 'agent' | 'opportunity' | null;
}

export interface WalletBalance {
  balance: number;
  currency: string;
  lastUpdated: string;
}

export interface WalletData {
  balance: WalletBalance;
  transactions: WalletTransaction[];
}

// System health types
export interface SystemHealth {
  status: string;
  timestamp: string;
  service: string;
  version: string;
}

// API response wrapper
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}
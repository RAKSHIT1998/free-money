import axios from 'axios';

// Create axios instance with base URL from backend
const api = axios.create({
  baseURL: 'http://localhost:5009/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to attach auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor to handle common errors
api.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    // Handle 401 Unauthorized errors
    if (error.response && error.response.status === 401) {
      // Clear token and redirect to login if needed
      localStorage.removeItem('token');
      // Optionally redirect to login page
      // window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Auth endpoints
export const authAPI = {
  login: (credentials) => api.post('/auth/login', credentials),
  register: (userData) => api.post('/auth/register', userData),
  logout: () => api.post('/auth/logout'),
};

// Agent endpoints
export const agentAPI = {
  getAgents: () => api.get('/agents'),
  getAgentById: (id) => api.get(`/agents/${id}`),
  createAgent: (agentData) => api.post('/agents', agentData),
  updateAgent: (id, agentData) => api.put(`/agents/${id}`, agentData),
  deleteAgent: (id) => api.delete(`/agents/${id}`),
};

// Opportunity endpoints
export const opportunityAPI = {
  getOpportunities: (params) => api.get('/opportunities', { params }),
  getOpportunityById: (id) => api.get(`/opportunities/${id}`),
  createOpportunity: (opportunityData) => api.post('/opportunities', opportunityData),
  updateOpportunity: (id, opportunityData) => api.put(`/opportunities/${id}`, opportunityData),
  deleteOpportunity: (id) => api.delete(`/opportunities/${id}`),
};

// Wallet endpoints
export const walletAPI = {
  getWallet: () => api.get('/wallet'),
  // Note: deposit/withdraw might not be implemented in backend yet
  // addFunds: (amount) => api.post('/wallet/deposit', { amount }),
  // withdrawFunds: (amount) => api.post('/wallet/withdraw', { amount }),
};

// Default export for backward compatibility
export default {
  // Auth
  login: authAPI.login,
  register: authAPI.register,
  logout: authAPI.logout,

  // Agents
  getAgents: agentAPI.getAgents,
  getAgentById: agentAPI.getAgentById,
  createAgent: agentAPI.createAgent,
  updateAgent: agentAPI.updateAgent,
  deleteAgent: agentAPI.deleteAgent,

  // Opportunities
  getOpportunities: opportunityAPI.getOpportunities,
  getOpportunityById: opportunityAPI.getOpportunityById,
  createOpportunity: opportunityAPI.createOpportunity,
  updateOpportunity: opportunityAPI.updateOpportunity,
  deleteOpportunity: opportunityAPI.deleteOpportunity,

  // Wallet
  getWallet: walletAPI.getWallet,
};
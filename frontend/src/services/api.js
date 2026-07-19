import axios from 'axios';

// Create an axios instance with base URL from environment variable or default
const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || 'http://localhost:5000/api',
  // Include credentials if needed (for cookies, etc.)
  withCredentials: true
});

// Request interceptor to add auth token if available
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

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Handle 401 Unauthorized errors (token expired or invalid)
    if (error.response && error.response.status === 401) {
      // Optionally redirect to login page
      // window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Agent-related API calls
export const agentApi = {
  getAllAgents: (params) => api.get('/agents', { params }),
  getAgentById: (id) => api.get(`/agents/${id}`),
  createAgent: (data) => api.post('/agents', data),
  updateAgent: (id, data) => api.put(`/agents/${id}`, data),
  deleteAgent: (id) => api.delete(`/agents/${id}`),
  getAgentStats: () => api.get('/agents/stats')
};

// Opportunity-related API calls
export const opportunityApi = {
  getOpportunities: (params) => api.get('/opportunities', { params }),
  getOpportunityById: (id) => api.get(`/opportunities/${id}`),
  getOpportunityStats: () => api.get('/opportunities/stats')
};

// Export a combined API object for backward compatibility
export default {
  ...agentApi,
  ...opportunityApi
};
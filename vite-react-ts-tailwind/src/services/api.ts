import axios from 'axios';
import { useAuth } from '../context/AuthContext';

// Create axios instance with base URL
const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api',
});

// Request interceptor to add auth token
apiClient.interceptors.request.use((config) => {
  const { token } = useAuth();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor to handle 401 errors
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Handle unauthorized access - could redirect to login
      // For now, just reject the promise
      const auth = useAuth();
      if (auth.logout) {
        auth.logout();
      }
      // Redirect to login would typically be handled here
    }
    return Promise.reject(error);
  }
);

export default apiClient;
import axios from 'axios';
import { useAuth } from '../context/AuthContext';

const useApi = () => {
  const { token } = useAuth();

  const api = axios.create({
    baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api',
  });

  // Request interceptor to add auth token
  api.interceptors.request.use((config) => {
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });

  // Response interceptor to handle 401 errors
  api.interceptors.response.use(
    (response) => response,
    (error) => {
      if (error.response?.status === 401) {
        // Handle unauthorized access - could redirect to login
        // For now, just reject the promise
        return Promise.reject(error);
      }
      return Promise.reject(error);
    }
  );

  return api;
};

export default useApi;

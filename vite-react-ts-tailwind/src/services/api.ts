import axios from 'axios';

// Relative path, not an absolute localhost URL — this app is served from the same
// origin as its own API (server.js serves both the dashboard build and /api/* on one
// port), so '/api' resolves correctly on ANY domain it's deployed to. The previous
// hardcoded 'http://localhost:5000/api' fallback is baked in at BUILD time (Vite
// inlines import.meta.env.* into the bundle) — on Render, that meant every visitor's
// browser tried to reach their OWN machine's localhost:5000 instead of the real
// server, failing with a generic "Network Error" on login. VITE_API_URL still
// overrides this when explicitly set (e.g. local dev via ecosystem.config.js, where
// the dashboard and API run on separate ports).
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
});

// Request interceptor to add auth token from localStorage
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
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

export default api;
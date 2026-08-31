import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Skeleton } from '../components/ui/Skeleton';
import { FiUser, FiLock, FiActivity } from 'react-icons/fi';
import { Toaster } from 'react-hot-toast';
import api from '../services/api';

const LoginPage = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const { data } = await api.post('/auth/login', { username: email, password });

      if (data.success && data.data && data.data.token) {
        login(data.data.token, data.data.user);
        navigate('/dashboard', { replace: true });
      } else {
        throw new Error('Invalid response format');
      }
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
      <Toaster position="top-center" />

      <div className="w-full max-w-md space-y-6">
        <div className="flex items-center justify-center">
          <div className="w-16 h-16 bg-gradient-to-r from-green-500 to-blue-500 rounded-lg flex items-center justify-center">
            <FiActivity size={24} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold text-center ml-4">Free Money App</h1>
        </div>

        <Card className="w-full">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                Username
              </label>
              <div className="relative">
                <FiUser size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  id="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="username"
                  className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter your username"
                  disabled={loading}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                Password
              </label>
              <div className="relative">
                <FiLock size={20} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="password"
                  id="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter your password"
                  disabled={loading}
                />
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border-l-4 border-red-500 text-red-700 p-4">
                <p className="font-medium">{error}</p>
              </div>
            )}

            <div className="flex items-center justify-between">
              <label className="flex items-center cursor-pointer">
                <input type="checkbox" className="mr-2 h-4 w-4 text-blue-600" defaultChecked />
                <span className="text-sm text-gray-600">Remember me</span>
              </label>
              <Button variant="outline" size="sm">
                Forgot Password?
              </Button>
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Skeleton height={16} width="20" className="mr-2" />
                  Signing in...
                </>
              ) : (
                <span>Sign In</span>
              )}
            </Button>
          </form>
        </Card>

        <div className="text-center text-sm text-gray-500">
          <p>
            Don't have an account?{' '}
            <span className="text-blue-600 hover underline cursor-pointer">
              Sign up
            </span>
          </p>
          <p className="mt-2">
            Use the admin username/password configured on the backend (ADMIN_USERNAME / ADMIN_PASSWORD_HASH in .env).
          </p>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
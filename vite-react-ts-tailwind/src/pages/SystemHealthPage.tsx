import { useSystemHealth } from '../hooks';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Skeleton } from '../components/ui/Skeleton';
import { FiActivity, FiCpu, FiMemory, FiZap, FiServer, FiCheckCircle, FiAlertTriangle, FiCalendar, FiRefreshCw } from 'react-icons/fi';
import { useState, useEffect } from 'react';

const SystemHealthPage = () => {
  const { health, loading, error, refresh } = useSystemHealth();
  const [metrics, setMetrics] = useState<Array<{ label: string; value: string; status: string }>>([]);
  const [refreshInterval, setRefreshInterval] = useState<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Start auto-refresh every 30 seconds
    const interval = setInterval(() => {
      refresh();
    }, 30000);
    setRefreshInterval(interval);

    // Also fetch some additional metrics (in a real app, these would come from API endpoints)
    setMetrics([
      { label: 'CPU Usage', value: '45%', status: 'normal' },
      { label: 'Memory Usage', value: '62%', status: 'warning' },
      { label: 'Disk Usage', value: '78%', status: 'warning' },
      { label: 'Network I/O', value: '12.5 Mbps', status: 'normal' },
      { label: 'Active Processes', value: '124', status: 'normal' },
      { label: 'Uptime', value: '2 days, 5 hours', status: 'normal' },
    ]);
  }, [refresh]);

  useEffect(() => {
    return () => {
      if (refreshInterval) {
        clearInterval(refreshInterval);
      }
    };
  }, [refreshInterval]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'normal': return 'text-green-600';
      case 'warning': return 'text-yellow-600';
      case 'critical': return 'text-red-600';
      default: return 'text-gray-600';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'normal': return <FiCheckCircle size={16} className="text-green-600" />;
      case 'warning': return <FiAlertTriangle size={16} className="text-yellow-600" />;
      case 'critical': return <FiAlertTriangle size={16} className="text-red-600" />;
      default: return <FiCheckCircle size={16} className="text-gray-600" />;
    }
  };

  return (
    <div>
      {/* Page Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">System Health</h1>
        {error ? (
          <div className="flex items-center space-x-2 text-red-600">
            <FiAlertTriangle size={20} />
            <span>{error}</span>
          </div>
        ) : (
          <Button variant="outline" onClick={refresh}>
            <FiActivity size={20} className="mr-2" /> Refresh
          </Button>
        )}
      </div>

      {/* Status Overview */}
      <div className="mb-6">
        <Card>
          {loading ? (
            <div className="text-center py-8">
              <Skeleton height={24} width="32" className="mx-auto mb-3" />
              <Skeleton height={20} width="40" className="mx-auto mb-3" />
              <Skeleton height={16} width="32" className="mx-auto" />
            </div>
          ) : (
            <>
              {health ? (
                <div className="text-center">
                  <h2 className="text-3xl font-bold mb-2">
                    {health.status === 'OK' ? (
                      <>
                        <FiCheckCircle size={24} className="text-green-600 mr-2" />
                        Operational
                      </>
                    ) : (
                      <>
                        <FiAlertTriangle size={24} className="text-red-600 mr-2" />
                        Issues Detected
                      </>
                    )}
                  </h2>
                  <p className="text-lg text-gray-600">
                    {health.service} v{health.version}
                  </p>
                  <p className="text-sm text-gray-500 mt-2">
                    Last checked: {new Date(health.timestamp).toLocaleString()}
                  </p>
                </div>
              ) : (
                <p className="text-center py-8 text-gray-500">Unable to load system health</p>
              )}
            </>
          )}
        </Card>
      </div>

      {/* System Metrics */}
      <div className="mb-6">
        <div className="flex items-center justify-between pb-4">
          <h3 className="text-lg font-semibold">System Metrics</h3>
          <Button variant="outline" size="sm">
            <FiRefreshCw size={16} className="mr-2" /> Refresh Metrics
          </Button>
        </div>

        <div className="space-y-4">
          {metrics.map((metric, index) => (
            <div key={index} className="flex justify-between items-center p-4 bg-gray-50 rounded-lg">
              <div className="flex items-center space-x-3">
                <div className="flex-shrink-0">
                  {metric.label === 'CPU Usage' ? (
                    <FiCpu size={20} className="text-blue-500" />
                  ) : metric.label === 'Memory Usage' ? (
                    <FiMemory size={20} className="text-green-500" />
                  ) : metric.label === 'Disk Usage' ? (
                    <FiServer size={20} className="text-red-500" />
                  ) : metric.label === 'Network I/O' ? (
                    <FiZap size={20} className="text-yellow-500" />
                  ) : (
                    <FiActivity size={20} className="text-gray-500" />
                  )}
                </div>
                <div>
                  <h4 className="font-medium">{metric.label}</h4>
                  <p className="text-sm text-gray-500">{metric.value}</p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                {getStatusIcon(metric.status)}
                <span className={`${getStatusColor(metric.status)} font-medium`}>
                  {metric.status.charAt(0).toUpperCase() + metric.status.slice(1)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Service Status */}
      <div className="mb-6">
        <div className="flex items-center justify-between pb-4">
          <h3 className="text-lg font-semibold">Service Status</h3>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center space-x-3">
              <FiCheckCircle size={20} className="text-green-600" />
              <div>
                <h4 className="font-medium">API Service</h4>
                <p className="text-sm text-gray-500">Operational</p>
              </div>
            </div>
            <span className="text-green-600 font-medium">● Online</span>
          </div>
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center space-x-3">
              <FiCheckCircle size={20} className="text-green-600" />
              <div>
                <h4 className="font-medium">Database</h4>
                <p className="text-sm text-gray-500">Connected</p>
              </div>
            </div>
            <span className="text-green-600 font-medium">● Online</span>
          </div>
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center space-x-3">
              <FiActivity size={20} className="text-blue-600" />
              <div>
                <h4 className="font-medium">Agent System</h4>
                <p className="text-sm text-gray-500">Running</p>
              </div>
            </div>
            <span className="text-green-600 font-medium">● Online</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SystemHealthPage;
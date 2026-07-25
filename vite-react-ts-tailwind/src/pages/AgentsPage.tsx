import { useAgents } from '../hooks';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Skeleton } from '../components/ui/Skeleton';
import { FiBriefcase, FiSettings, FiChevronRight, FiPlus, FiTrash, FiActivity, FiCheckCircle, FiCreditCard, FiRefreshCw } from 'react-icons/fi';
import { useState } from 'react';

const AgentsPage = () => {
  const { agents, agentStats, loading, fetchAgents, spawnAgent, deleteAgent } = useAgents();
  const [agentName, setAgentName] = useState('');
  const [scanInterval, setScanInterval] = useState(30000);
  const [maxResults, setMaxResults] = useState(10);

  const handleSpawnAgent = async () => {
    const newAgent = await spawnAgent('cryptoHunter', {
      name: agentName || `Crypto Hunter Agent ${Date.now()}`,
      config: {
        scanInterval,
        maxResultsPerScan: maxResults
      }
    });

    if (newAgent) {
      // Reset form
      setAgentName('');
      setScanInterval(30000);
      setMaxResults(10);
      // Show success toast (to be implemented)
    }
  };

  const handleDeleteAgent = async (id: number) => {
    if (window.confirm('Are you sure you want to delete this agent?')) {
      const success = await deleteAgent(id);
      if (success) {
        // Show success toast
      }
    }
  };

  const getAgentTypeColor = (type: string) => {
    switch (type) {
      case 'cryptoHunter': return 'bg-blue-100 text-blue-800';
      case 'opportunityScout': return 'bg-green-100 text-green-800';
      case 'developer': return 'bg-purple-100 text-purple-800';
      case 'manager': return 'bg-orange-100 text-orange-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getAgentStatusColor = (state: string) => {
    switch (state) {
      case 'active': return 'bg-green-100 text-green-800';
      case 'idle': return 'bg-yellow-100 text-yellow-800';
      case 'resting': return 'bg-blue-100 text-blue-800';
      case 'error': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div>
      {/* Page Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Agent Management</h1>
        <Button variant="outline" onClick={handleSpawnAgent}>
          <FiPlus size={20} className="mr-2" /> Spawn New Agent
        </Button>
      </div>

      {/* Stats Overview */}
      {!loading && agentStats ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Card>
            <div className="flex items-center justify-between p-4">
              <div>
                <h3 className="text-sm font-medium text-gray-500">Total Agents</h3>
                <p className="text-2xl font-bold">{agentStats.total}</p>
              </div>
              <div className="p-2 bg-gray-100 rounded-full">
                <FiBriefcase size={24} className="text-gray-600" />
              </div>
            </div>
          </Card>

          <Card>
            <div className="flex items-center justify-between p-4">
              <div>
                <h3 className="text-sm font-medium text-gray-500">Active Agents</h3>
                <p className="text-2xl font-bold">
                  {agents.filter(agent => agent.state === 'active').length}
                </p>
              </div>
              <div className="p-2 bg-green-100 rounded-full">
                <FiCheckCircle size={24} className="text-green-600" />
              </div>
            </div>
          </Card>

          <Card>
            <div className="flex items-center justify-between p-4">
              <div>
                <h3 className="text-sm font-medium text-gray-500">Total Earnings</h3>
                <p className="text-2xl font-bold">
                  ${(
                    (agentStats.averagePerformance?.earnings ?? 0) *
                    (agentStats.total ?? 0)
                  ).toFixed(2)}
                </p>
              </div>
              <div className="p-2 bg-yellow-100 rounded-full">
                <FiCreditCard size={24} className="text-yellow-600" />
              </div>
            </div>
          </Card>

          <Card>
            <div className="flex items-center justify-between p-4">
              <div>
                <h3 className="text-sm font-medium text-gray-500">Avg Success Rate</h3>
                <p className="text-2xl font-bold">
                  {(agentStats.averagePerformance?.successRate?.toFixed(1) ?? 0)}%
                </p>
              </div>
              <div className="p-2 bg-purple-100 rounded-full">
                {/* Using FiSettings as alternative since specific slider icons don't exist */}
                <FiSettings size={24} className="text-purple-600" />
              </div>
            </div>
          </Card>
        </div>
      ) : null}

      {/* Loading State */}
      {loading && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <Card key={i} className="h-32">
                <Skeleton height={20} width="full" className="mb-2" />
                <Skeleton height={16} width="1/2" className="mt-2" />
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Agent List */}
      <Card>
        <div className="flex items-center justify-between pb-4">
          <h3 className="text-lg font-semibold">Active Agents</h3>
          <Button variant="outline" size="sm" onClick={fetchAgents}>
            <FiRefreshCw size={16} className="mr-2" /> Refresh
          </Button>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-start space-x-3 p-3">
                <div className="flex-shrink-0 w-10 h-10 bg-gray-200 rounded-full"></div>
                <div className="flex-1 space-y-1">
                  <Skeleton height={16} width="2/3" />
                  <Skeleton height={14} width="1/2" className="mt-1" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            {agents.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <p>No agents found</p>
                <Button variant="outline" onClick={handleSpawnAgent}>
                  <FiPlus size={20} className="mr-2" /> Spawn First Agent
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {agents.map((agent) => (
                  <div key={agent.id} className="flex items-start space-x-3 p-4 border border-gray-200 rounded-lg">
                    <div className="flex-shrink-0">
                      <div className={`w-10 h-10 flex items-center justify-${agent.state === 'active' ? 'center' : 'flex-start'} rounded-full ${agent.state === 'active' ? 'bg-green-500' : agent.state === 'idle' ? 'bg-yellow-500' : agent.state === 'resting' ? 'bg-blue-500' : 'bg-red-500'}`}>
                        {agent.state === 'active' ? (
                          <FiActivity size={10} className="animate-pulse" />
                        ) : null}
                      </div>
                    </div>
                    <div className="flex-1 space-y-2">
                      <div className="flex justify-between items-start">
                        <h4 className="font-medium">{agent.name}</h4>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getAgentTypeColor(agent.type)}`}>
                          {agent.type.charAt(0).toUpperCase() + agent.type.slice(1)}
                        </span>
                      </div>
                      <div className="flex justify-between items-start">
                        <span className="text-sm font-medium">Status:</span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getAgentStatusColor(agent.state)}`}>
                          {agent.state.charAt(0).toUpperCase() + agent.state.slice(1)}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="text-gray-500">Earnings:</span>
                          <span className="font-medium">$${agent.performance.earnings.toFixed(2)}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Opportunities:</span>
                          <span className="font-medium">{agent.performance.opportunitiesFound}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Success Rate:</span>
                          <span className="font-medium">${agent.performance.successRate.toFixed(1)}%</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Actions:</span>
                          <span className="font-medium">{agent.performance.actionsTaken}</span>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2 text-xs text-gray-500">
                        <FiActivity size={14} className="mr-1" />
                        <span>Last active: {new Date(agent.lastActive).toLocaleTimeString()}</span>
                      </div>
                    </div>
                    <div className="flex-shrink-0 space-x-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          // Show agent details modal
                        }}
                      >
                        <FiChevronRight size={16} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteAgent(agent.id)}
                        className="text-red-500 hover:text-red-700"
                      >
                        <FiTrash size={16} />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
};

export default AgentsPage;
import { useOpportunities } from '../hooks';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Skeleton } from '../components/ui/Skeleton';
import { FiTruck, FiRefreshCw, FiList, FiCheckCircle, FiCalendar, FiSettings } from 'react-icons/fi';
import { useState } from 'react';

// Ensure file is saved to trigger tsc update

const OpportunitiesPage = () => {
  const { opportunities, opportunityStats, loading, error, fetchOpportunities, syncOpportunities } = useOpportunities();
  const [filters, setFilters] = useState({
    type: '',
    status: '',
    search: '',
    limit: 50,
    offset: 0
  });
  const [sortBy, setSortBy] = useState('postedAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const handleSyncOpportunities = async () => {
    const count = await syncOpportunities();
    if (count > 0) {
      // Show success toast
    }
  };

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFilters({ ...filters, search: e.target.value });
  };

  const handleFilterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setFilters({ ...filters, [e.target.name]: e.target.value });
  };

  const handleSortChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSortBy(e.target.value);
  };

  const handleOrderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSortOrder(e.target.value as 'asc' | 'desc');
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'airdrop': return 'bg-blue-100 text-blue-800';
      case 'bounty': return 'bg-green-100 text-green-800';
      case 'freelance': return 'bg-purple-100 text-purple-800';
      case 'grant': return 'bg-yellow-100 text-yellow-800';
      case 'contest': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-800';
      case 'expired': return 'bg-red-100 text-red-800';
      case 'claimed': return 'bg-yellow-100 text-yellow-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const sortedOpportunities = [...opportunities].sort((a, b) => {
    if (sortOrder === 'asc') {
      return new Date(a[sortBy as keyof typeof a] as string | number).getTime() - new Date(b[sortBy as keyof typeof b] as string | number).getTime();
    } else {
      return new Date(b[sortBy as keyof typeof b] as string | number).getTime() - new Date(a[sortBy as keyof typeof a] as string | number).getTime();
    }
  });

  return (
    <div>
      {/* Page Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Opportunities</h1>
        <div className="flex items-center space-x-3">
          <Button variant="outline" onClick={handleSyncOpportunities}>
            <FiRefreshCw size={20} className="mr-2" /> Sync
          </Button>
          <Button variant="outline" onClick={() => {
            // Show filter/sort modal
          }}>
            <FiSettings size={20} className="mr-2" /> Filter
          </Button>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border-l-4 border-red-500 text-red-700">
          <p>{error}</p>
        </div>
      )}

      {/* Stats Overview */}
      {!loading && opportunityStats ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          <Card>
            <div className="flex items-center justify-between p-4">
              <div>
                <h3 className="text-sm font-medium text-gray-500">Total Opportunities</h3>
                <p className="text-2xl font-bold">{opportunityStats.totalOpportunities}</p>
              </div>
              <div className="p-2 bg-gray-100 rounded-full">
                <FiTruck size={24} className="text-gray-600" />
              </div>
            </div>
          </Card>

          <Card>
            <div className="flex items-center justify-between p-4">
              <div>
                <h3 className="text-sm font-medium text-gray-500">Active Opportunities</h3>
                <p className="text-2xl font-bold">{opportunityStats.byStatus?.active || 0}</p>
              </div>
              <div className="p-2 bg-green-100 rounded-full">
                <FiCheckCircle size={24} className="text-green-600" />
              </div>
            </div>
          </Card>

          <Card>
            <div className="flex items-center justify-between p-4">
              <div>
                <h3 className="text-sm font-medium text-gray-500">Avg per Day</h3>
                <p className="text-2xl font-bold">{opportunityStats.opportunitiesPerDay.toFixed(1)}</p>
              </div>
              <div className="p-2 bg-blue-100 rounded-full">
                <FiCalendar size={24} className="text-blue-600" />
              </div>
            </div>
          </Card>
        </div>
      ) : null}

      {/* Search and Filters */}
      {!loading && (
        <div className="mb-6 p-4 bg-gray-50 rounded-lg">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-[200px]">
              <input
                type="text"
                placeholder="Search opportunities..."
                value={filters.search}
                onChange={handleSearch}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <select
                name="type"
                value={filters.type}
                onChange={handleFilterChange}
                className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">All Types</option>
                <option value="airdrop">Airdrop</option>
                <option value="bounty">Bounty</option>
                <option value="freelance">Freelance</option>
                <option value="grant">Grant</option>
                <option value="contest">Contest</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <select
                name="status"
                value={filters.status}
                onChange={handleFilterChange}
                className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">All Status</option>
                <option value="active">Active</option>
                <option value="expired">Expired</option>
                <option value="claimed">Claimed</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Card key={i} className="h-48">
                <Skeleton height={20} width="full" className="mb-2" />
                <Skeleton height={16} width="3/4" className="mb-1" />
                <Skeleton height={16} width="1/2" className="mb-1" />
                <Skeleton height={16} width="1/4" className="mb-1" />
                <Skeleton height={16} width="full" className="mt-2" />
                <Skeleton height={16} width="2/3" className="mt-1" />
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Opportunities List */}
      <Card>
        <div className="flex items-center justify-between pb-4">
          <h3 className="text-lg font-semibold">Opportunities List</h3>
          <div className="flex items-center space-x-2">
            <select
              value={sortBy}
              onChange={handleSortChange}
              className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="postedAt">Posted Date</option>
              <option value="title">Title</option>
              <option value="type">Type</option>
              <option value="reward">Reward</option>
            </select>
            <select
              value={sortOrder}
              onChange={handleOrderChange}
              className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="desc">Newest First</option>
              <option value="asc">Oldest First</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-start space-x-3 p-3 border-t border-gray-200">
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
            {opportunities.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <p>No opportunities found</p>
                <Button variant="outline" onClick={handleSyncOpportunities}>
                  <FiRefreshCw size={20} className="mr-2" /> Sync Opportunities
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {sortedOpportunities.slice(0, 20).map((opp) => (
                  <div key={opp.id} className="flex items-start space-x-3 p-4 border-t border-gray-200">
                    <div className="flex-shrink-0">
                      <div className="w-10 h-10 flex items-center justify-center rounded-full bg-blue-50">
                        <FiTruck size={20} className="text-blue-500" />
                      </div>
                    </div>
                    <div className="flex-1 space-y-1">
                      <div className="flex justify-between items-start">
                        <h4 className="font-medium">{opp.title}</h4>
                        <div className="flex items-center space-x-2">
                          <span className={`${getTypeColor(opp.type)} px-2 py-0.5 rounded-full text-xs font-medium`}>
                            {opp.type.charAt(0).toUpperCase() + opp.type.slice(1)}
                          </span>
                          <span className={`${getStatusColor(opp.status)} px-2 py-0.5 rounded-full text-xs font-medium`}>
                            {opp.status.charAt(0).toUpperCase() + opp.status.slice(1)}
                          </span>
                        </div>
                      </div>
                      <p className="text-sm text-gray-600 line-clamp-2">{opp.description}</p>
                      <div className="flex justify-between items-start text-sm">
                        <div>
                          <span className="text-gray-500">Reward:</span>
                          <span className="font-medium">{opp.reward}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Source:</span>
                          <span className="font-medium">{opp.source || 'Unknown'}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Found:</span>
                          <span className="font-medium">{new Date(opp.postedAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                      {opp.tags && opp.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {opp.tags.map((tag, index) => (
                            <span key={index} className="px-2 py-0.5 rounded-full text-xs bg-gray-200 text-gray-700">
                              #{tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex-shrink-0 text-right space-y-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          // View opportunity details
                        }}
                      >
                        <FiList size={16} className="mr-1" /> Details
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          // Claim opportunity
                        }}
                        className="text-green-500 hover:text-green-700"
                      >
                        <FiCheckCircle size={16} className="mr-1" /> Claim
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <div className="flex justify-end pt-4">
          <Button variant="outline" size="sm" onClick={fetchOpportunities}>
            <FiRefreshCw size={16} className="mr-2" /> Refresh
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default OpportunitiesPage;
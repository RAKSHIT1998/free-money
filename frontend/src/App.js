import React, { useEffect, useState } from 'react';
import Dashboard from './components/Dashboard';
import AgentsTable from './components/AgentsTable';
import OpportunitiesList from './components/OpportunitiesList';
import Wallet from './components/Wallet';
import Agent3DVisualization from './components/Agent3DVisualization';
import axios from 'axios';
import './App.css';

function App() {
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    // Attempt to auto-login on app startup
    const initApp = async () => {
      try {
        // Check if we already have a token
        const token = localStorage.getItem('token');
        if (token) {
          // Set token in axios instance for future requests
          axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
          setInitialized(true);
          return;
        }

        // No token found, try to get one via demo login
        const response = await axios.post('http://localhost:5009/api/auth/login', {
          username: 'demo',
          password: 'demo'
        });

        if (response.data && response.data.data && response.data.data.token) {
          const token = response.data.data.token;
          localStorage.setItem('token', token);

          // Set token for axios instance
          axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;

          setInitialized(true);
        }
      } catch (error) {
        console.error('Auto-login failed:', error);
        // Still initialize the app even if login fails
        // The API interceptor will handle 401 responses
        setInitialized(true);
      }
    };

    initApp();
  }, []);

  if (!initialized) {
    return <div className="App">Loading application...</div>;
  }

  return (
    <div className="App">
      <header className="App-header">
        <h1>Multi-Agent Money-Making System Dashboard</h1>
      </header>
      <main>
        <Dashboard />
        <section>
          <h2>Wallet</h2>
          <Wallet />
        </section>
        <section>
          <h2>Active Agents</h2>
          <AgentsTable />
        </section>
        <section>
          <h2>3D Agent Network</h2>
          <Agent3DVisualization />
        </section>
        <section>
          <h2>Recent Opportunities</h2>
          <OpportunitiesList />
        </section>
      </main>
    </div>
  );
}

export default App;
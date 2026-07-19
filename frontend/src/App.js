import React, { useEffect, useState } from 'react';
import Dashboard from './components/Dashboard';
import AgentsTable from './components/AgentsTable';
import OpportunitiesList from './components/OpportunitiesList';
import './App.css';

function App() {
  return (
    <div className="App">
      <header className="App-header">
        <h1>Multi-Agent Money-Making System Dashboard</h1>
      </header>
      <main>
        <Dashboard />
        <section>
          <h2>Active Agents</h2>
          <AgentsTable />
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
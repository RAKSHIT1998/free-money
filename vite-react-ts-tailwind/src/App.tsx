import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';

// Import pages
import Dashboard from './pages/DashboardPage';
import LoginPage from './pages/LoginPage';
import WalletPage from './pages/WalletPage';
import AgentsPage from './pages/AgentsPage';
import OpportunitiesPage from './pages/OpportunitiesPage';
import SystemHealthPage from './pages/SystemHealthPage';

// Import layout components
import NavBar from './components/NavBar';
import Sidebar from './components/Sidebar';

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <div className="flex min-h-screen bg-gray-50 dark:bg-gray-900">
          {/* Sidebar */}
          <Sidebar />

          {/* Main content */}
          <div className="flex-1 flex flex-col">
            {/* Navbar */}
            <NavBar />

            {/* Page content */}
            <main className="flex-1 overflow-y-auto p-6">
              <Routes>
                {/* Public routes */}
                <Route path="/login" element={<LoginPage />} />
                <Route path="/" element={<Navigate to="/dashboard" replace />} />

                {/* Protected routes */}
                <Route element={<>}>
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/wallet" element={<WalletPage />} />
                  <Route path="/agents" element={<AgentsPage />} />
                  <Route path="/opportunities" element={<OpportunitiesPage />} />
                  <Route path="/system-health" element={<SystemHealthPage />} />
                </Route>
              </Routes>
            </main>
          </div>
        </div>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;

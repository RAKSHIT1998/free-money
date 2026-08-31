import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';

// Import pages
import Dashboard from './pages/DashboardPage';
import LoginPage from './pages/LoginPage';
import WalletPage from './pages/WalletPage';
import AgentsPage from './pages/AgentsPage';
import RealMoneyPage from './pages/RealMoneyPage';
import OpportunitiesPage from './pages/OpportunitiesPage';
import SystemHealthPage from './pages/SystemHealthPage';
import PrivateRoute from './components/shared/PrivateRoute';

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

                {/* Protected routes — PrivateRoute redirects to /login when not
                    authenticated, and renders these as children via <Outlet/> when it
                    is. (Previously these were nested inside a pathless Route's
                    `element` prop as a Fragment, which React Router never matches —
                    every one of these pages silently rendered nothing.) */}
                <Route element={<PrivateRoute />}>
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/wallet" element={<WalletPage />} />
                  <Route path="/agents" element={<AgentsPage />} />
                  <Route path="/real-money" element={<RealMoneyPage />} />
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

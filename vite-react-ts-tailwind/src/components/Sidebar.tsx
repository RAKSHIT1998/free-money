import { FiActivity, FiCreditCard, FiBriefcase, FiTruck, FiSettings, FiLogOut } from 'react-icons/fi';
import { NavLink, useNavigation, useLocation } from 'react-router-dom';

const Sidebar = () => {
  const location = useLocation();
  const navigate = useNavigation();

  return (
    <aside className="w-64 bg-gray-900 text-white p-4 h-full flex flex-col">
      <div className="flex items-center space-x-3 mb-6">
        <FiActivity size={24} />
        <span className="font-bold text-xl">Free Money App</span>
      </div>

      <nav className="flex-1 space-y-2">
        <NavLink
          to="/dashboard"
          className={({ isActive }) => `
            flex items-center px-3 py-2 rounded-md text-sm font-medium
            ${isActive ? 'bg-gray-700' : 'hover:bg-gray-800'}
            transition-colors
          `}
        >
          <FiChevronRight size={20} className="mr-3" />
          Dashboard
        </NavLink>

        <NavLink
          to="/wallet"
          className={({ isActive }) => `
            flex items-center px-3 py-2 rounded-md text-sm font-medium
            ${isActive ? 'bg-gray-700' : 'hover:bg-gray-800'}
            transition-colors
          `}
        >
          <FiCreditCard size={20} className="mr-3" />
          Wallet
        </NavLink>

        <NavLink
          to="/agents"
          className={({ isActive }) => `
            flex items-center px-3 py-2 rounded-md text-sm font-medium
            ${isActive ? 'bg-gray-700' : 'hover:bg-gray-800'}
            transition-colors
          `}
        >
          <FiBriefcase size={20} className="mr-3" />
          Agents
        </NavLink>

        <NavLink
          to="/opportunities"
          className={({ isActive }) => `
            flex items-center px-3 py-2 rounded-md text-sm font-medium
            ${isActive ? 'bg-gray-700' : 'hover:bg-gray-800'}
            transition-colors
          `}
        >
          <FiTruck size={20} className="mr-3" />
          Opportunities
        </NavLink>

        <NavLink
          to="/system-health"
          className={({ isActive }) => `
            flex items-center px-3 py-2 rounded-md text-sm font-medium
            ${isActive ? 'bg-gray-700' : 'hover:bg-gray-800'}
            transition-colors
          `}
        >
          <FiSettings size={20} className="mr-3" />
          System Health
        </NavLink>
      </nav>

      <div className="mt-6 pt-4 border-t border-gray-800">
        <button
          onClick={() => {
            // Handle logout - would call auth context logout function
            window.location.href = '/login';
          }}
          className="w-full flex items-center px-3 py-2 text-left text-sm font-medium
                    bg-transparent hover:bg-gray-800 rounded-md transition-colors"
        >
          <FiLogOut size={20} className="mr-3" />
          Logout
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
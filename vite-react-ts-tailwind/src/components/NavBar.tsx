import { FiLogOut, FiCreditCard, FiBriefcase, FiTruck, FiSettings, FiChevronLeft, FiChevronRight } from 'react-icons/fi';
import { useAuth } from '../context/AuthContext';

const NavBar = () => {
  const { user, logout } = useAuth();

  return (
    <nav className="bg-gray-800 text-white px-4 py-3 shadow-md flex items-center justify-between">
      <div className="flex items-center space-x-4">
        <FiChevronLeft size={24} className="cursor-pointer" />
        <h1 className="text-xl font-bold">Free Money App</h1>
      </div>
      <div className="flex items-center space-x-4">
        <span className="hidden md:inline">
          Welcome, {user?.username || 'User'}!
        </span>
        <button
          onClick={logout}
          className="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded-md"
        >
          <FiLogOut size={20} /> Logout
        </button>
      </div>
    </nav>
  );
};

export default NavBar;
import type { ReactNode } from 'react';
import { createContext, useContext, useState } from 'react';

interface AuthContextType {
  token: string | null;
  user: any;
  login: (token: string, user: any) => void;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider = ({ children }: AuthProviderProps) => {
  const [token, setToken] = useState<string | null>(() => {
    return localStorage.getItem('token');
  });
  const [user, setUser] = useState<any>(null);

  const login = (token: string, user: any) => {
    setToken(token);
    setUser(user);
    localStorage.setItem('token', token);
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('token');
  };

  // Matches the backend's PUBLIC_ACCESS_NO_LOGIN flag (server/middleware/auth.js) —
  // set together, at the same explicit user request, so the login screen itself is
  // skipped rather than just the backend accepting unauthenticated calls underneath
  // a login form that would still block on 401s it never expects. Baked in at build
  // time (Vite inlines import.meta.env.*), same mechanism as VITE_API_URL elsewhere
  // in this file's sibling api.ts.
  const isAuthenticated = !!token || import.meta.env.VITE_PUBLIC_ACCESS_NO_LOGIN === 'true';

  const contextValue = {
    token,
    user,
    login,
    logout,
    isAuthenticated,
  };

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

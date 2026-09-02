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

  // Open access by default, mirroring the backend's REQUIRE_LOGIN default in
  // server/middleware/auth.js — the two must agree, otherwise you get a login screen
  // in front of an API that doesn't want credentials, or an API rejecting a UI that
  // never collected any. Set VITE_REQUIRE_LOGIN=true (at BUILD time — Vite inlines
  // import.meta.env.*) alongside the backend's REQUIRE_LOGIN=true to restore the
  // login screen.
  const isAuthenticated = !!token || import.meta.env.VITE_REQUIRE_LOGIN !== 'true';

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

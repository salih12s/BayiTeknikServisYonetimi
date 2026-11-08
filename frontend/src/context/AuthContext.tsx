import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User } from '../types';
import { authService } from '../services/auth.service';
import { sahaService } from '../services/saha.service';

interface AuthContextType {
  user: User | null;
  login: (username: string, password: string) => Promise<void>;
  bayiLogin: (username: string, password: string) => Promise<void>;
  adminLogin: (username: string, password: string) => Promise<void>;
  sahaLogin: (username: string, password: string) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const currentUser = authService.getCurrentUser();
    if (currentUser) {
      setUser(currentUser);
    }
    setLoading(false);
  }, []);

  const login = async (username: string, password: string) => {
    const data = await authService.login(username, password);
    setUser(data.user);
  };

  const bayiLogin = async (username: string, password: string) => {
    const data = await authService.bayiLogin(username, password);
    setUser(data.user);
  };

  const adminLogin = async (username: string, password: string) => {
    const data = await authService.adminLogin(username, password);
    setUser(data.user);
  };

  const sahaLogin = async (username: string, password: string) => {
    const data = await sahaService.login(username, password);
    setUser(data.user);
  };

  const logout = () => {
    authService.logout();
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        login,
        bayiLogin,
        adminLogin,
        sahaLogin,
        logout,
        isAuthenticated: !!user,
        loading,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

import React, { Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider, createTheme, CssBaseline } from '@mui/material';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SnackbarProvider } from './context/SnackbarContext';
import Login from './components/auth/Login';
import Loading from './components/common/Loading';
import ErrorBoundary from './components/common/ErrorBoundary';

// Part 3 / P3.F2: Dashboard ve Settings lazy yüklenir. İlk paint'te
// Login için gerekli olmayan ağır kodu indirmemek için. Suspense
// fallback olarak ortak Loading bileşeni kullanılır.
const Dashboard = React.lazy(() => import('./components/dashboard/Dashboard'));
const Settings = React.lazy(() => import('./components/settings/Settings'));
// Bayiye gönderilen linkle açılan, giriş gerektirmeyen kayıt formu.
const BayiKayitFormu = React.lazy(() => import('./components/bayi/BayiKayitFormu'));

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#0D3282',
    },
    secondary: {
      main: '#dc004e',
    },
  },
});

const PrivateRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();
  
  // Loading sırasında boş ekran göster (veya loading spinner)
  if (loading) {
    return null;
  }
  
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" />;
};

const App: React.FC = () => {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <SnackbarProvider>
        <AuthProvider>
          <BrowserRouter
            future={{
              v7_startTransition: true,
              v7_relativeSplatPath: true,
            }}
          >
            <ErrorBoundary>
              <Suspense fallback={<Loading />}>
                <Routes>
                  <Route path="/login" element={<Login />} />
                  <Route path="/bayi-kayit/:token" element={<BayiKayitFormu />} />
                  <Route
                    path="/"
                    element={
                      <PrivateRoute>
                        <Dashboard />
                      </PrivateRoute>
                    }
                  />
                  <Route
                    path="/settings"
                    element={
                      <PrivateRoute>
                        <Settings />
                      </PrivateRoute>
                    }
                  />
                </Routes>
              </Suspense>
            </ErrorBoundary>
          </BrowserRouter>
        </AuthProvider>
      </SnackbarProvider>
    </ThemeProvider>
  );
};

export default App;

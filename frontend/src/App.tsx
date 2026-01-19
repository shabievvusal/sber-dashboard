import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { useEffect } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Login from './pages/Login';
import AdminDashboard from './pages/AdminDashboard';
import OperatorDashboard from './pages/OperatorDashboard';
import ManagerDashboard from './pages/ManagerDashboard';
import ProtectedRoute from './components/ProtectedRoute';
import ErrorBoundary from './components/ErrorBoundary';
import StartPage from './pages/StartPage';
import BarcodeGenerator from './pages/BarcodeGenerator';
import DataAnalytics from './pages/DataAnalytics';
import TSDControl from './pages/TSDControl';
import ShowStats from './pages/ShowStats';
import FastStat from './pages/FastStat';
import { analyzHealthMonitor } from './services/analyzHealth';
import AnalyzHealthIndicator from './components/AnalyzHealthIndicator';
import './utils/axiosConfig'; // Инициализация axios interceptors

function AppRoutes() {
  const { user, loading } = useAuth();

  // Запускаем мониторинг состояния Analyz при монтировании
  useEffect(() => {
    analyzHealthMonitor.startMonitoring(30000); // Проверка каждые 30 секунд
    
    return () => {
      analyzHealthMonitor.stopMonitoring();
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-xl">Загрузка...</div>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<StartPage />} />
      <Route path="/login" element={user ? <Navigate to="/dashboard" /> : <Login />} />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            {user?.role === 'admin' && <AdminDashboard />}
            {user?.role === 'operator' && <OperatorDashboard />}
            {user?.role === 'manager' && <ManagerDashboard />}
          </ProtectedRoute>
        }
      />
      <Route
        path="/barcodes"
        element={
          <ProtectedRoute>
            <BarcodeGenerator />
          </ProtectedRoute>
        }
      />
      <Route
        path="/analytics"
        element={
          <ProtectedRoute>
            <DataAnalytics />
          </ProtectedRoute>
        }
      />
      <Route
        path="/tsd-control"
        element={
          <ProtectedRoute>
            {user?.role === 'admin' || user?.role === 'operator' ? (
              <TSDControl />
            ) : (
              <Navigate to="/dashboard" />
            )}
          </ProtectedRoute>
        }
      />
      <Route
        path="/showstats"
        element={
          <ProtectedRoute>
            <ShowStats />
          </ProtectedRoute>
        }
      />
      <Route
        path="/faststat"
        element={
          <ProtectedRoute>
            <FastStat />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <DndProvider backend={HTML5Backend}>
        <AuthProvider>
          <BrowserRouter>
            <AppRoutes />
            <AnalyzHealthIndicator />
          </BrowserRouter>
        </AuthProvider>
      </DndProvider>
    </ErrorBoundary>
  );
}

export default App;




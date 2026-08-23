import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './lib/auth';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Bookings from './pages/Bookings';
import BookingNew from './pages/BookingNew';
import Customers from './pages/Customers';
import Rooms from './pages/Rooms';
import Availability from './pages/Availability';
import Payments from './pages/Payments';
import Staff from './pages/Staff';
import Settings from './pages/Settings';

function RequireStaff({ children }: { children: React.ReactNode }) {
  const { session, isStaff, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-cream/60">Loading…</div>;
  if (!session || !isStaff) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RequireStaff>
            <Layout />
          </RequireStaff>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/bookings" element={<Bookings />} />
        <Route path="/bookings/new" element={<BookingNew />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/rooms" element={<Rooms />} />
        <Route path="/availability" element={<Availability />} />
        <Route path="/payments" element={<Payments />} />
        <Route path="/staff" element={<Staff />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';

const AdminRoute = () => {
  const { user, isAuthChecking } = useAuthStore();
  if (isAuthChecking) return <div className="flex min-h-screen items-center justify-center bg-ink-50"><span className="h-10 w-10 animate-spin rounded-full border-2 border-primary-200 border-t-primary-600" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'admin') return <Navigate to={user.role === 'teacher' ? '/dashboard/teacher' : '/dashboard/student'} replace />;
  return <Outlet />;
};

export default AdminRoute;

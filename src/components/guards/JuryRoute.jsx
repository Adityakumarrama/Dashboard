import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export default function JuryRoute({ children }) {
  const { isJury, isAdmin, loading } = useAuth();

  if (loading) return null;

  // Allow admins to view jury pages too
  if (!isJury && !isAdmin) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

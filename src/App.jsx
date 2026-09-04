import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';

// Guards
import ProtectedRoute from './components/guards/ProtectedRoute';
import AdminRoute from './components/guards/AdminRoute';
import JuryRoute from './components/guards/JuryRoute';

// Layouts
import AdminLayout from './components/layout/AdminLayout';
import JuryLayout from './components/layout/JuryLayout';

// Pages
import Login from './pages/Login';
import NotFound from './pages/NotFound';

// Admin Pages
import AdminDashboard from './pages/admin/Dashboard';
import AdminTeams from './pages/admin/Teams';
import AdminTeamDetail from './pages/admin/TeamDetail';
import AdminUsers from './pages/admin/Users';
import AdminJury from './pages/admin/Jury';
import AdminAssignments from './pages/admin/Assignments';
import AdminScoringCriteria from './pages/admin/ScoringCriteria';
import AdminEvaluations from './pages/admin/Evaluations';
import AdminEvaluationDetail from './pages/admin/EvaluationDetail';
import AdminLeaderboard from './pages/admin/Leaderboard';
import AdminImportCenter from './pages/admin/ImportCenter';
import AdminAuditLogs from './pages/admin/AuditLogs';
import AdminSettings from './pages/admin/Settings';

// Jury Pages
import JuryDashboard from './pages/jury/Dashboard';
import JuryMyTeams from './pages/jury/MyTeams';
import JurySearchTeam from './pages/jury/SearchTeam';
import JuryTeamEvaluate from './pages/jury/TeamEvaluate';
import JuryCompletedEvals from './pages/jury/CompletedEvals';
import JuryProfile from './pages/jury/Profile';

export default function App() {
  const { isAuthenticated, isAdmin, loading } = useAuth();

  if (loading) {
    return (
      <div className="login-layout">
        <div style={{ color: 'white', fontSize: '18px' }}>Loading...</div>
      </div>
    );
  }

  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={
        isAuthenticated
          ? <Navigate to={isAdmin ? '/admin' : '/jury'} replace />
          : <Login />
      } />

      {/* Admin Routes */}
      <Route path="/admin" element={
        <ProtectedRoute><AdminRoute><AdminLayout /></AdminRoute></ProtectedRoute>
      }>
        <Route index element={<AdminDashboard />} />
        <Route path="teams" element={<AdminTeams />} />
        <Route path="teams/:teamId" element={<AdminTeamDetail />} />
        <Route path="users" element={<AdminUsers />} />
        <Route path="jury" element={<AdminJury />} />
        <Route path="assignments" element={<AdminAssignments />} />
        <Route path="scoring" element={<AdminScoringCriteria />} />
        <Route path="evaluations" element={<AdminEvaluations />} />
        <Route path="evaluations/:evaluationId" element={<AdminEvaluationDetail />} />
        <Route path="leaderboard" element={<AdminLeaderboard />} />
        <Route path="import" element={<AdminImportCenter />} />
        <Route path="audit-logs" element={<AdminAuditLogs />} />
        <Route path="settings" element={<AdminSettings />} />
      </Route>

      {/* Jury Routes */}
      <Route path="/jury" element={
        <ProtectedRoute><JuryRoute><JuryLayout /></JuryRoute></ProtectedRoute>
      }>
        <Route index element={<JuryDashboard />} />
        <Route path="teams" element={<JuryMyTeams />} />
        <Route path="search" element={<JurySearchTeam />} />
        <Route path="team/:teamCode/evaluate" element={<JuryTeamEvaluate />} />
        <Route path="completed" element={<JuryCompletedEvals />} />
        <Route path="profile" element={<JuryProfile />} />
      </Route>

      {/* Root redirect */}
      <Route path="/" element={
        <Navigate to={isAuthenticated ? (isAdmin ? '/admin' : '/jury') : '/login'} replace />
      } />

      {/* 404 */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

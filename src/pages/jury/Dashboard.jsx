import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { formatTimeAgo, getStatusClass } from '../../lib/utils';

export default function JuryDashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/stats/jury')
      .then(data => {
        setStats(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div>
        <h1 className="page-title">Jury Dashboard</h1>
        <div className="dashboard-kpis">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="skeleton skeleton-card" />
          ))}
        </div>
      </div>
    );
  }

  const kpi = stats?.kpi || { assigned: 0, completed: 0, pending: 0, progress: 0 };
  const teams = stats?.teams || [];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Jury Evaluation Dashboard</h1>
          <p className="page-subtitle">Track and evaluate your assigned teams</p>
        </div>
        <div className="page-actions">
          <Link to="/jury/search" className="btn btn-primary">
            🔍 Lookup Team by Code
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="dashboard-kpis" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="kpi-card">
          <div className="kpi-icon" style={{ background: '#3b82f615', color: '#3b82f6' }}>📋</div>
          <div className="kpi-label">Assigned Teams</div>
          <div className="kpi-value">{kpi.assigned}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon" style={{ background: '#10b98115', color: '#10b981' }}>✅</div>
          <div className="kpi-label">Completed</div>
          <div className="kpi-value">{kpi.completed}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon" style={{ background: '#f59e0b15', color: '#f59e0b' }}>⏳</div>
          <div className="kpi-label">Pending</div>
          <div className="kpi-value">{kpi.pending}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon" style={{ background: '#6366f115', color: '#6366f1' }}>📊</div>
          <div className="kpi-label">Progress</div>
          <div className="kpi-value">{kpi.progress}%</div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="card dashboard-progress" style={{ marginBottom: 'var(--space-6)' }}>
        <h3 style={{ marginBottom: 'var(--space-3)' }}>Evaluation Progress</h3>
        <div className="progress-bar-wrapper" style={{ height: '14px' }}>
          <div
            className={`progress-bar-fill ${kpi.progress >= 100 ? 'success' : kpi.progress >= 50 ? '' : 'warning'}`}
            style={{ width: `${Math.min(100, kpi.progress)}%` }}
          />
        </div>
        <div className="progress-bar-label" style={{ marginTop: 'var(--space-2)' }}>
          {kpi.completed} / {kpi.assigned} teams evaluated ({kpi.progress}%)
        </div>
      </div>

      {/* Assigned Teams Table */}
      <div className="card">
        <div className="dashboard-section-title">
          <span>👥 Assigned Teams Queue</span>
        </div>
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Team Code</th>
                <th>Team Name</th>
                <th>Organization</th>
                <th>Category</th>
                <th>Status</th>
                <th>Score</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {teams.length === 0 ? (
                <tr>
                  <td colSpan="7" className="empty-state">
                    <div className="empty-state-icon">📋</div>
                    <div className="empty-state-title">No teams assigned yet</div>
                    <div className="empty-state-text">You will see teams here once the administrator assigns them to you.</div>
                  </td>
                </tr>
              ) : (
                teams.map(team => (
                  <tr key={team.id}>
                    <td>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--color-accent)' }}>
                        {team.team_code}
                      </span>
                    </td>
                    <td><strong>{team.team_name}</strong></td>
                    <td style={{ fontSize: 'var(--text-sm)' }}>{team.organization || '—'}</td>
                    <td><span className="tag">{team.category || '—'}</span></td>
                    <td>
                      <span className={`badge ${getStatusClass(team.eval_status)}`}>
                        {team.eval_status === 'not_started' ? 'Not Started' : team.eval_status}
                      </span>
                    </td>
                    <td><strong>{team.total_score !== null && team.total_score !== undefined ? team.total_score : '—'}</strong></td>
                    <td>
                      <button
                        className={`btn btn-sm ${team.eval_status === 'submitted' ? 'btn-secondary' : 'btn-primary'}`}
                        onClick={() => navigate(`/jury/team/${team.team_code}/evaluate`)}
                      >
                        {team.eval_status === 'submitted' ? 'View Score' : team.eval_status === 'draft' ? 'Continue' : 'Evaluate'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { getStatusClass } from '../../lib/utils';

export default function JuryDashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState('all'); // 'all' | 'pending' | 'completed'
  const navigate = useNavigate();

  const fetchStats = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const data = await api.get('/stats/jury');
      setStats(data);
    } catch (err) {
      console.error('Failed to load jury stats:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    const timer = setInterval(() => fetchStats(), 15000);
    return () => clearInterval(timer);
  }, [fetchStats]);

  const kpi = stats?.kpi || { assigned: 0, completed: 0, pending: 0, progress: 0 };
  const allTeams = stats?.teams || [];

  const filteredTeams = useMemo(() => {
    if (filter === 'pending') {
      return allTeams.filter(t => t.eval_status !== 'submitted');
    }
    if (filter === 'completed') {
      return allTeams.filter(t => t.eval_status === 'submitted');
    }
    return allTeams;
  }, [allTeams, filter]);

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

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Jury Evaluation Dashboard</h1>
          <p className="page-subtitle">Track and evaluate your assigned teams</p>
        </div>
        <div className="page-actions" style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button
            className="btn btn-secondary"
            onClick={() => fetchStats(true)}
            disabled={refreshing}
          >
            {refreshing ? '⏳ Refreshing...' : '🔄 Refresh'}
          </button>
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          <div className="dashboard-section-title" style={{ margin: 0 }}>
            <span>👥 Assigned Teams Queue</span>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button
              className={`btn btn-sm ${filter === 'all' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setFilter('all')}
            >
              All ({allTeams.length})
            </button>
            <button
              className={`btn btn-sm ${filter === 'pending' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setFilter('pending')}
            >
              Pending ({allTeams.filter(t => t.eval_status !== 'submitted').length})
            </button>
            <button
              className={`btn btn-sm ${filter === 'completed' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setFilter('completed')}
            >
              Completed ({allTeams.filter(t => t.eval_status === 'submitted').length})
            </button>
          </div>
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
              {filteredTeams.length === 0 ? (
                <tr>
                  <td colSpan="7" className="empty-state">
                    <div className="empty-state-icon">📋</div>
                    <div className="empty-state-title">No teams in this queue</div>
                    <div className="empty-state-text">
                      {filter === 'completed'
                        ? 'No teams evaluated yet. Complete evaluations to see them here.'
                        : 'All assigned teams have been evaluated!'}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredTeams.map(team => (
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
                    <td>
                      {team.total_score !== null && team.total_score !== undefined ? (
                        <span className="badge badge-success" style={{ fontWeight: 700, fontSize: 'var(--text-sm)' }}>
                          {team.total_score} PTS
                        </span>
                      ) : (
                        <span style={{ color: 'var(--color-text-muted)' }}>—</span>
                      )}
                    </td>
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

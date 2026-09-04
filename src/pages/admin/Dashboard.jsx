import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import { formatDateTime, formatTimeAgo, getStatusClass } from '../../lib/utils';

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStats = async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const data = await api.get('/stats/admin');
      setStats(data);
    } catch (err) {
      console.error('Failed to load admin stats:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchStats();
    const timer = setInterval(() => fetchStats(), 15000);
    return () => clearInterval(timer);
  }, []);

  if (loading) {
    return (
      <div>
        <h1 className="page-title">Dashboard</h1>
        <div className="dashboard-kpis">
          {[...Array(8)].map((_, i) => <div key={i} className="skeleton skeleton-card" />)}
        </div>
      </div>
    );
  }

  if (!stats) return <div className="empty-state"><div className="empty-state-title">Failed to load dashboard</div></div>;

  const { kpi, recentActivity, juryProgress, recentTeams } = stats;

  const kpiCards = [
    { icon: '👥', label: 'Total Teams', value: kpi.totalTeams, color: '#3b82f6' },
    { icon: '⚖️', label: 'Jury Members', value: kpi.totalJury, color: '#6366f1' },
    { icon: '👤', label: 'Total Users', value: kpi.totalUsers, color: '#8b5cf6' },
    { icon: '📋', label: 'Evaluations Required', value: kpi.evaluationsRequired, color: '#ec4899' },
    { icon: '✅', label: 'Submitted', value: kpi.evaluationsSubmitted, color: '#10b981' },
    { icon: '⏳', label: 'Pending', value: kpi.evaluationsPending, color: '#f59e0b' },
    { icon: '📊', label: 'Completion', value: `${kpi.completionPercent}%`, color: '#3b82f6' },
    { icon: '⭐', label: 'Average Score', value: kpi.averageScore || '—', color: '#f59e0b' },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Overview of judging activity</p>
        </div>
        <div className="page-actions">
          <button
            className="btn btn-secondary"
            onClick={() => fetchStats(true)}
            disabled={refreshing}
          >
            {refreshing ? '⏳ Refreshing...' : '🔄 Refresh'}
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="dashboard-kpis">
        {kpiCards.map((card, i) => (
          <div className="kpi-card" key={i}>
            <div className="kpi-icon" style={{ background: `${card.color}15`, color: card.color }}>
              {card.icon}
            </div>
            <div className="kpi-label">{card.label}</div>
            <div className="kpi-value">{card.value}</div>
          </div>
        ))}
      </div>

      {/* Progress Bar */}
      <div className="card dashboard-progress">
        <h3 style={{ marginBottom: 'var(--space-3)' }}>Overall Evaluation Progress</h3>
        <div className="progress-bar-wrapper" style={{ height: '14px' }}>
          <div
            className={`progress-bar-fill ${kpi.completionPercent >= 80 ? 'success' : kpi.completionPercent >= 50 ? '' : 'warning'}`}
            style={{ width: `${Math.min(100, kpi.completionPercent)}%` }}
          />
        </div>
        <div className="progress-bar-label" style={{ marginTop: 'var(--space-2)' }}>
          {kpi.evaluationsSubmitted} / {kpi.evaluationsRequired} evaluations submitted — {kpi.completionPercent}%
        </div>
      </div>

      <div className="dashboard-grid">
        {/* Recent Activity */}
        <div className="card">
          <div className="dashboard-section-title">📋 Recent Activity</div>
          {recentActivity && recentActivity.length > 0 ? (
            recentActivity.map((a, i) => (
              <div className="activity-item" key={i}>
                <div className="activity-dot" style={{ background: getActionColor(a.action) }} />
                <div>
                  <div className="activity-text">
                    <strong>{a.user_name || 'System'}</strong> — {formatAction(a.action)}
                  </div>
                  <div className="activity-time">{formatTimeAgo(a.created_at)}</div>
                </div>
              </div>
            ))
          ) : (
            <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>No recent activity</div>
          )}
        </div>

        {/* Recent Teams */}
        <div className="card">
          <div className="dashboard-section-title">👥 Recent Teams</div>
          {recentTeams && recentTeams.length > 0 ? (
            recentTeams.map(team => (
              <div key={team.id} style={{ padding: 'var(--space-2) 0', borderBottom: '1px solid var(--color-border-light)' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--color-accent)', fontWeight: 600 }}>
                  {team.team_code}
                </div>
                <div style={{ fontSize: 'var(--text-sm)' }}>{team.team_name}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{team.organization}</div>
              </div>
            ))
          ) : (
            <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>No teams yet</div>
          )}
        </div>
      </div>

      {/* Jury Progress */}
      {juryProgress && juryProgress.length > 0 && (
        <div className="card" style={{ marginTop: 'var(--space-6)' }}>
          <div className="dashboard-section-title">⚖️ Jury Progress</div>
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Judge</th>
                  <th>Assigned</th>
                  <th>Completed</th>
                  <th>Pending</th>
                  <th>Progress</th>
                  <th>Last Activity</th>
                </tr>
              </thead>
              <tbody>
                {juryProgress.map(j => (
                  <tr key={j.id}>
                    <td><strong>{j.full_name}</strong></td>
                    <td>{j.assigned}</td>
                    <td><span className="badge badge-success">{j.completed}</span></td>
                    <td><span className="badge badge-warning">{j.pending}</span></td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                        <div className="progress-bar-wrapper" style={{ flex: 1, height: '6px' }}>
                          <div className="progress-bar-fill" style={{ width: `${j.progress}%` }} />
                        </div>
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', minWidth: 36 }}>{j.progress}%</span>
                      </div>
                    </td>
                    <td style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
                      {j.last_activity ? formatTimeAgo(j.last_activity) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function getActionColor(action) {
  if (action?.includes('submit')) return '#10b981';
  if (action?.includes('create')) return '#3b82f6';
  if (action?.includes('delete')) return '#ef4444';
  if (action?.includes('import')) return '#6366f1';
  if (action?.includes('update')) return '#f59e0b';
  return '#94a3b8';
}

function formatAction(action) {
  if (!action) return '';
  return action.replace(/\./g, ' ').replace(/_/g, ' ');
}

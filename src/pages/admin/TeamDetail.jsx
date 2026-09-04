import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { useToast } from '../../context/ToastContext';
import { formatDateTime, formatScore } from '../../lib/utils';

export default function TeamDetail() {
  const { teamId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [team, setTeam] = useState(null);
  const [evaluations, setEvaluations] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/teams/${teamId}`).then(data => {
      setTeam(data.team);
      setEvaluations(data.evaluations || []);
      setStats(data.stats || null);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [teamId]);

  const handleDelete = async () => {
    if (!confirm(`Permanently delete team ${team.team_code} (${team.team_name})?\n\nThis action cannot be undone and will delete all associated evaluations.`)) return;
    try {
      await api.delete(`/teams/${team.id}`);
      toast.success(`Team ${team.team_code} deleted successfully`);
      navigate('/admin/teams');
    } catch (err) {
      toast.error(err.message || 'Failed to delete team');
    }
  };

  if (loading) return <div className="skeleton skeleton-card" style={{ height: 300 }} />;
  if (!team) return <div className="empty-state"><div className="empty-state-title">Team not found</div></div>;

  return (
    <div>
      <div className="breadcrumbs" style={{ marginBottom: 'var(--space-4)' }}>
        <Link to="/admin/teams">Teams</Link>
        <span className="separator">/</span>
        <span className="current">{team.team_code}</span>
      </div>

      <div className="eval-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div className="eval-team-code">{team.team_code}</div>
            <div className="eval-team-name">{team.team_name}</div>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            style={{ color: 'var(--color-error)' }}
            onClick={handleDelete}
          >
            🗑️ Delete Team
          </button>
        </div>
        <div className="eval-team-details">
          <div><div className="eval-detail-label">Problem Statement</div><div className="eval-detail-value">{team.problem_statement_title || '—'}</div></div>
          <div><div className="eval-detail-label">Organization</div><div className="eval-detail-value">{team.organization || '—'}</div></div>
          <div><div className="eval-detail-label">Category / Track</div><div className="eval-detail-value">{team.category || '—'} / {team.track || '—'}</div></div>
        </div>
      </div>

      {/* Authoritative PostgreSQL Statistics */}
      <div className="stat-grid">
        <div className="stat-item"><div className="stat-value">{stats?.averageScore ?? '—'}</div><div className="stat-label">Official Aggregate Score</div></div>
        <div className="stat-item"><div className="stat-value">{stats?.highestScore ?? '—'}</div><div className="stat-label">Highest Score</div></div>
        <div className="stat-item"><div className="stat-value">{stats?.lowestScore ?? '—'}</div><div className="stat-label">Lowest Score</div></div>
        <div className="stat-item"><div className="stat-value">{stats?.completedJudges ?? 0} / {evaluations.length}</div><div className="stat-label">Judges Completed</div></div>
      </div>

      {/* Evaluations Table */}
      <div className="card" style={{ marginTop: 'var(--space-6)' }}>
        <h3 style={{ marginBottom: 'var(--space-4)' }}>Evaluations</h3>
        {evaluations.length === 0 ? (
          <div className="empty-state"><div className="empty-state-title">No evaluations yet</div></div>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Judge</th>
                  <th>Status</th>
                  {evaluations[0]?.scores?.map(s => <th key={s.criteria_id}>{s.criteria_name}</th>)}
                  <th>Total</th>
                  <th>Submitted</th>
                </tr>
              </thead>
              <tbody>
                {evaluations.map(ev => (
                  <tr key={ev.id}>
                    <td><strong>{ev.judge_name}</strong></td>
                    <td><span className={`badge ${ev.status === 'submitted' ? 'badge-success' : 'badge-warning'}`}>{ev.status}</span></td>
                    {ev.scores?.map(s => (
                      <td key={s.criteria_id}>{s.score !== null ? `${s.score}/${s.max_score}` : '—'}</td>
                    ))}
                    <td><strong>{ev.total_score !== null ? ev.total_score : '—'}</strong></td>
                    <td style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>{formatDateTime(ev.submitted_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

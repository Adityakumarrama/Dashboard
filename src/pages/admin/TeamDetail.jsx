import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { useToast } from '../../context/ToastContext';
import { formatDateTime } from '../../lib/utils';

export default function TeamDetail() {
  const { teamId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [team, setTeam] = useState(null);
  const [evaluations, setEvaluations] = useState([]);
  const [stats, setStats] = useState(null);
  const [assignedJuries, setAssignedJuries] = useState([]);
  const [allJuries, setAllJuries] = useState([]);
  const [selectedJuryToAdd, setSelectedJuryToAdd] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [unassigningId, setUnassigningId] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/teams/${teamId}`).then(data => {
      setTeam(data.team);
      setEvaluations(data.evaluations || []);
      setStats(data.stats || null);
      setAssignedJuries(data.assigned_juries || []);
      setLoading(false);
    }).catch(() => setLoading(false));

    api.get('/users?role=JURY').then(data => {
      setAllJuries(data.users || data || []);
    }).catch(() => {});
  }, [teamId]);

  const handleAddAssignment = async (e) => {
    e.preventDefault();
    if (!selectedJuryToAdd || !team) return;
    setAssigning(true);
    try {
      const res = await api.post('/assignments', {
        user_id: selectedJuryToAdd,
        team_id: team.id,
      });
      const juryObj = allJuries.find(j => j.id === selectedJuryToAdd);
      setAssignedJuries(prev => [
        ...prev,
        {
          assignment_id: res.assignment?.id || Date.now(),
          assigned_at: new Date().toISOString(),
          user_id: selectedJuryToAdd,
          full_name: juryObj?.full_name || 'Judge',
          judge_id: juryObj?.judge_id,
          email: juryObj?.email,
        }
      ]);
      setSelectedJuryToAdd('');
      toast.success(`Assigned ${juryObj?.full_name || 'Judge'} to ${team.team_code}`);
    } catch (err) {
      toast.error(err.message || 'Failed to assign judge');
    } finally {
      setAssigning(false);
    }
  };

  const handleRemoveAssignment = async (assignmentId, judgeName) => {
    if (!confirm(`Remove assignment for ${judgeName || 'this judge'}?`)) return;
    setUnassigningId(assignmentId);
    try {
      await api.delete(`/assignments/${assignmentId}`);
      setAssignedJuries(prev => prev.filter(a => a.assignment_id !== assignmentId));
      toast.success(`Removed ${judgeName || 'Judge'} assignment`);
    } catch (err) {
      toast.error(err.message || 'Failed to remove assignment');
    } finally {
      setUnassigningId(null);
    }
  };

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

  const members = Array.isArray(team.team_members) ? team.team_members : [];
  const unassignedJuries = allJuries.filter(
    j => !assignedJuries.some(a => a.user_id === j.id)
  );

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
          <div>
            <div className="eval-detail-label">Problem Statement</div>
            <div className="eval-detail-value">
              {team.problem_statement_id && <span className="tag" style={{ marginRight: 6 }}>{team.problem_statement_id}</span>}
              {team.problem_statement_title || '—'}
            </div>
          </div>
          <div>
            <div className="eval-detail-label">Department & Course</div>
            <div className="eval-detail-value">
              {team.department || team.track || '—'} {team.course ? `(${team.course})` : ''}
            </div>
          </div>
          <div>
            <div className="eval-detail-label">Submitter Email</div>
            <div className="eval-detail-value" style={{ wordBreak: 'break-all' }}>
              {team.submitter_email || '—'}
            </div>
          </div>
        </div>
      </div>

      {/* Authoritative PostgreSQL Statistics */}
      <div className="stat-grid">
        <div className="stat-item"><div className="stat-value">{stats?.averageScore ?? '—'}</div><div className="stat-label">Official Aggregate Score</div></div>
        <div className="stat-item"><div className="stat-value">{stats?.highestScore ?? '—'}</div><div className="stat-label">Highest Score</div></div>
        <div className="stat-item"><div className="stat-value">{stats?.lowestScore ?? '—'}</div><div className="stat-label">Lowest Score</div></div>
        <div className="stat-item"><div className="stat-value">{stats?.completedJudges ?? 0} / {evaluations.length}</div><div className="stat-label">Judges Completed</div></div>
      </div>

      {/* Team Leader Details */}
      <div className="card" style={{ marginTop: 'var(--space-6)' }}>
        <h3 style={{ marginBottom: 'var(--space-4)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span>👑</span> Team Leader
        </h3>
        <div className="leader-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
            <div>
              <div style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--font-bold)', color: 'var(--color-text-primary)' }}>
                {team.team_leader || 'Not Specified'}
              </div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 2 }}>
                Team Leader & Point of Contact
              </div>
            </div>
            {team.leader_enrollment && (
              <span className="tag" style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                Enrollment: {team.leader_enrollment}
              </span>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
            <div>
              <span className="roster-card-meta-label">Rama Official Email: </span>
              <strong style={{ display: 'block', wordBreak: 'break-all' }}>{team.leader_email || '—'}</strong>
            </div>
            <div>
              <span className="roster-card-meta-label">Contact Phone: </span>
              <strong style={{ display: 'block' }}>{team.leader_phone || '—'}</strong>
            </div>
            <div>
              <span className="roster-card-meta-label">Department / Course: </span>
              <strong style={{ display: 'block' }}>{team.department || '—'} {team.course ? `(${team.course})` : ''}</strong>
            </div>
          </div>
        </div>

        {/* Student Roster (5 Team Members) */}
        <h4 style={{ marginTop: 'var(--space-6)', marginBottom: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span>👥</span> Team Members Roster ({members.length})
        </h4>
        {members.length === 0 ? (
          <div style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--color-text-muted)', background: 'var(--color-bg-surface-alt)', borderRadius: 'var(--radius-md)' }}>
            No team members registered yet.
          </div>
        ) : (
          <div className="roster-grid">
            {members.map((m, idx) => {
              const isGirl = !!m.is_girl_member || m.member_number === 1;
              return (
                <div key={idx} className={`roster-card ${isGirl ? 'girl-member' : ''}`}>
                  <div className="roster-card-header">
                    <span className="roster-card-title">Member {m.member_number || idx + 1}</span>
                    {isGirl ? (
                      <span className="badge-girl">👩 Member 1 - Girl</span>
                    ) : (
                      <span className="tag">{m.gender || 'Member'}</span>
                    )}
                  </div>
                  <div className="roster-card-name">{m.name || '—'}</div>
                  <div className="roster-card-meta">
                    <div className="roster-card-meta-item">
                      <span className="roster-card-meta-label">Enrollment:</span>
                      <strong style={{ fontFamily: 'var(--font-mono)' }}>{m.enrollment_number || '—'}</strong>
                    </div>
                    <div className="roster-card-meta-item">
                      <span className="roster-card-meta-label">Department:</span>
                      <span>{m.department || '—'}</span>
                    </div>
                    <div className="roster-card-meta-item">
                      <span className="roster-card-meta-label">Gender:</span>
                      <span>{m.gender || '—'}</span>
                    </div>
                    {(m.course || m.member_course) && (
                      <div className="roster-card-meta-item">
                        <span className="roster-card-meta-label">Course:</span>
                        <span>{m.course || m.member_course} {(m.academic_year || m.member_year) ? `(Yr ${m.academic_year || m.member_year})` : ''}</span>
                      </div>
                    )}
                    {(m.contact || m.member_contact) && (
                      <div className="roster-card-meta-item">
                        <span className="roster-card-meta-label">Phone:</span>
                        <span style={{ fontFamily: 'var(--font-mono)' }}>{m.contact || m.member_contact}</span>
                      </div>
                    )}
                    <div style={{ marginTop: 'var(--space-2)', paddingTop: 'var(--space-2)', borderTop: '1px solid var(--color-border-light)' }}>
                      <span className="roster-card-meta-label">Rama Email:</span>
                      <div style={{ wordBreak: 'break-all', fontSize: 'var(--text-xs)', marginTop: 2 }}>{m.email || m.member_email || '—'}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
 
      {/* Assigned Jury Panel */}
      <div className="card" style={{ marginTop: 'var(--space-6)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
          <div>
            <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <span>⚖️</span> Assigned Jury Panel ({assignedJuries.length})
            </h3>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 2 }}>
              Active judges who can evaluate this team during rounds
            </div>
          </div>
          {/* Quick Assign Dropdown */}
          <form onSubmit={handleAddAssignment} style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              className="form-control form-control-sm"
              style={{ minWidth: 220 }}
              value={selectedJuryToAdd}
              onChange={e => setSelectedJuryToAdd(e.target.value)}
              disabled={assigning || unassignedJuries.length === 0}
            >
              <option value="">
                {unassignedJuries.length === 0 ? 'All judges already assigned' : '+ Assign Judge...'}
              </option>
              {unassignedJuries.map(j => (
                <option key={j.id} value={j.id}>
                  {j.judge_id ? `[${j.judge_id}] ` : ''}{j.full_name} ({j.email})
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={!selectedJuryToAdd || assigning}
            >
              {assigning ? 'Assigning...' : '+ Assign'}
            </button>
          </form>
        </div>

        {assignedJuries.length === 0 ? (
          <div style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--color-text-muted)', background: 'var(--color-bg-surface-alt)', borderRadius: 'var(--radius-md)' }}>
            ⚠️ No judges assigned to this team yet. Select a judge above to manually assign, or use bulk auto-assign on the Teams page.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 'var(--space-3)' }}>
            {assignedJuries.map(j => {
              const evalForJudge = evaluations.find(e => e.user_id === j.user_id || e.judge_name === j.full_name);
              return (
                <div
                  key={j.assignment_id || j.user_id}
                  style={{
                    padding: 'var(--space-3)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-border-light)',
                    background: 'var(--color-bg-surface)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: 'var(--space-2)',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)' }}>
                        {j.full_name || 'Judge'}
                      </strong>
                      {j.judge_id && (
                        <span className="tag" style={{ fontSize: '10px', padding: '1px 5px' }}>{j.judge_id}</span>
                      )}
                    </div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 2, wordBreak: 'break-all' }}>
                      {j.email || '—'}
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 'var(--space-2)', borderTop: '1px solid var(--color-border-light)' }}>
                    <span className={`badge ${evalForJudge?.status === 'submitted' ? 'badge-success' : 'badge-warning'}`} style={{ fontSize: '10px' }}>
                      {evalForJudge?.status === 'submitted' ? '✓ Evaluated' : '⏳ Pending'}
                    </span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ color: 'var(--color-error)', padding: '2px 6px', fontSize: 'var(--text-xs)' }}
                      disabled={unassigningId === j.assignment_id}
                      onClick={() => handleRemoveAssignment(j.assignment_id, j.full_name)}
                    >
                      {unassigningId === j.assignment_id ? '...' : '✕ Remove'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
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

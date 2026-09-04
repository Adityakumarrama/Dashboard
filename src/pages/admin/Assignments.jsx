import { useState, useEffect } from 'react';
import api from '../../lib/api';
import { useToast } from '../../context/ToastContext';

export default function AdminAssignments() {
  const [assignments, setAssignments] = useState([]);
  const [jurySummary, setJurySummary] = useState([]);
  const [teams, setTeams] = useState([]);
  const [juryUsers, setJuryUsers] = useState([]);
  const [selectedJury, setSelectedJury] = useState('');
  const [selectedTeams, setSelectedTeams] = useState([]);
  const [showBulk, setShowBulk] = useState(false);
  const [showAutoModal, setShowAutoModal] = useState(false);
  const [autoAssigning, setAutoAssigning] = useState(false);
  const [autoMode, setAutoMode] = useState('round_robin');
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  const fetch = async () => {
    setLoading(true);
    try {
      const [asgData, teamData, userData] = await Promise.all([
        api.get('/assignments'),
        api.get('/teams', { limit: 100 }),
        api.get('/users', { role: 'JURY', limit: 100 }),
      ]);
      setAssignments(asgData.assignments || []);
      setJurySummary(asgData.jurySummary || []);
      setTeams(teamData.teams || []);
      setJuryUsers(userData.users || []);
    } catch {} setLoading(false);
  };

  useEffect(() => { fetch(); }, []);

  const handleBulkAssign = async () => {
    if (!selectedJury || selectedTeams.length === 0) { toast.warning('Select a jury member and at least one team'); return; }
    try {
      const data = await api.post('/assignments/bulk', { user_id: selectedJury, team_ids: selectedTeams });
      toast.success(`Assigned ${data.created} teams`);
      setShowBulk(false);
      setSelectedTeams([]);
      fetch();
    } catch (err) { toast.error(err.message); }
  };

  const handleAutoAssign = async () => {
    setAutoAssigning(true);
    try {
      const data = await api.post('/assignments/auto-assign', { mode: autoMode });
      toast.success(data.message || 'Auto-assignment completed successfully');
      setShowAutoModal(false);
      fetch();
    } catch (err) {
      toast.error(err.message || 'Auto-assignment failed');
    } finally {
      setAutoAssigning(false);
    }
  };

  const handleRemove = async (id) => {
    try {
      await api.delete(`/assignments/${id}`);
      toast.success('Assignment removed');
      fetch();
    } catch (err) { toast.error(err.message); }
  };

  const toggleTeam = (id) => setSelectedTeams(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]);

  const activeJuryCount = juryUsers.filter(u => u.role === 'JURY').length;
  const teamsPerJury = activeJuryCount > 0 ? Math.ceil(teams.length / activeJuryCount) : 0;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Assignments</h1>
          <p className="page-subtitle">Manage and automatically distribute jury-team assignments</p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          <button className="btn btn-secondary" onClick={() => setShowAutoModal(true)}>
            ⚡ Auto Assign Teams
          </button>
          <button className="btn btn-primary" onClick={() => setShowBulk(true)}>
            + Bulk Assign
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="table-container" style={{ marginBottom: 'var(--space-6)' }}>
        <table className="table">
          <thead><tr><th>Judge</th><th>Assigned</th><th>Completed</th><th>Pending</th><th>Progress</th></tr></thead>
          <tbody>
            {jurySummary.map(j => (
              <tr key={j.id}>
                <td><strong>{j.full_name}</strong></td>
                <td>{j.assigned_count}</td>
                <td><span className="badge badge-success">{j.completed_count}</span></td>
                <td><span className="badge badge-warning">{j.pending_count}</span></td>
                <td>
                  <div className="progress-bar-wrapper" style={{ width: 120, height: 6 }}>
                    <div className="progress-bar-fill" style={{ width: `${j.assigned_count > 0 ? (j.completed_count/j.assigned_count*100) : 0}%` }} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* All Assignments */}
      <div className="card">
        <h3 style={{ marginBottom: 'var(--space-4)' }}>All Assignments ({assignments.length})</h3>
        <div className="table-container">
          <table className="table">
            <thead><tr><th>Judge</th><th>Team Code</th><th>Team Name</th><th>Category</th><th>Status</th><th>Score</th><th>Actions</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan="7"><div className="skeleton skeleton-text" /></td></tr> :
              assignments.length === 0 ? <tr><td colSpan="7" className="empty-state"><div className="empty-state-title">No assignments yet</div></td></tr> :
              assignments.map(a => (
                <tr key={a.id}>
                  <td>{a.jury_name}</td>
                  <td><span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-accent)', fontWeight: 600 }}>{a.team_code}</span></td>
                  <td>{a.team_name}</td>
                  <td><span className="tag">{a.category || '—'}</span></td>
                  <td><span className={`badge ${a.eval_status === 'submitted' ? 'badge-success' : a.eval_status === 'draft' ? 'badge-warning' : 'badge-muted'}`}>{a.eval_status}</span></td>
                  <td>{a.total_score || '—'}</td>
                  <td><button className="btn btn-ghost btn-sm" style={{ color: 'var(--color-error)' }} onClick={() => handleRemove(a.id)}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bulk Assign Modal */}
      {showBulk && (
        <div className="modal-overlay" onClick={() => setShowBulk(false)}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3 className="modal-title">Bulk Assign Teams</h3><button className="modal-close" onClick={() => setShowBulk(false)}>×</button></div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Select Jury Member</label>
                <select className="select" value={selectedJury} onChange={e => setSelectedJury(e.target.value)}>
                  <option value="">Choose jury member...</option>
                  {juryUsers.filter(u => u.role === 'JURY').map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Select Teams ({selectedTeams.length} selected)</label>
                <div style={{ maxHeight: 300, overflow: 'auto', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-2)' }}>
                  {teams.map(t => (
                    <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-2)', cursor: 'pointer', borderBottom: '1px solid var(--color-border-light)' }}>
                      <input type="checkbox" checked={selectedTeams.includes(t.id)} onChange={() => toggleTeam(t.id)} />
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--color-accent)' }}>{t.team_code}</span>
                      <span style={{ fontSize: 'var(--text-sm)' }}>{t.team_name}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowBulk(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleBulkAssign}>Assign {selectedTeams.length} Teams</button>
            </div>
          </div>
        </div>
      )}

      {/* Auto Assign Modal */}
      {showAutoModal && (
        <div className="modal-overlay" onClick={() => setShowAutoModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">⚡ Auto-Assign Teams</h3>
              <button className="modal-close" onClick={() => setShowAutoModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div style={{
                background: 'var(--color-bg-secondary)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-4)',
                marginBottom: 'var(--space-4)'
              }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)', fontSize: 'var(--text-sm)' }}>
                  <div><strong>Active Jury:</strong> {activeJuryCount} members</div>
                  <div><strong>Total Teams:</strong> {teams.length} teams</div>
                  <div><strong>Teams per Judge:</strong> ~{teamsPerJury} teams</div>
                  <div><strong>Status:</strong> Balanced Distribution</div>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Assignment Distribution Mode</label>
                <select
                  className="select"
                  value={autoMode}
                  onChange={e => setAutoMode(e.target.value)}
                >
                  <option value="round_robin">Round-Robin (Divide teams evenly among active juries)</option>
                  <option value="all">Full Panel (Assign all teams to all active juries)</option>
                </select>
                <span className="form-hint" style={{ marginTop: 'var(--space-2)', display: 'block', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                  {autoMode === 'round_robin'
                    ? `Teams will be distributed equally among the ${activeJuryCount} active jury members.`
                    : `Every active jury member will be assigned all ${teams.length} teams.`}
                </span>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowAutoModal(false)} disabled={autoAssigning}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleAutoAssign} disabled={autoAssigning || activeJuryCount === 0 || teams.length === 0}>
                {autoAssigning ? 'Assigning...' : 'Distribute Teams Automatically'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

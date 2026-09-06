import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { useToast } from '../../context/ToastContext';
import { formatDateTime, getStatusClass, truncate } from '../../lib/utils';

export default function AdminTeams() {
  const [teams, setTeams] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [activeJuries, setActiveJuries] = useState([]);
  const [selectedTeams, setSelectedTeams] = useState([]);
  const [assignModalTeam, setAssignModalTeam] = useState(null);
  const [showBulkAssign, setShowBulkAssign] = useState(false);
  const [bulkJuryId, setBulkJuryId] = useState('');
  const [autoAssigning, setAutoAssigning] = useState(false);

  const initialForm = {
    team_code: '', team_name: '', problem_statement_id: '', problem_statement_title: '',
    organization: 'Rama University (F.E.T)', category: 'Software', track: '', team_leader: '',
    department: '', course: '', leader_phone: '', leader_email: '', leader_enrollment: '', submitter_email: '',
  };
  const [form, setForm] = useState(initialForm);
  const toast = useToast();
  const navigate = useNavigate();

  const fetchTeams = async () => {
    setLoading(true);
    try {
      const data = await api.get('/teams', { page, limit: 25, search });
      setTeams(data.teams || []);
      setPagination(data.pagination);
    } catch { toast.error('Failed to load teams'); }
    setLoading(false);
  };

  useEffect(() => { fetchTeams(); }, [page, search]);

  useEffect(() => {
    api.get('/users', { role: 'JURY', limit: 100 })
      .then(d => setActiveJuries((d.users || []).filter(u => u.status === 'active')))
      .catch(() => {});
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      await api.post('/teams', form);
      toast.success('Team created successfully');
      setShowCreate(false);
      setForm(initialForm);
      fetchTeams();
    } catch (err) { toast.error(err.message); }
  };

  const handleDelete = async (id, code) => {
    if (!confirm(`Delete team ${code}? This action cannot be undone.`)) return;
    try {
      await api.delete(`/teams/${id}`);
      toast.success('Team deleted');
      fetchTeams();
    } catch (err) { toast.error(err.message); }
  };

  const allSelected = teams.length > 0 && selectedTeams.length === teams.length;
  const toggleSelectAll = () => {
    if (allSelected) setSelectedTeams([]);
    else setSelectedTeams(teams.map(t => t.id));
  };
  const toggleSelectTeam = (id) => {
    setSelectedTeams(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]);
  };

  const handleAutoAssignSelected = async () => {
    if (selectedTeams.length === 0) return;
    setAutoAssigning(true);
    try {
      const data = await api.post('/assignments/auto-assign', { mode: 'round_robin', team_ids: selectedTeams });
      toast.success(data.message || `Auto-assigned ${selectedTeams.length} teams across active judges`);
      setSelectedTeams([]);
      fetchTeams();
    } catch (err) {
      toast.error(err.message || 'Auto-assignment failed');
    } finally {
      setAutoAssigning(false);
    }
  };

  const handleBulkAssignToJudge = async () => {
    if (!bulkJuryId) { toast.warning('Select a judge'); return; }
    try {
      const data = await api.post('/assignments/bulk', { user_id: bulkJuryId, team_ids: selectedTeams });
      toast.success(`Assigned ${data.created} teams`);
      setShowBulkAssign(false);
      setSelectedTeams([]);
      fetchTeams();
    } catch (err) { toast.error(err.message); }
  };

  const handleToggleJudgeAssignment = async (juryId, isAssigned, assignmentId) => {
    try {
      if (isAssigned && assignmentId) {
        await api.delete(`/assignments/${assignmentId}`);
        toast.success('Judge unassigned');
      } else {
        await api.post('/assignments', { user_id: juryId, team_id: assignModalTeam.id });
        toast.success('Judge assigned');
      }
      const updated = await api.get(`/teams/${assignModalTeam.id}`);
      setAssignModalTeam(updated.team ? { ...updated.team, assigned_juries: updated.assigned_juries } : null);
      fetchTeams();
    } catch (err) { toast.error(err.message); }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Teams</h1>
          <p className="page-subtitle">{pagination?.total || 0} teams registered</p>
        </div>
        <div className="page-actions">
          <Link to="/admin/assignments" className="btn btn-secondary">⚡ Assignments Panel</Link>
          <Link to="/admin/import" className="btn btn-secondary">📥 Import</Link>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ Create Team</button>
        </div>
      </div>

      {/* Bulk action bar when items are selected */}
      {selectedTeams.length > 0 && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 'var(--space-3)',
          padding: 'var(--space-3) var(--space-4)',
          background: 'rgba(79, 70, 229, 0.08)',
          border: '1.5px solid var(--color-primary-light, #818cf8)',
          borderRadius: 'var(--radius-md)',
          marginBottom: 'var(--space-4)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontWeight: 600 }}>
            <span>🎯</span>
            <span>{selectedTeams.length} teams selected</span>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleAutoAssignSelected}
              disabled={autoAssigning || activeJuries.length === 0}
            >
              {autoAssigning ? 'Assigning...' : `⚡ Auto-Assign (${activeJuries.length} Judges)`}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setShowBulkAssign(true)}
              disabled={activeJuries.length === 0}
            >
              👤 Assign to Specific Judge...
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setSelectedTeams([])}
            >
              Clear Selection
            </button>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="toolbar">
        <div className="search-container" style={{ flex: 1, maxWidth: 400 }}>
          <span className="search-icon">🔍</span>
          <input className="input" placeholder="Search teams by code, name, department..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
      </div>

      {/* Table */}
      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 40, textAlign: 'center' }}>
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} title="Select All on Page" />
              </th>
              <th>Team Code</th>
              <th>Team Name</th>
              <th>Department / Course</th>
              <th>Assigned Jury</th>
              <th>Team Leader</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(5)].map((_, i) => (
                <tr key={i}><td colSpan="8"><div className="skeleton skeleton-text" /></td></tr>
              ))
            ) : teams.length === 0 ? (
              <tr><td colSpan="8" className="empty-state">
                <div className="empty-state-icon">👥</div>
                <div className="empty-state-title">No teams found</div>
                <div className="empty-state-text">Create teams or import them from CSV/TSV</div>
              </td></tr>
            ) : (
              teams.map(team => {
                const assigned = team.assigned_juries || [];
                const isSelected = selectedTeams.includes(team.id);
                return (
                  <tr key={team.id} style={{ background: isSelected ? 'rgba(79, 70, 229, 0.04)' : undefined }}>
                    <td style={{ textAlign: 'center' }}>
                      <input type="checkbox" checked={isSelected} onChange={() => toggleSelectTeam(team.id)} />
                    </td>
                    <td>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--color-accent)' }}>
                        {team.team_code}
                      </span>
                    </td>
                    <td>
                      <div><strong>{truncate(team.team_name, 26)}</strong></div>
                      {team.problem_statement_id && <span className="tag" style={{ fontSize: '10px', marginTop: 2 }}>{team.problem_statement_id}</span>}
                    </td>
                    <td style={{ fontSize: 'var(--text-sm)' }}>
                      <div>{team.department || team.track || '—'}</div>
                      {team.course && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{team.course}</div>}
                    </td>
                    <td>
                      {assigned.length === 0 ? (
                        <span className="badge badge-warning" style={{ fontSize: '11px' }}>Unassigned</span>
                      ) : (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxWidth: 220 }}>
                          {assigned.map(j => (
                            <span key={j.id || j.user_id} className="tag tag-primary" style={{ fontSize: '11px', padding: '2px 6px' }} title={j.full_name}>
                              👤 {truncate(j.full_name || j.judge_id, 14)}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td style={{ fontSize: 'var(--text-sm)' }}>
                      <div><strong>{truncate(team.team_leader || '—', 18)}</strong></div>
                      {team.leader_enrollment && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>{team.leader_enrollment}</div>}
                    </td>
                    <td><span className={`badge ${getStatusClass(team.registration_status)}`}>{team.registration_status}</span></td>
                    <td>
                      <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                        <button className="btn btn-secondary btn-sm" style={{ padding: '2px 8px', fontSize: '12px' }} onClick={() => setAssignModalTeam(team)}>
                          🎯 Assign
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/admin/teams/${team.id}`)}>View</button>
                        <button className="btn btn-ghost btn-sm" style={{ color: 'var(--color-error)' }} onClick={() => handleDelete(team.id, team.team_code)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="pagination">
          <span>Showing {teams.length} of {pagination.total} teams</span>
          <div className="pagination-buttons">
            <button className="pagination-btn" disabled={!pagination.hasPrev} onClick={() => setPage(p => p - 1)}>← Prev</button>
            {[...Array(Math.min(pagination.totalPages, 5))].map((_, i) => {
              const p = i + 1;
              return <button key={p} className={`pagination-btn ${page === p ? 'active' : ''}`} onClick={() => setPage(p)}>{p}</button>;
            })}
            <button className="pagination-btn" disabled={!pagination.hasNext} onClick={() => setPage(p => p + 1)}>Next →</button>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Create Team</h3>
              <button className="modal-close" onClick={() => setShowCreate(false)}>×</button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="modal-body">
                <div className="grid grid-2" style={{ gap: 'var(--space-4)' }}>
                  <div className="form-group">
                    <label className="form-label">Team Code *</label>
                    <input className="input" placeholder="SIH1523" value={form.team_code} onChange={e => setForm({...form, team_code: e.target.value})} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Team Name *</label>
                    <input className="input" placeholder="CodeCrafters" value={form.team_name} onChange={e => setForm({...form, team_name: e.target.value})} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Department</label>
                    <input className="input" placeholder="Computer Science & Engineering" value={form.department} onChange={e => setForm({...form, department: e.target.value, track: e.target.value})} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Course</label>
                    <input className="input" placeholder="B.Tech" value={form.course} onChange={e => setForm({...form, course: e.target.value})} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Problem Code (SIH)</label>
                    <input className="input" placeholder="SIH1523" value={form.problem_statement_id} onChange={e => setForm({...form, problem_statement_id: e.target.value})} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Problem Statement</label>
                    <input className="input" placeholder="Smart Attendance Tracking" value={form.problem_statement_title} onChange={e => setForm({...form, problem_statement_title: e.target.value})} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Team Leader Name</label>
                    <input className="input" placeholder="Rahul Sharma -F.E.T" value={form.team_leader} onChange={e => setForm({...form, team_leader: e.target.value})} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Leader Rama Official Email</label>
                    <input className="input" type="email" placeholder="rahul.fet@ramauniversity.ac.in" value={form.leader_email} onChange={e => setForm({...form, leader_email: e.target.value})} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Leader Contact Number</label>
                    <input className="input" placeholder="9876543210" value={form.leader_phone} onChange={e => setForm({...form, leader_phone: e.target.value})} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Leader Enrollment Number</label>
                    <input className="input" placeholder="RU2024FET001" value={form.leader_enrollment} onChange={e => setForm({...form, leader_enrollment: e.target.value})} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Submitter Email</label>
                    <input className="input" type="email" placeholder="submitter@gmail.com" value={form.submitter_email} onChange={e => setForm({...form, submitter_email: e.target.value})} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Organization</label>
                    <input className="input" value={form.organization} onChange={e => setForm({...form, organization: e.target.value})} />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Create Team</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Quick Assign Modal for a Single Team */}
      {assignModalTeam && (
        <div className="modal-overlay" onClick={() => setAssignModalTeam(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3 className="modal-title">🎯 Assign Jury to Team</h3>
                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 2 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--color-accent)' }}>{assignModalTeam.team_code}</span> — {assignModalTeam.team_name}
                </p>
              </div>
              <button className="modal-close" onClick={() => setAssignModalTeam(null)}>×</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-3)' }}>
                Click on a judge to assign or unassign them from this team:
              </p>
              {activeJuries.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 'var(--space-4)', color: 'var(--color-text-muted)' }}>
                  No active jury members found. Create or activate judges in User Management first.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', maxHeight: 350, overflow: 'auto' }}>
                  {activeJuries.map(j => {
                    const existingAssignment = (assignModalTeam.assigned_juries || []).find(a => a.user_id === j.id);
                    const isAssigned = !!existingAssignment;
                    return (
                      <div
                        key={j.id}
                        onClick={() => handleToggleJudgeAssignment(j.id, isAssigned, existingAssignment?.id)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: 'var(--space-3)',
                          border: `1.5px solid ${isAssigned ? 'var(--color-primary)' : 'var(--color-border)'}`,
                          background: isAssigned ? 'rgba(79, 70, 229, 0.08)' : 'var(--color-bg-surface)',
                          borderRadius: 'var(--radius-md)',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>
                            {j.full_name}
                          </div>
                          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                            {j.judge_id ? `ID: ${j.judge_id}` : j.email}
                          </div>
                        </div>
                        <div>
                          {isAssigned ? (
                            <span className="badge badge-success" style={{ fontSize: '11px' }}>✓ Assigned</span>
                          ) : (
                            <span className="btn btn-secondary btn-sm" style={{ padding: '2px 8px', fontSize: '11px' }}>+ Assign</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={() => setAssignModalTeam(null)}>Done</button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Assign to Specific Judge Modal */}
      {showBulkAssign && (
        <div className="modal-overlay" onClick={() => setShowBulkAssign(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">👤 Assign Selected Teams to Judge</h3>
              <button className="modal-close" onClick={() => setShowBulkAssign(false)}>×</button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)' }}>
                You have selected <strong>{selectedTeams.length}</strong> teams. Choose which jury member should evaluate these teams:
              </p>
              <div className="form-group">
                <label className="form-label">Select Jury Member</label>
                <select className="select" value={bulkJuryId} onChange={e => setBulkJuryId(e.target.value)}>
                  <option value="">Choose a judge...</option>
                  {activeJuries.map(j => (
                    <option key={j.id} value={j.id}>{j.full_name} ({j.judge_id || j.email})</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowBulkAssign(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleBulkAssignToJudge} disabled={!bulkJuryId}>
                Assign {selectedTeams.length} Teams
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

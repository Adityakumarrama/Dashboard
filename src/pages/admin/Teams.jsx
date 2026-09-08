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
  const [deletingBulk, setDeletingBulk] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showDeleteAllModal, setShowDeleteAllModal] = useState(false);
  const [deleteAllConfirmText, setDeleteAllConfirmText] = useState('');
  const [selectAllAcrossPages, setSelectAllAcrossPages] = useState(false);

  const initialForm = {
    team_code: '', team_name: '', problem_statement_id: '', problem_statement_title: '',
    organization: 'Rama University (F.E.T)', category: 'Software', track: '', team_leader: '',
    department: '', course: '', leader_phone: '', leader_email: '', leader_enrollment: '', submitter_email: '',
  };
  const [form, setForm] = useState(initialForm);
  const [codeManuallyEdited, setCodeManuallyEdited] = useState(false);
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

  const getNextSequenceNumber = () => {
    let maxSeq = 0;
    for (const t of teams) {
      if (!t.team_code) continue;
      const match = String(t.team_code).trim().match(/(?:_|-)(\d+)$/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (!isNaN(num) && num > maxSeq) maxSeq = num;
      }
    }
    const count = pagination?.total || teams.length;
    return Math.max(maxSeq, count) + 1;
  };

  const generateTeamCodeFromName = (name, seq = null) => {
    if (!name || typeof name !== 'string') return '';
    const clean = name.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const namePart = (clean.slice(0, 4) || 'TEAM').padEnd(4, 'X');
    const sequence = seq !== null ? seq : getNextSequenceNumber();
    const numStr = String(sequence).padStart(2, '0');
    return `SIH_${namePart}_${numStr}`;
  };

  const handleTeamNameChange = (name) => {
    const updated = { ...form, team_name: name };
    if (!codeManuallyEdited || !form.team_code) {
      updated.team_code = generateTeamCodeFromName(name);
    }
    setForm(updated);
  };

  const handleAutoGenerateCode = () => {
    const autoCode = generateTeamCodeFromName(form.team_name || 'TEAM');
    setForm(prev => ({ ...prev, team_code: autoCode }));
    setCodeManuallyEdited(false);
    toast.info(`Generated code: ${autoCode}`);
  };

  const openCreateModal = () => {
    setForm(initialForm);
    setCodeManuallyEdited(false);
    setShowCreate(true);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      await api.post('/teams', form);
      toast.success('Team created successfully');
      setShowCreate(false);
      setForm(initialForm);
      setCodeManuallyEdited(false);
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
    if (allSelected) {
      setSelectedTeams([]);
      setSelectAllAcrossPages(false);
    } else {
      setSelectedTeams(teams.map(t => t.id));
    }
  };
  const toggleSelectTeam = (id) => {
    setSelectAllAcrossPages(false);
    setSelectedTeams(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]);
  };

  const handleDeleteSelected = async () => {
    setDeletingBulk(true);
    try {
      const payload = selectAllAcrossPages ? { all: true } : { team_ids: selectedTeams };
      const res = await api.post('/teams/bulk-delete', payload);
      toast.success(res.message || 'Teams deleted successfully');
      setSelectedTeams([]);
      setSelectAllAcrossPages(false);
      setShowDeleteModal(false);
      fetchTeams();
    } catch (err) {
      toast.error(err.message || 'Failed to delete selected teams');
    } finally {
      setDeletingBulk(false);
    }
  };

  const handleDeleteAllTeams = async () => {
    if (deleteAllConfirmText.trim().toUpperCase() !== 'DELETE ALL') {
      toast.error('Please type DELETE ALL to confirm');
      return;
    }
    setDeletingBulk(true);
    try {
      const res = await api.post('/teams/bulk-delete', { all: true });
      toast.success(res.message || 'All teams deleted successfully');
      setSelectedTeams([]);
      setSelectAllAcrossPages(false);
      setShowDeleteAllModal(false);
      setDeleteAllConfirmText('');
      fetchTeams();
    } catch (err) {
      toast.error(err.message || 'Failed to delete all teams');
    } finally {
      setDeletingBulk(false);
    }
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
          <button className="btn btn-primary" onClick={openCreateModal}>+ Create Team</button>
          <button
            className="btn btn-secondary"
            style={{ color: 'var(--color-error, #ef4444)', borderColor: 'rgba(239, 68, 68, 0.4)' }}
            onClick={() => { setShowDeleteAllModal(true); setDeleteAllConfirmText(''); }}
          >
            🗑️ Delete All Teams
          </button>
        </div>
      </div>

      {/* Bulk action bar when items are selected */}
      {selectedTeams.length > 0 && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-2)',
          padding: 'var(--space-3) var(--space-4)',
          background: 'rgba(79, 70, 229, 0.08)',
          border: '1.5px solid var(--color-primary-light, #818cf8)',
          borderRadius: 'var(--radius-md)',
          marginBottom: 'var(--space-4)'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 'var(--space-3)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontWeight: 600 }}>
              <span>🎯</span>
              <span>
                {selectAllAcrossPages 
                  ? `All ${pagination?.total || teams.length} teams across all pages selected` 
                  : `${selectedTeams.length} teams selected`}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
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
                className="btn btn-sm"
                style={{ background: 'var(--color-error, #ef4444)', color: '#fff', border: 'none' }}
                onClick={() => setShowDeleteModal(true)}
                disabled={deletingBulk}
              >
                🗑️ Delete Selected ({selectAllAcrossPages ? pagination?.total : selectedTeams.length})
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => { setSelectedTeams([]); setSelectAllAcrossPages(false); }}
              >
                Clear Selection
              </button>
            </div>
          </div>

          {/* Across-pages selection banner */}
          {allSelected && pagination?.total > teams.length && (
            <div style={{
              fontSize: 'var(--text-sm)',
              padding: 'var(--space-2) var(--space-3)',
              background: 'var(--color-bg-surface)',
              borderRadius: 'var(--radius-sm)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              border: '1px dashed var(--color-primary-light, #818cf8)'
            }}>
              <span>
                {selectAllAcrossPages 
                  ? `All ${pagination.total} teams in the database are selected for bulk action.`
                  : `All ${teams.length} teams on this page are selected.`}
              </span>
              {!selectAllAcrossPages ? (
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ color: 'var(--color-accent)', textDecoration: 'underline', padding: 0 }}
                  onClick={() => setSelectAllAcrossPages(true)}
                >
                  Select all {pagination.total} teams across all pages
                </button>
              ) : (
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ color: 'var(--color-text-secondary)', textDecoration: 'underline', padding: 0 }}
                  onClick={() => setSelectAllAcrossPages(false)}
                >
                  Clear across-page selection
                </button>
              )}
            </div>
          )}
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
              <th style={{ width: 45, textAlign: 'center' }}>#</th>
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
                <tr key={i}><td colSpan="9"><div className="skeleton skeleton-text" /></td></tr>
              ))
            ) : teams.length === 0 ? (
              <tr><td colSpan="9" className="empty-state">
                <div className="empty-state-icon">👥</div>
                <div className="empty-state-title">No teams found</div>
                <div className="empty-state-text">Create teams or import them from CSV/TSV</div>
              </td></tr>
            ) : (
              teams.map((team, idx) => {
                const assigned = team.assigned_juries || [];
                const isSelected = selectedTeams.includes(team.id);
                const serialNumber = ((page - 1) * 25) + idx + 1;
                return (
                  <tr key={team.id} style={{ background: isSelected ? 'rgba(79, 70, 229, 0.04)' : undefined }}>
                    <td style={{ textAlign: 'center' }}>
                      <input type="checkbox" checked={isSelected} onChange={() => toggleSelectTeam(team.id)} />
                    </td>
                    <td style={{ textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', fontWeight: 600 }}>
                      {serialNumber}
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
                    <label className="form-label">Team Name *</label>
                    <input
                      className="input"
                      placeholder="e.g. CodeCrafters"
                      value={form.team_name}
                      onChange={e => handleTeamNameChange(e.target.value)}
                      required
                      autoFocus
                    />
                  </div>
                  <div className="form-group">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-1)' }}>
                      <label className="form-label" style={{ marginBottom: 0 }}>Team Code *</label>
                      <button
                        type="button"
                        onClick={handleAutoGenerateCode}
                        className="btn btn-ghost btn-sm"
                        style={{ padding: '0 6px', fontSize: '11px', color: 'var(--color-primary)' }}
                        title="Auto-generate in format: SIH_TEAMNAME_01"
                      >
                        ⚡ Auto Generate
                      </button>
                    </div>
                    <input
                      className="input"
                      placeholder="SIH_CODE_01"
                      value={form.team_code}
                      onChange={e => {
                        setCodeManuallyEdited(true);
                        setForm({ ...form, team_code: e.target.value.toUpperCase() });
                      }}
                      required
                      style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, letterSpacing: '0.5px' }}
                    />
                    <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '2px', display: 'block' }}>
                      Format: <code>SIH_&lt;NAME 4 chars&gt;_&lt;Sr. No.&gt;</code> (e.g. {generateTeamCodeFromName(form.team_name || 'CODE')})
                    </span>
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

      {/* Bulk Delete Selected Teams Modal */}
      {showDeleteModal && (
        <div className="modal-overlay" onClick={() => !deletingBulk && setShowDeleteModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ color: 'var(--color-error, #ef4444)' }}>
                🗑️ Delete Selected Teams
              </h3>
              <button className="modal-close" onClick={() => !deletingBulk && setShowDeleteModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <p style={{ marginBottom: 'var(--space-3)', fontSize: 'var(--text-base)' }}>
                Are you sure you want to permanently delete <strong>{selectAllAcrossPages ? (pagination?.total || teams.length) : selectedTeams.length}</strong> selected team(s)?
              </p>
              <div style={{
                padding: 'var(--space-3)',
                background: 'rgba(239, 68, 68, 0.08)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--color-error, #ef4444)',
                fontSize: 'var(--text-sm)',
                lineHeight: 1.5
              }}>
                ⚠️ <strong>Warning:</strong> This will also remove all student roster members, jury assignments, criteria scores, and evaluations for these teams. This action cannot be undone.
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowDeleteModal(false)} disabled={deletingBulk}>
                Cancel
              </button>
              <button
                className="btn"
                style={{ background: 'var(--color-error, #ef4444)', color: '#fff', border: 'none' }}
                onClick={handleDeleteSelected}
                disabled={deletingBulk}
              >
                {deletingBulk ? 'Deleting...' : `Permanently Delete ${selectAllAcrossPages ? (pagination?.total || teams.length) : selectedTeams.length} Team(s)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete All Teams Danger Modal */}
      {showDeleteAllModal && (
        <div className="modal-overlay" onClick={() => !deletingBulk && setShowDeleteAllModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ color: 'var(--color-error, #ef4444)' }}>
                ⚠️ Danger: Delete ALL Teams in Database
              </h3>
              <button className="modal-close" onClick={() => !deletingBulk && setShowDeleteAllModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div style={{
                padding: 'var(--space-3)',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1.5px solid rgba(239, 68, 68, 0.4)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--color-error, #ef4444)',
                marginBottom: 'var(--space-4)',
                fontSize: 'var(--text-sm)',
                lineHeight: 1.5
              }}>
                <strong>CRITICAL ACTION:</strong> This will permanently erase <strong>ALL {pagination?.total || teams.length} teams</strong> currently registered in the database. Every team roster, student member, judge assignment, evaluation, and score in the entire system will be wiped clean.
              </div>
              <p style={{ fontSize: 'var(--text-sm)', marginBottom: 'var(--space-2)' }}>
                To confirm this permanent action, please type <strong style={{ color: 'var(--color-error, #ef4444)' }}>DELETE ALL</strong> in the box below:
              </p>
              <input
                className="input"
                placeholder="Type DELETE ALL to confirm"
                value={deleteAllConfirmText}
                onChange={e => setDeleteAllConfirmText(e.target.value)}
                autoFocus
              />
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowDeleteAllModal(false)} disabled={deletingBulk}>
                Cancel
              </button>
              <button
                className="btn"
                style={{
                  background: deleteAllConfirmText.trim() === 'DELETE ALL' ? 'var(--color-error, #ef4444)' : '#9ca3af',
                  color: '#fff',
                  border: 'none',
                  cursor: deleteAllConfirmText.trim() === 'DELETE ALL' ? 'pointer' : 'not-allowed'
                }}
                onClick={handleDeleteAllTeams}
                disabled={deletingBulk || deleteAllConfirmText.trim() !== 'DELETE ALL'}
              >
                {deletingBulk ? 'Deleting Everything...' : 'Permanently Delete All Teams'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

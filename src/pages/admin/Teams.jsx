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
      setTeams(data.teams);
      setPagination(data.pagination);
    } catch { toast.error('Failed to load teams'); }
    setLoading(false);
  };

  useEffect(() => { fetchTeams(); }, [page, search]);

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

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Teams</h1>
          <p className="page-subtitle">{pagination?.total || 0} teams registered</p>
        </div>
        <div className="page-actions">
          <Link to="/admin/import" className="btn btn-secondary">📥 Import</Link>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ Create Team</button>
        </div>
      </div>

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
              <th>Team Code</th>
              <th>Team Name</th>
              <th>Department / Course</th>
              <th>Problem Statement</th>
              <th>Team Leader</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(5)].map((_, i) => (
                <tr key={i}><td colSpan="7"><div className="skeleton skeleton-text" /></td></tr>
              ))
            ) : teams.length === 0 ? (
              <tr><td colSpan="7" className="empty-state">
                <div className="empty-state-icon">👥</div>
                <div className="empty-state-title">No teams found</div>
                <div className="empty-state-text">Create teams or import them from CSV/TSV</div>
              </td></tr>
            ) : (
              teams.map(team => (
                <tr key={team.id}>
                  <td>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--color-accent)' }}>
                      {team.team_code}
                    </span>
                  </td>
                  <td><strong>{truncate(team.team_name, 28)}</strong></td>
                  <td style={{ fontSize: 'var(--text-sm)' }}>
                    <div>{team.department || team.track || '—'}</div>
                    {team.course && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{team.course}</div>}
                  </td>
                  <td style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                    {team.problem_statement_id && <span className="tag" style={{ marginRight: 4 }}>{team.problem_statement_id}</span>}
                    {truncate(team.problem_statement_title, 25)}
                  </td>
                  <td style={{ fontSize: 'var(--text-sm)' }}>
                    <div><strong>{truncate(team.team_leader || '—', 20)}</strong></div>
                    {team.leader_enrollment && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>{team.leader_enrollment}</div>}
                  </td>
                  <td><span className={`badge ${getStatusClass(team.registration_status)}`}>{team.registration_status}</span></td>
                  <td>
                    <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/admin/teams/${team.id}`)}>View</button>
                      <button className="btn btn-ghost btn-sm" style={{ color: 'var(--color-error)' }} onClick={() => handleDelete(team.id, team.team_code)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))
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
    </div>
  );
}

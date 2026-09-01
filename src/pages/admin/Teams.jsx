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
  const [form, setForm] = useState({ team_code: '', team_name: '', problem_statement_id: '', problem_statement_title: '', organization: '', category: '', track: '', team_leader: '' });
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
      setForm({ team_code: '', team_name: '', problem_statement_id: '', problem_statement_title: '', organization: '', category: '', track: '', team_leader: '' });
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
          <input className="input" placeholder="Search teams by code, name, or organization..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
      </div>

      {/* Table */}
      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Team Code</th>
              <th>Team Name</th>
              <th>Problem Statement</th>
              <th>Organization</th>
              <th>Category</th>
              <th>Track</th>
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
                <div className="empty-state-text">Create teams or import them from CSV/XML/PDF</div>
              </td></tr>
            ) : (
              teams.map(team => (
                <tr key={team.id}>
                  <td>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--color-accent)' }}>
                      {team.team_code}
                    </span>
                  </td>
                  <td><strong>{truncate(team.team_name, 30)}</strong></td>
                  <td style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                    {team.problem_statement_id && <span className="tag" style={{ marginRight: 4 }}>{team.problem_statement_id}</span>}
                    {truncate(team.problem_statement_title, 25)}
                  </td>
                  <td style={{ fontSize: 'var(--text-sm)' }}>{truncate(team.organization, 25)}</td>
                  <td><span className="tag">{team.category || '—'}</span></td>
                  <td style={{ fontSize: 'var(--text-sm)' }}>{team.track || '—'}</td>
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
                    <input className="input" placeholder="SIH2026-001" value={form.team_code} onChange={e => setForm({...form, team_code: e.target.value})} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Team Name *</label>
                    <input className="input" placeholder="AgriVision" value={form.team_name} onChange={e => setForm({...form, team_name: e.target.value})} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Problem Statement ID</label>
                    <input className="input" placeholder="PS-1042" value={form.problem_statement_id} onChange={e => setForm({...form, problem_statement_id: e.target.value})} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Problem Statement Title</label>
                    <input className="input" placeholder="AI Based Crop Monitoring" value={form.problem_statement_title} onChange={e => setForm({...form, problem_statement_title: e.target.value})} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Organization</label>
                    <input className="input" placeholder="XYZ Institute of Technology" value={form.organization} onChange={e => setForm({...form, organization: e.target.value})} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Category</label>
                    <input className="input" placeholder="Software" value={form.category} onChange={e => setForm({...form, category: e.target.value})} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Track</label>
                    <input className="input" placeholder="Agriculture" value={form.track} onChange={e => setForm({...form, track: e.target.value})} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Team Leader</label>
                    <input className="input" placeholder="Rahul Kumar" value={form.team_leader} onChange={e => setForm({...form, team_leader: e.target.value})} />
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

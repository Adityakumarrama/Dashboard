import { useState, useEffect } from 'react';
import api from '../../lib/api';
import { useToast } from '../../context/ToastContext';
import { formatDateTime, getStatusClass } from '../../lib/utils';

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ full_name: '', judge_id: '', password: '' });
  const toast = useToast();

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const data = await api.get('/users', { page, limit: 25, search, role: roleFilter });
      setUsers(data.users);
      setPagination(data.pagination);
    } catch { toast.error('Failed to load users'); }
    setLoading(false);
  };

  useEffect(() => { fetchUsers(); }, [page, search, roleFilter]);

  const handleCreate = async (e) => {
    e.preventDefault();
    const juryId = form.judge_id.trim();
    if (!juryId) return toast.error('Jury ID is required');
    if (!form.full_name.trim()) return toast.error('Name is required');
    if (!form.password || form.password.length < 8) return toast.error('Password must be at least 8 characters');

    const payload = {
      full_name: form.full_name.trim(),
      judge_id: juryId,
      password: form.password,
      username: juryId,
      email: `${juryId.toLowerCase().replace(/[^a-z0-9]/g, '')}@sih.gov.in`,
      role: 'JURY',
    };

    try {
      await api.post('/users', payload);
      toast.success(`Jury created! Login credentials:\nJury ID: ${juryId}\nPassword: ${form.password}`);
      setShowCreate(false);
      setForm({ full_name: '', judge_id: '', password: '' });
      fetchUsers();
    } catch (err) { toast.error(err.message); }
  };

  const handleToggleStatus = async (user) => {
    const newStatus = user.status === 'active' ? 'inactive' : 'active';
    try {
      await api.put(`/users/${user.id}`, { status: newStatus });
      toast.success(`User ${newStatus === 'active' ? 'activated' : 'deactivated'}`);
      fetchUsers();
    } catch (err) { toast.error(err.message); }
  };

  const handleDelete = async (user) => {
    if (!confirm(`Delete ${user.full_name}?\n\nThis user has ${user.evaluations_completed || 0} submitted evaluations.\nHistorical evaluations will be preserved.`)) return;
    try {
      await api.delete(`/users/${user.id}`);
      toast.success('User deactivated');
      fetchUsers();
    } catch (err) { toast.error(err.message); }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Users</h1>
          <p className="page-subtitle">{pagination?.total || 0} total users</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ Create Jury</button>
      </div>

      <div className="toolbar">
        <div className="search-container" style={{ flex: 1, maxWidth: 400 }}>
          <span className="search-icon">🔍</span>
          <input className="input" placeholder="Search by name, email, or username..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <select className="select" style={{ width: 150 }} value={roleFilter} onChange={e => { setRoleFilter(e.target.value); setPage(1); }}>
          <option value="">All Roles</option>
          <option value="ADMIN">Admin</option>
          <option value="JURY">Jury</option>
        </select>
      </div>

      <div className="table-container">
        <table className="table">
          <thead>
            <tr><th>Name</th><th>Jury ID</th><th>Role</th><th>Status</th><th>Assigned</th><th>Completed</th><th>Last Login</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {loading ? [...Array(3)].map((_, i) => <tr key={i}><td colSpan="8"><div className="skeleton skeleton-text" /></td></tr>) :
            users.length === 0 ? <tr><td colSpan="8" className="empty-state"><div className="empty-state-title">No users found</div></td></tr> :
            users.map(user => (
              <tr key={user.id}>
                <td><strong>{user.full_name}</strong></td>
                <td style={{ fontSize: 'var(--text-sm)', fontFamily: 'monospace' }}>{user.judge_id || user.username || '—'}</td>
                <td><span className={`badge ${user.role === 'ADMIN' ? 'badge-accent' : 'badge-info'}`}>{user.role}</span></td>
                <td><span className={`badge ${getStatusClass(user.status)}`}>{user.status}</span></td>
                <td>{user.assigned_teams || 0}</td>
                <td>{user.evaluations_completed || 0}</td>
                <td style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>{formatDateTime(user.last_login_at)}</td>
                <td>
                  <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => handleToggleStatus(user)}>{user.status === 'active' ? 'Deactivate' : 'Activate'}</button>
                    <button className="btn btn-ghost btn-sm" style={{ color: 'var(--color-error)' }} onClick={() => handleDelete(user)}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3 className="modal-title">Create Jury Member</h3><button className="modal-close" onClick={() => setShowCreate(false)}>×</button></div>
            <form onSubmit={handleCreate}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Full Name *</label>
                  <input className="input" placeholder="e.g. Kuldeep Singh" value={form.full_name} onChange={e => setForm({...form, full_name: e.target.value})} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Jury ID * <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', fontWeight: 'normal' }}>(used for login)</span></label>
                  <input className="input" placeholder="e.g. JRY-001" value={form.judge_id} onChange={e => setForm({...form, judge_id: e.target.value})} required style={{ fontFamily: 'monospace', letterSpacing: '0.5px' }} />
                </div>
                <div className="form-group">
                  <label className="form-label">Password *</label>
                  <input className="input" type="password" placeholder="Min 8 characters" value={form.password} onChange={e => setForm({...form, password: e.target.value})} required minLength={8} />
                </div>
                <div style={{ padding: 'var(--space-3)', background: 'var(--color-bg-tertiary)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginTop: 'var(--space-2)' }}>
                  <strong style={{ color: 'var(--color-text-secondary)' }}>📋 Login Credentials Preview:</strong><br/>
                  <span>Jury ID: </span><strong style={{ fontFamily: 'monospace', color: 'var(--color-primary)' }}>{form.judge_id || '—'}</strong><br/>
                  <span>Password: </span><strong style={{ fontFamily: 'monospace' }}>{form.password ? '••••••••' : '—'}</strong>
                </div>
              </div>
              <div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button><button type="submit" className="btn btn-primary">Create Jury</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

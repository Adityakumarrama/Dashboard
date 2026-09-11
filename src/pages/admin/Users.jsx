import { useState, useEffect } from 'react';
import api from '../../lib/api';
import { useToast } from '../../context/ToastContext';
import { formatDateTime } from '../../lib/utils';

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ full_name: '', judge_id: '', password: '' });

  // Edit state
  const [editingUser, setEditingUser] = useState(null);
  const [editForm, setEditForm] = useState({
    full_name: '',
    judge_id: '',
    email: '',
    role: 'JURY',
    status: 'active',
    password: '',
  });
  const [showEditPassword, setShowEditPassword] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);

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

  const handleOpenEdit = (user) => {
    setEditingUser(user);
    setEditForm({
      full_name: user.full_name || '',
      judge_id: user.judge_id || '',
      email: user.email || '',
      role: user.role || 'JURY',
      status: user.status || 'active',
      password: '',
    });
    setShowEditPassword(false);
  };

  const handleCloseEdit = () => {
    setEditingUser(null);
    setSavingEdit(false);
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!editingUser) return;

    const trimmedName = editForm.full_name.trim();
    const trimmedJudgeId = editForm.judge_id.trim();
    const trimmedEmail = editForm.email.trim();

    if (!trimmedName) return toast.error('Full Name is required');
    if (editForm.role === 'JURY' && !trimmedJudgeId) return toast.error('Jury ID is required for jury members');
    if (!trimmedEmail) return toast.error('Email is required');
    if (editForm.password && editForm.password.length < 8) {
      return toast.error('Password must be at least 8 characters');
    }

    setSavingEdit(true);
    try {
      const payload = {
        full_name: trimmedName,
        judge_id: trimmedJudgeId || null,
        email: trimmedEmail,
        role: editForm.role,
        status: editForm.status,
      };
      if (editForm.password) {
        payload.password = editForm.password;
      }

      await api.put(`/users/${editingUser.id}`, payload);
      toast.success(`User details updated successfully for ${trimmedName}`);
      handleCloseEdit();
      fetchUsers();
    } catch (err) {
      toast.error(err.message || 'Failed to update user');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async (user) => {
    if (!confirm(`Permanently delete ${user.full_name}?\n\nThis action cannot be undone.\nAll evaluations by this user will be preserved.`)) return;
    try {
      await api.delete(`/users/${user.id}`);
      toast.success('User deleted permanently');
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
                <td>
                  <strong>{user.full_name}</strong>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{user.email}</div>
                </td>
                <td style={{ fontSize: 'var(--text-sm)', fontFamily: 'monospace' }}>{user.judge_id || user.username || '—'}</td>
                <td><span className={`badge ${user.role === 'ADMIN' ? 'badge-accent' : 'badge-info'}`}>{user.role}</span></td>
                <td>
                  <span className={`badge ${user.status === 'inactive' ? 'badge-warning' : 'badge-success'}`}>
                    {user.status || 'active'}
                  </span>
                </td>
                <td>{user.assigned_teams || 0}</td>
                <td>{user.evaluations_completed || 0}</td>
                <td style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>{formatDateTime(user.last_login_at)}</td>
                <td>
                  <div style={{ display: 'flex', gap: 'var(--space-1)', alignItems: 'center' }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => handleOpenEdit(user)}>
                      ✏️ Edit
                    </button>
                    {user.role !== 'ADMIN' && (
                      <button className="btn btn-ghost btn-sm" style={{ color: 'var(--color-error)' }} onClick={() => handleDelete(user)}>
                        Delete
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Create Jury Member</h3>
              <button className="modal-close" onClick={() => setShowCreate(false)}>×</button>
            </div>
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
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Create Jury</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editingUser && (
        <div className="modal-overlay" onClick={handleCloseEdit}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3 className="modal-title">Edit User Details</h3>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                  Updating details for <strong style={{ fontFamily: 'monospace' }}>{editingUser.judge_id || editingUser.username || editingUser.email}</strong>
                </div>
              </div>
              <button className="modal-close" onClick={handleCloseEdit}>×</button>
            </div>

            <form onSubmit={handleSaveEdit}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Full Name *</label>
                  <input
                    className="input"
                    value={editForm.full_name}
                    onChange={e => setEditForm({ ...editForm, full_name: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">
                    Jury ID {editForm.role === 'JURY' && '*'} <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', fontWeight: 'normal' }}>(sign-in code)</span>
                  </label>
                  <input
                    className="input"
                    value={editForm.judge_id}
                    onChange={e => setEditForm({ ...editForm, judge_id: e.target.value })}
                    required={editForm.role === 'JURY'}
                    style={{ fontFamily: 'monospace', letterSpacing: '0.5px' }}
                    placeholder="e.g. JRY-001"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Email Address *</label>
                  <input
                    className="input"
                    type="email"
                    value={editForm.email}
                    onChange={e => setEditForm({ ...editForm, email: e.target.value })}
                    required
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                  <div className="form-group">
                    <label className="form-label">Role</label>
                    <select
                      className="select"
                      value={editForm.role}
                      onChange={e => setEditForm({ ...editForm, role: e.target.value })}
                    >
                      <option value="JURY">Jury</option>
                      <option value="ADMIN">Admin</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Account Status</label>
                    <select
                      className="select"
                      value={editForm.status}
                      onChange={e => setEditForm({ ...editForm, status: e.target.value })}
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </div>
                </div>

                <div style={{ padding: 'var(--space-3)', background: 'var(--color-bg-tertiary)', borderRadius: 'var(--radius-md)', marginTop: 'var(--space-3)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
                    <label className="form-label" style={{ margin: 0 }}>
                      🔑 Reset Password <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', fontWeight: 'normal' }}>(optional)</span>
                    </label>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setShowEditPassword(!showEditPassword)}
                      style={{ padding: '2px 8px', fontSize: 'var(--text-xs)' }}
                    >
                      {showEditPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  <input
                    className="input"
                    type={showEditPassword ? 'text' : 'password'}
                    placeholder="Leave blank to keep existing password"
                    value={editForm.password}
                    onChange={e => setEditForm({ ...editForm, password: e.target.value })}
                    minLength={8}
                    style={{ background: 'var(--color-bg-surface)' }}
                  />
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-2)' }}>
                    {editForm.password ? '⚠️ Entering a new password will immediately update the login password.' : 'Leave this field blank to keep the user\'s current password.'}
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleCloseEdit}
                  disabled={savingEdit}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={savingEdit}
                >
                  {savingEdit ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

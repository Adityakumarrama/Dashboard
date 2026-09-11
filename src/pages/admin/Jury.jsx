import { useState, useEffect, useCallback } from 'react';
import api from '../../lib/api';
import { formatTimeAgo } from '../../lib/utils';
import { useToast } from '../../context/ToastContext';

export default function AdminJury() {
  const [juryData, setJuryData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  
  // Edit modal state
  const [editingJury, setEditingJury] = useState(null);
  const [editForm, setEditForm] = useState({
    full_name: '',
    judge_id: '',
    email: '',
    status: 'active',
    password: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const fetchJury = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const data = await api.get('/assignments');
      setJuryData(data.jurySummary || []);
    } catch (err) {
      console.error('Failed to load jury members:', err);
      toast.error('Failed to load jury members');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchJury();
    const timer = setInterval(() => fetchJury(), 15000);
    return () => clearInterval(timer);
  }, [fetchJury]);

  const handleOpenEdit = (jury) => {
    setEditingJury(jury);
    setEditForm({
      full_name: jury.full_name || '',
      judge_id: jury.judge_id || '',
      email: jury.email || '',
      status: jury.status || 'active',
      password: '',
    });
    setShowPassword(false);
  };

  const handleCloseEdit = () => {
    setEditingJury(null);
    setSaving(false);
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!editingJury) return;

    const trimmedName = editForm.full_name.trim();
    const trimmedJudgeId = editForm.judge_id.trim();
    const trimmedEmail = editForm.email.trim();

    if (!trimmedName) return toast.error('Full Name is required');
    if (!trimmedJudgeId) return toast.error('Jury ID is required');
    if (!trimmedEmail) return toast.error('Email is required');

    if (editForm.password && editForm.password.length < 8) {
      return toast.error('Password must be at least 8 characters');
    }

    setSaving(true);
    try {
      const payload = {
        full_name: trimmedName,
        judge_id: trimmedJudgeId,
        email: trimmedEmail,
        status: editForm.status,
      };
      if (editForm.password) {
        payload.password = editForm.password;
      }

      await api.put(`/users/${editingJury.id}`, payload);
      toast.success(
        editForm.password
          ? `Jury details & password updated successfully for ${trimmedJudgeId}!`
          : `Jury details updated successfully for ${trimmedJudgeId}!`
      );
      handleCloseEdit();
      fetchJury(false);
    } catch (err) {
      toast.error(err.message || 'Failed to update jury details');
    } finally {
      setSaving(false);
    }
  };

  // Filtered jury list
  const filteredJury = juryData.filter(j => {
    const matchesSearch = !search ||
      j.full_name?.toLowerCase().includes(search.toLowerCase()) ||
      j.judge_id?.toLowerCase().includes(search.toLowerCase()) ||
      j.email?.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = !statusFilter || (j.status || 'active') === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Jury Members</h1>
          <p className="page-subtitle">Monitor judging progress, live evaluations, and manage evaluator profiles</p>
        </div>
        <div className="page-actions">
          <button
            className="btn btn-secondary"
            onClick={() => fetchJury(true)}
            disabled={refreshing}
          >
            {refreshing ? '⏳ Refreshing...' : '🔄 Refresh'}
          </button>
        </div>
      </div>

      <div className="toolbar" style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', marginBottom: 'var(--space-5)' }}>
        <div className="search-container" style={{ flex: 1, minWidth: 260, maxWidth: 450 }}>
          <span className="search-icon">🔍</span>
          <input
            className="input"
            placeholder="Search by name, Jury ID, or email..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select
          className="select"
          style={{ width: 160 }}
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
        >
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      <div className="grid grid-auto">
        {loading ? [...Array(4)].map((_, i) => <div key={i} className="skeleton skeleton-card" />) :
        filteredJury.length === 0 ? (
          <div className="empty-state" style={{ gridColumn: '1 / -1' }}>
            <div className="empty-state-title">No jury members found</div>
            <p style={{ color: 'var(--color-text-muted)', marginTop: 'var(--space-2)' }}>
              {search || statusFilter ? 'Try clearing your filters.' : 'Create jury members in the Users tab.'}
            </p>
          </div>
        ) :
        filteredJury.map(j => {
          const assigned = Number(j.assigned_count) || 0;
          const completed = Number(j.completed_count) || 0;
          const pending = Number(j.pending_count) || Math.max(assigned - completed, 0);
          const percent = assigned > 0 ? ((completed / assigned) * 100).toFixed(0) : '0';
          const isInactive = j.status === 'inactive';

          return (
            <div className="card" key={j.id} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', opacity: isInactive ? 0.75 : 1 }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <h4 style={{ margin: 0, fontSize: 'var(--text-lg)' }}>{j.full_name}</h4>
                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                      {j.email}
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', marginTop: 'var(--space-2)' }}>
                      {j.judge_id && (
                        <span className="tag" style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                          {j.judge_id}
                        </span>
                      )}
                      <span className={`badge ${isInactive ? 'badge-warning' : 'badge-success'}`}>
                        {isInactive ? 'INACTIVE' : 'ACTIVE'}
                      </span>
                    </div>
                  </div>
                  <span className="badge badge-info">JURY</span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
                  <div style={{ textAlign: 'center', padding: 'var(--space-2)', background: 'var(--color-bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
                    <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700 }}>{assigned}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Assigned</div>
                  </div>
                  <div style={{ textAlign: 'center', padding: 'var(--space-2)', background: 'var(--color-bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
                    <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--color-success)' }}>{completed}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Completed</div>
                  </div>
                  <div style={{ textAlign: 'center', padding: 'var(--space-2)', background: 'var(--color-bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
                    <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--color-warning)' }}>{pending}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Pending</div>
                  </div>
                </div>

                <div style={{ marginTop: 'var(--space-4)' }}>
                  <div className="progress-bar-wrapper">
                    <div className="progress-bar-fill" style={{ width: `${Math.min(100, Number(percent))}%` }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--space-1)' }}>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', fontWeight: 600 }}>
                      {percent}% completed
                    </span>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                      {j.last_activity ? formatTimeAgo(j.last_activity) : 'No activity yet'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Button */}
              <div style={{ marginTop: 'var(--space-5)', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--color-border)' }}>
                <button
                  className="btn btn-secondary btn-sm"
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)' }}
                  onClick={() => handleOpenEdit(j)}
                >
                  <span>✏️</span> Edit Details
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Edit Jury Details Modal */}
      {editingJury && (
        <div className="modal-overlay" onClick={handleCloseEdit}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3 className="modal-title">Edit Jury Details</h3>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                  Updating evaluator profile for <strong style={{ fontFamily: 'monospace' }}>{editingJury.judge_id || editingJury.full_name}</strong>
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
                    placeholder="e.g. Dr. Rajesh Sharma"
                    value={editForm.full_name}
                    onChange={e => setEditForm({ ...editForm, full_name: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">
                    Jury ID * <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', fontWeight: 'normal' }}>(used for sign in)</span>
                  </label>
                  <input
                    className="input"
                    placeholder="e.g. JRY-001"
                    value={editForm.judge_id}
                    onChange={e => setEditForm({ ...editForm, judge_id: e.target.value })}
                    required
                    style={{ fontFamily: 'monospace', letterSpacing: '0.5px' }}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Email Address *</label>
                  <input
                    className="input"
                    type="email"
                    placeholder="e.g. jry001@sih.gov.in"
                    value={editForm.email}
                    onChange={e => setEditForm({ ...editForm, email: e.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Account Status</label>
                  <select
                    className="select"
                    value={editForm.status}
                    onChange={e => setEditForm({ ...editForm, status: e.target.value })}
                  >
                    <option value="active">Active (Can log in & evaluate)</option>
                    <option value="inactive">Inactive (Access suspended)</option>
                  </select>
                </div>

                <div style={{ padding: 'var(--space-3)', background: 'var(--color-bg-tertiary)', borderRadius: 'var(--radius-md)', marginTop: 'var(--space-3)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
                    <label className="form-label" style={{ margin: 0 }}>
                      🔑 Reset Password <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', fontWeight: 'normal' }}>(optional)</span>
                    </label>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setShowPassword(!showPassword)}
                      style={{ padding: '2px 8px', fontSize: 'var(--text-xs)' }}
                    >
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  <input
                    className="input"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Leave blank to keep existing password"
                    value={editForm.password}
                    onChange={e => setEditForm({ ...editForm, password: e.target.value })}
                    minLength={8}
                    style={{ background: 'var(--color-bg-surface)' }}
                  />
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-2)' }}>
                    {editForm.password ? '⚠️ Entering a new password will immediately update the evaluator credentials.' : 'Leave this field blank unless you want to reset this jury member\'s password.'}
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleCloseEdit}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={saving}
                >
                  {saving ? 'Saving Changes...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

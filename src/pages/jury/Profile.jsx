import { useAuth } from '../../context/AuthContext';
import { formatDateTime } from '../../lib/utils';

export default function JuryProfile() {
  const { user } = useAuth();

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Jury Profile</h1>
          <p className="page-subtitle">Your evaluator account details</p>
        </div>
      </div>

      <div className="card" style={{ maxWidth: 600 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', marginBottom: 'var(--space-6)' }}>
          <div
            className="header-avatar"
            style={{ width: 64, height: 64, fontSize: 'var(--text-xl)', borderRadius: 'var(--radius-lg)' }}
          >
            {user?.fullName?.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || 'JU'}
          </div>
          <div>
            <h3>{user?.fullName || 'Jury Member'}</h3>
            <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
              @{user?.username || 'jury'}
            </div>
            <span className="badge badge-info" style={{ marginTop: 'var(--space-1)' }}>
              {user?.role || 'JURY'}
            </span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
          <div className="form-group">
            <label className="form-label">Email Address</label>
            <input className="input" value={user?.email || ''} readOnly disabled />
          </div>
          <div className="form-group">
            <label className="form-label">Judge ID</label>
            <input className="input" value={user?.judgeId || 'Not Assigned'} readOnly disabled />
          </div>
          <div className="form-group">
            <label className="form-label">Account Status</label>
            <input className="input" value={user?.status?.toUpperCase() || 'ACTIVE'} readOnly disabled />
          </div>
          <div className="form-group">
            <label className="form-label">Member Since</label>
            <input className="input" value={formatDateTime(user?.created_at) || 'Current Event'} readOnly disabled />
          </div>
        </div>

        <div style={{ marginTop: 'var(--space-4)', padding: 'var(--space-4)', background: 'var(--color-bg-surface-alt)', borderRadius: 'var(--radius-md)' }}>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 'var(--space-1)' }}>
            🔒 Security Notice
          </div>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', margin: 0 }}>
            Evaluation logs and score submissions are permanently timestamped with your account credentials and IP address for compliance and auditing.
          </p>
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const data = await login(email, password);
      toast.success('Login successful');
      const role = data?.user?.user_metadata?.role ||
        (email.toLowerCase().includes('admin') ? 'ADMIN' : 'JURY');
      navigate(role === 'ADMIN' ? '/admin' : '/jury', { replace: true });
    } catch (err) {
      setError(err.message || 'Invalid credentials');
      toast.error('Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-layout">
      <div className="login-card">
        <div className="login-header">
          <div style={{ fontSize: '48px' }}>⚖️</div>
          <h1 className="login-title">SIH Jury Platform</h1>
          <p className="login-subtitle">Sign in to your evaluation account</p>
        </div>

        <form onSubmit={handleSubmit}>
          {error && (
            <div style={{
              padding: 'var(--space-3) var(--space-4)',
              background: 'var(--color-error-light)',
              color: 'var(--color-error-dark)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-sm)',
              marginBottom: 'var(--space-4)',
            }}>
              {error}
            </div>
          )}

          <div className="form-group">
            <label className="form-label" htmlFor="email">User ID / Email</label>
            <input
              id="email"
              type="text"
              className="input"
              placeholder="e.g. SIHadmin6388@sih"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoFocus
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              className="input"
              placeholder="Enter your password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              disabled={loading}
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-block btn-lg"
            disabled={loading}
            style={{ marginTop: 'var(--space-4)' }}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div style={{
          marginTop: 'var(--space-6)',
          paddingTop: 'var(--space-4)',
          borderTop: '1px solid var(--color-border)',
          textAlign: 'center',
        }}>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
            Smart India Hackathon 2026 — Jury Evaluation System
          </p>
        </div>
      </div>
    </div>
  );
}

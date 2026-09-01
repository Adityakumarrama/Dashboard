import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="login-layout">
      <div style={{ textAlign: 'center', color: 'white' }}>
        <div style={{ fontSize: '72px', marginBottom: '16px' }}>404</div>
        <h2 style={{ fontSize: '24px', marginBottom: '8px' }}>Page Not Found</h2>
        <p style={{ color: '#94a3b8', marginBottom: '24px' }}>
          The page you're looking for doesn't exist.
        </p>
        <Link to="/" className="btn btn-primary btn-lg">Go Home</Link>
      </div>
    </div>
  );
}

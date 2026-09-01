import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

const adminLinks = [
  { to: '/admin', icon: '📊', label: 'Dashboard', exact: true },
  { to: '/admin/teams', icon: '👥', label: 'Teams' },
  { to: '/admin/jury', icon: '⚖️', label: 'Jury' },
  { to: '/admin/users', icon: '👤', label: 'Users' },
  { to: '/admin/assignments', icon: '📋', label: 'Assignments' },
  { to: '/admin/scoring', icon: '🎯', label: 'Scoring Criteria' },
  { to: '/admin/evaluations', icon: '📝', label: 'Evaluations' },
  { to: '/admin/import', icon: '📥', label: 'Import Center' },
  { to: '/admin/audit-logs', icon: '📜', label: 'Audit Logs' },
  { to: '/admin/settings', icon: '⚙️', label: 'Settings' },
];

const juryLinks = [
  { to: '/jury', icon: '📊', label: 'Dashboard', exact: true },
  { to: '/jury/teams', icon: '👥', label: 'My Teams' },
  { to: '/jury/search', icon: '🔍', label: 'Search Team' },
  { to: '/jury/completed', icon: '✅', label: 'Completed Evaluations' },
  { to: '/jury/profile', icon: '👤', label: 'Profile' },
];

export default function Sidebar({ isOpen, onClose }) {
  const { user, isAdmin } = useAuth();
  const location = useLocation();
  const links = isAdmin ? adminLinks : juryLinks;

  return (
    <>
      {isOpen && <div className="sidebar-overlay" onClick={onClose} />}
      <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <span>SIH</span> Jury
          </div>
        </div>

        <nav className="sidebar-nav">
          <div className="sidebar-section">
            <div className="sidebar-section-title">
              {isAdmin ? 'Administration' : 'Jury Panel'}
            </div>
            {links.map(link => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.exact}
                className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
                onClick={onClose}
              >
                <span className="sidebar-icon">{link.icon}</span>
                <span>{link.label}</span>
              </NavLink>
            ))}
          </div>
        </nav>

        <div className="sidebar-footer">
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
            {user?.fullName}
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', opacity: 0.7 }}>
            {user?.role}
          </div>
        </div>
      </aside>
    </>
  );
}

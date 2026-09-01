import { useAuth } from '../../context/AuthContext';

export default function Header({ onMenuToggle }) {
  const { user, logout } = useAuth();

  const initials = user?.fullName
    ? user.fullName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()
    : '??';

  return (
    <header className="header">
      <div className="header-left">
        <button className="menu-toggle" onClick={onMenuToggle}>☰</button>
      </div>

      <div className="header-right">
        <div className="header-user">
          <div>
            <div className="header-user-name">{user?.fullName}</div>
            <div className={`badge ${user?.role === 'ADMIN' ? 'badge-accent' : 'badge-info'}`}>
              {user?.role}
            </div>
          </div>
          <div className="header-avatar">{initials}</div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={logout}>Logout</button>
      </div>
    </header>
  );
}

import { useState, useEffect } from 'react';
import api from '../../lib/api';
import { formatDateTime, capitalize } from '../../lib/utils';

export default function AuditLogs() {
  const [logs, setLogs] = useState([]);
  const [actions, setActions] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    setLoading(true);
    api.get('/audit', { page, limit: 50, action: actionFilter }).then(data => {
      setLogs(data.logs);
      setActions(data.actions || []);
      setPagination(data.pagination);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [page, actionFilter]);

  return (
    <div>
      <div className="page-header">
        <div><h1 className="page-title">Audit Logs</h1><p className="page-subtitle">{pagination?.total || 0} log entries</p></div>
        <select className="select" style={{ width: 200 }} value={actionFilter} onChange={e => { setActionFilter(e.target.value); setPage(1); }}>
          <option value="">All Actions</option>
          {actions.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      <div className="table-container">
        <table className="table">
          <thead><tr><th>Timestamp</th><th>User</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead>
          <tbody>
            {loading ? [...Array(5)].map((_, i) => <tr key={i}><td colSpan="5"><div className="skeleton skeleton-text" /></td></tr>) :
            logs.length === 0 ? <tr><td colSpan="5" className="empty-state"><div className="empty-state-title">No audit logs</div></td></tr> :
            logs.map(log => (
              <tr key={log.id}>
                <td style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>{formatDateTime(log.created_at)}</td>
                <td><strong>{log.user_name || 'System'}</strong>{log.user_role && <><br/><span className={`badge ${log.user_role === 'ADMIN' ? 'badge-accent' : 'badge-info'}`} style={{ fontSize: '10px' }}>{log.user_role}</span></>}</td>
                <td><span className="tag">{log.action}</span></td>
                <td style={{ fontSize: 'var(--text-sm)' }}>{log.entity_type}{log.entity_id ? ` #${log.entity_id.substring(0, 8)}` : ''}</td>
                <td style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {log.details ? JSON.stringify(typeof log.details === 'string' ? JSON.parse(log.details) : log.details).substring(0, 100) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pagination && pagination.totalPages > 1 && (
        <div className="pagination">
          <span>{pagination.total} entries</span>
          <div className="pagination-buttons">
            <button className="pagination-btn" disabled={!pagination.hasPrev} onClick={() => setPage(p => p-1)}>← Prev</button>
            <button className="pagination-btn" disabled={!pagination.hasNext} onClick={() => setPage(p => p+1)}>Next →</button>
          </div>
        </div>
      )}
    </div>
  );
}

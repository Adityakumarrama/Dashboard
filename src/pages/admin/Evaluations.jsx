import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import { formatDateTime, getStatusClass } from '../../lib/utils';

export default function AdminEvaluations() {
  const [evaluations, setEvaluations] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    setLoading(true);
    api.get('/evaluations', { page, limit: 25, status: statusFilter }).then(data => {
      setEvaluations(data.evaluations);
      setPagination(data.pagination);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [page, statusFilter]);

  return (
    <div>
      <div className="page-header">
        <div><h1 className="page-title">Evaluations</h1><p className="page-subtitle">{pagination?.total || 0} total evaluations</p></div>
        <select className="select" style={{ width: 150 }} value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}>
          <option value="">All Status</option>
          <option value="draft">Draft</option>
          <option value="submitted">Submitted</option>
          <option value="reopened">Reopened</option>
        </select>
      </div>

      <div className="table-container">
        <table className="table">
          <thead><tr><th>Team Code</th><th>Team Name</th><th>Judge</th><th>Status</th><th>Score</th><th>Submitted</th><th>Actions</th></tr></thead>
          <tbody>
            {loading ? [...Array(5)].map((_, i) => <tr key={i}><td colSpan="7"><div className="skeleton skeleton-text" /></td></tr>) :
            evaluations.length === 0 ? <tr><td colSpan="7" className="empty-state"><div className="empty-state-title">No evaluations found</div></td></tr> :
            evaluations.map(ev => (
              <tr key={ev.id}>
                <td><span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-accent)', fontWeight: 600 }}>{ev.team_code}</span></td>
                <td>{ev.team_name}</td>
                <td>{ev.judge_name}</td>
                <td><span className={`badge ${getStatusClass(ev.status)}`}>{ev.status}</span></td>
                <td><strong>{ev.total_score !== null ? ev.total_score : '—'}</strong></td>
                <td style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>{formatDateTime(ev.submitted_at)}</td>
                <td><Link to={`/admin/evaluations/${ev.id}`} className="btn btn-ghost btn-sm">View</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pagination && pagination.totalPages > 1 && (
        <div className="pagination">
          <span>{pagination.total} evaluations</span>
          <div className="pagination-buttons">
            <button className="pagination-btn" disabled={!pagination.hasPrev} onClick={() => setPage(p => p-1)}>← Prev</button>
            <button className="pagination-btn" disabled={!pagination.hasNext} onClick={() => setPage(p => p+1)}>Next →</button>
          </div>
        </div>
      )}
    </div>
  );
}

import { useState, useEffect } from 'react';
import api from '../../lib/api';
import { formatTimeAgo } from '../../lib/utils';

export default function AdminJury() {
  const [juryData, setJuryData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/assignments').then(data => {
      setJuryData(data.jurySummary || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="page-header">
        <div><h1 className="page-title">Jury Members</h1><p className="page-subtitle">Monitor judging progress</p></div>
      </div>

      <div className="grid grid-auto">
        {loading ? [...Array(4)].map((_, i) => <div key={i} className="skeleton skeleton-card" />) :
        juryData.length === 0 ? <div className="empty-state"><div className="empty-state-title">No jury members found</div></div> :
        juryData.map(j => (
          <div className="card" key={j.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h4>{j.full_name}</h4>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>{j.email}</div>
                {j.judge_id && <span className="tag" style={{ marginTop: 'var(--space-2)' }}>{j.judge_id}</span>}
              </div>
              <span className="badge badge-info">JURY</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700 }}>{j.assigned_count}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Assigned</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--color-success)' }}>{j.completed_count}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Completed</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--color-warning)' }}>{j.pending_count}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Pending</div>
              </div>
            </div>
            <div style={{ marginTop: 'var(--space-3)' }}>
              <div className="progress-bar-wrapper">
                <div className="progress-bar-fill" style={{ width: `${j.assigned_count > 0 ? (j.completed_count / j.assigned_count * 100) : 0}%` }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--space-1)' }}>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                  {j.assigned_count > 0 ? `${(j.completed_count / j.assigned_count * 100).toFixed(0)}%` : '0%'}
                </span>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                  {j.last_activity ? formatTimeAgo(j.last_activity) : 'No activity'}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

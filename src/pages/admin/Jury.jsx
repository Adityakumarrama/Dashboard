import { useState, useEffect, useCallback } from 'react';
import api from '../../lib/api';
import { formatTimeAgo } from '../../lib/utils';

export default function AdminJury() {
  const [juryData, setJuryData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchJury = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const data = await api.get('/assignments');
      setJuryData(data.jurySummary || []);
    } catch (err) {
      console.error('Failed to load jury members:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchJury();
    const timer = setInterval(() => fetchJury(), 15000);
    return () => clearInterval(timer);
  }, [fetchJury]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Jury Members</h1>
          <p className="page-subtitle">Monitor judging progress and live evaluations</p>
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

      <div className="grid grid-auto">
        {loading ? [...Array(4)].map((_, i) => <div key={i} className="skeleton skeleton-card" />) :
        juryData.length === 0 ? <div className="empty-state"><div className="empty-state-title">No jury members found</div></div> :
        juryData.map(j => {
          const assigned = Number(j.assigned_count) || 0;
          const completed = Number(j.completed_count) || 0;
          const pending = Number(j.pending_count) || Math.max(assigned - completed, 0);
          const percent = assigned > 0 ? ((completed / assigned) * 100).toFixed(0) : '0';

          return (
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
                  <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700 }}>{assigned}</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Assigned</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--color-success)' }}>{completed}</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Completed</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--color-warning)' }}>{pending}</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Pending</div>
                </div>
              </div>
              <div style={{ marginTop: 'var(--space-3)' }}>
                <div className="progress-bar-wrapper">
                  <div className="progress-bar-fill" style={{ width: `${Math.min(100, Number(percent))}%` }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--space-1)' }}>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', fontWeight: 600 }}>
                    {percent}%
                  </span>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                    {j.last_activity ? formatTimeAgo(j.last_activity) : 'No activity'}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

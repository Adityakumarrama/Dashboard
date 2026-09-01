import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../../lib/api';
import { useToast } from '../../context/ToastContext';
import { formatDateTime } from '../../lib/utils';

export default function EvaluationDetail() {
  const { evaluationId } = useParams();
  const [evaluation, setEvaluation] = useState(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  useEffect(() => {
    api.get(`/evaluations/${evaluationId}`).then(data => {
      setEvaluation(data.evaluation);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [evaluationId]);

  const handleReopen = async () => {
    const reason = prompt('Reason for reopening this evaluation:');
    if (!reason) return;
    try {
      await api.post(`/evaluations/${evaluationId}/reopen`, { reason });
      toast.success('Evaluation reopened');
      // Refresh
      const data = await api.get(`/evaluations/${evaluationId}`);
      setEvaluation(data.evaluation);
    } catch (err) { toast.error(err.message); }
  };

  if (loading) return <div className="skeleton skeleton-card" style={{ height: 400 }} />;
  if (!evaluation) return <div className="empty-state"><div className="empty-state-title">Evaluation not found</div></div>;

  const totalMax = evaluation.scores?.reduce((s, sc) => s + sc.max_score, 0) || 100;

  return (
    <div>
      <div className="breadcrumbs" style={{ marginBottom: 'var(--space-4)' }}>
        <Link to="/admin/evaluations">Evaluations</Link>
        <span className="separator">/</span>
        <span className="current">{evaluation.team_code}</span>
      </div>

      <div className="eval-header">
        <div className="eval-team-code">{evaluation.team_code}</div>
        <div className="eval-team-name">{evaluation.team_name}</div>
        <div className="eval-team-details">
          <div><div className="eval-detail-label">Judge</div><div className="eval-detail-value">{evaluation.judge_name}</div></div>
          <div><div className="eval-detail-label">Status</div><div className="eval-detail-value"><span className={`badge ${evaluation.status === 'submitted' ? 'badge-success' : 'badge-warning'}`}>{evaluation.status}</span></div></div>
          <div><div className="eval-detail-label">Submitted</div><div className="eval-detail-value">{formatDateTime(evaluation.submitted_at)}</div></div>
        </div>
      </div>

      {/* Score Breakdown */}
      <div className="card">
        <h3 style={{ marginBottom: 'var(--space-4)' }}>Score Breakdown</h3>
        {evaluation.scores?.map(s => (
          <div key={s.criteria_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-3) 0', borderBottom: '1px solid var(--color-border-light)' }}>
            <div>
              <div style={{ fontWeight: 500 }}>{s.criteria_name}</div>
              {s.comment && <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginTop: 2 }}>{s.comment}</div>}
            </div>
            <div style={{ fontWeight: 700, fontSize: 'var(--text-lg)' }}>{s.score !== null ? s.score : '—'} <span style={{ color: 'var(--color-text-muted)', fontWeight: 400, fontSize: 'var(--text-sm)' }}>/ {s.max_score}</span></div>
          </div>
        ))}
      </div>

      {/* Total */}
      <div className="eval-total">
        <div className="eval-total-label">Total Score</div>
        <div className="eval-total-score">{evaluation.total_score || '—'} <span style={{ fontSize: 'var(--text-lg)', fontWeight: 400 }}>/ {totalMax}</span></div>
      </div>

      {/* Actions */}
      {evaluation.status === 'submitted' && (
        <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
          <button className="btn btn-secondary" onClick={handleReopen}>🔓 Reopen Evaluation</button>
        </div>
      )}
    </div>
  );
}

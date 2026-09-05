import { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../../lib/api';
import { useToast } from '../../context/ToastContext';
import { formatDateTime, getStatusClass } from '../../lib/utils';

export default function EvaluationDetail() {
  const { evaluationId } = useParams();
  const [evaluation, setEvaluation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editScores, setEditScores] = useState({});
  const [editComments, setEditComments] = useState({});
  const [overallComments, setOverallComments] = useState('');
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const fetchEvaluation = () => {
    return api.get(`/evaluations/${evaluationId}`).then(data => {
      setEvaluation(data.evaluation);
      setLoading(false);
      return data.evaluation;
    }).catch(err => {
      setLoading(false);
      toast.error(err.message || 'Failed to load evaluation');
    });
  };

  useEffect(() => {
    fetchEvaluation();
  }, [evaluationId]);

  const handleStartEdit = () => {
    if (!evaluation) return;
    const initialScores = {};
    const initialComments = {};
    (evaluation.scores || []).forEach(s => {
      const critId = s.criteria_id || s.criterion_id;
      initialScores[critId] = (s.score !== null && s.score !== undefined) ? Number(s.score) : '';
      initialComments[critId] = s.comment || '';
    });
    setEditScores(initialScores);
    setEditComments(initialComments);
    setOverallComments(evaluation.comments || '');
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
  };

  const handleScoreChange = (critId, val, maxScore) => {
    let numericVal = val === '' ? '' : Number(val);
    if (numericVal !== '' && numericVal > maxScore) numericVal = maxScore;
    if (numericVal !== '' && numericVal < 0) numericVal = 0;
    setEditScores(prev => ({ ...prev, [critId]: numericVal }));
  };

  const handleCommentChange = (critId, val) => {
    setEditComments(prev => ({ ...prev, [critId]: val }));
  };

  const liveTotalScore = useMemo(() => {
    return Object.values(editScores).reduce((acc, curr) => {
      return acc + (curr !== '' && !isNaN(curr) ? Number(curr) : 0);
    }, 0);
  }, [editScores]);

  const handleSaveScores = async () => {
    try {
      setSaving(true);
      const formattedScores = Object.entries(editScores).map(([critId, scVal]) => ({
        criteria_id: critId,
        criterion_id: critId,
        score: scVal === '' || scVal === null || scVal === undefined ? null : Number(scVal),
        comment: editComments[critId] || null,
      }));

      await api.put(`/evaluations/${evaluationId}`, {
        scores: formattedScores,
        comments: overallComments,
      });

      const wasReopened = evaluation.status === 'reopened';
      toast.success(wasReopened
        ? 'Scores updated and evaluation re-submitted successfully!'
        : 'Scores updated and recalculated successfully!');
      setIsEditing(false);
      await fetchEvaluation();
    } catch (err) {
      toast.error(err.message || 'Failed to save scores');
    } finally {
      setSaving(false);
    }
  };

  const handleReopen = async () => {
    const reason = prompt('Reason for reopening this evaluation:');
    if (!reason) return;
    try {
      await api.post(`/evaluations/${evaluationId}/reopen`, { reason });
      toast.success('Evaluation reopened successfully');
      await fetchEvaluation();
    } catch (err) {
      toast.error(err.message || 'Failed to reopen evaluation');
    }
  };

  if (loading) return <div className="skeleton skeleton-card" style={{ height: 400 }} />;
  if (!evaluation) return <div className="empty-state"><div className="empty-state-title">Evaluation not found</div></div>;

  const totalMax = evaluation.scores?.reduce((s, sc) => s + (Number(sc.max_score) || 0), 0) || 100;

  return (
    <div>
      <div className="breadcrumbs" style={{ marginBottom: 'var(--space-4)' }}>
        <Link to="/admin/evaluations">Evaluations</Link>
        <span className="separator">/</span>
        <span className="current">{evaluation.team_code}</span>
      </div>

      <div className="eval-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          <div>
            <div className="eval-team-code">{evaluation.team_code}</div>
            <div className="eval-team-name">{evaluation.team_name}</div>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            {!isEditing ? (
              <>
                <button className="btn btn-secondary btn-sm" onClick={handleStartEdit}>
                  ✏️ Edit Scores
                </button>
                {evaluation.status === 'submitted' && (
                  <button className="btn btn-ghost btn-sm" style={{ color: '#fff', border: '1px solid rgba(255,255,255,0.3)' }} onClick={handleReopen}>
                    🔓 Reopen Evaluation
                  </button>
                )}
                {evaluation.status === 'reopened' && (
                  <span className="badge badge-info" style={{ fontSize: 'var(--text-xs)', padding: '4px 10px' }}>🔓 Reopened — Edit & Save to re-submit</span>
                )}
              </>
            ) : (
              <>
                <button className="btn btn-ghost btn-sm" style={{ color: '#fff' }} onClick={handleCancelEdit} disabled={saving}>
                  ✖ Cancel
                </button>
                <button className="btn btn-primary btn-sm" onClick={handleSaveScores} disabled={saving}>
                  {saving ? 'Saving...' : '💾 Save Scores'}
                </button>
              </>
            )}
          </div>
        </div>

        <div className="eval-team-details">
          <div><div className="eval-detail-label">Judge</div><div className="eval-detail-value">{evaluation.judge_name || 'N/A'}</div></div>
          <div><div className="eval-detail-label">Status</div><div className="eval-detail-value"><span className={`badge ${getStatusClass(evaluation.status)}`}>{evaluation.status?.toUpperCase()}</span></div></div>
          <div><div className="eval-detail-label">Submitted</div><div className="eval-detail-value">{evaluation.submitted_at ? formatDateTime(evaluation.submitted_at) : 'Not Submitted'}</div></div>
        </div>
      </div>

      {/* Score Breakdown */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
          <h3 style={{ margin: 0 }}>Score Breakdown</h3>
          {isEditing && (
            <span className="tag" style={{ background: 'var(--color-accent-light)', color: 'var(--color-accent)' }}>
              Editing Mode Active
            </span>
          )}
        </div>

        {evaluation.scores?.map((s) => {
          const critId = s.criteria_id || s.criterion_id;
          const max = Number(s.max_score) || 20;

          if (isEditing) {
            return (
              <div key={critId} style={{ padding: 'var(--space-4) 0', borderBottom: '1px solid var(--color-border-light)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
                  <div>
                    <strong style={{ fontSize: 'var(--text-base)' }}>{s.criteria_name}</strong>
                    {s.criteria_description && (
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 2 }}>
                        {s.criteria_description}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <input
                      type="number"
                      className="input"
                      style={{ width: 90, textAlign: 'right', fontWeight: 'bold', fontSize: 'var(--text-base)' }}
                      min={0}
                      max={max}
                      step="0.5"
                      value={editScores[critId] ?? ''}
                      onChange={(e) => handleScoreChange(critId, e.target.value, max)}
                      placeholder="0"
                    />
                    <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>/ {max}</span>
                  </div>
                </div>
                <input
                  type="text"
                  className="input input-sm"
                  style={{ width: '100%', marginTop: 'var(--space-2)' }}
                  placeholder="Judge comment (optional)"
                  value={editComments[critId] || ''}
                  onChange={(e) => handleCommentChange(critId, e.target.value)}
                />
              </div>
            );
          }

          const displayScore = (s.score !== null && s.score !== undefined) ? s.score : '—';

          return (
            <div key={critId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-3) 0', borderBottom: '1px solid var(--color-border-light)' }}>
              <div>
                <div style={{ fontWeight: 500 }}>{s.criteria_name}</div>
                {s.comment && <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginTop: 2 }}>💬 {s.comment}</div>}
              </div>
              <div style={{ fontWeight: 700, fontSize: 'var(--text-lg)' }}>
                {displayScore} <span style={{ color: 'var(--color-text-muted)', fontWeight: 400, fontSize: 'var(--text-sm)' }}>/ {max}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Total Score */}
      <div className="eval-total" style={{ marginTop: 'var(--space-4)' }}>
        <div className="eval-total-label">{isEditing ? 'Live Calculated Total' : 'Total Score'}</div>
        <div className="eval-total-score">
          {isEditing ? (
            liveTotalScore
          ) : (
            evaluation.total_score !== null && evaluation.total_score !== undefined ? evaluation.total_score : '—'
          )}{' '}
          <span style={{ fontSize: 'var(--text-lg)', fontWeight: 400 }}>/ {totalMax}</span>
        </div>
      </div>

      {/* Overall Comments */}
      <div className="card" style={{ marginTop: 'var(--space-4)' }}>
        <h4 style={{ marginBottom: 'var(--space-2)' }}>Judge Overall Comments</h4>
        {isEditing ? (
          <textarea
            className="input"
            rows={3}
            style={{ width: '100%', resize: 'vertical' }}
            placeholder="Overall remarks or summary from judge..."
            value={overallComments}
            onChange={(e) => setOverallComments(e.target.value)}
          />
        ) : (
          <div style={{ color: evaluation.comments ? 'var(--color-text-primary)' : 'var(--color-text-muted)', fontStyle: evaluation.comments ? 'normal' : 'italic' }}>
            {evaluation.comments || 'No overall remarks provided.'}
          </div>
        )}
      </div>

      {/* Save Button for editing at bottom */}
      {isEditing && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
          <button className="btn btn-ghost" onClick={handleCancelEdit} disabled={saving}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSaveScores} disabled={saving}>
            {saving ? 'Saving...' : '💾 Save Scores'}
          </button>
        </div>
      )}
    </div>
  );
}

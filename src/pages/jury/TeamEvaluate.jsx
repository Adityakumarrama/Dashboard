import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../../lib/api';
import { useToast } from '../../context/ToastContext';
import { useAutosave } from '../../hooks/useAutosave';
import { getStatusClass } from '../../lib/utils';

export default function JuryTeamEvaluate() {
  const { teamCode } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [team, setTeam] = useState(null);
  const [evaluation, setEvaluation] = useState(null);
  const [scores, setScores] = useState({}); // { [criteria_id]: score_number }
  const [comments, setComments] = useState({}); // { [criteria_id]: comment_str }
  const [overallComments, setOverallComments] = useState('');
  const [criteriaList, setCriteriaList] = useState([]);
  const [showRoster, setShowRoster] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Fetch team & existing draft/submitted evaluation
  const loadData = async () => {
    try {
      setLoading(true);
      // 1. Lookup team
      const lookupRes = await api.get(`/teams/lookup/${teamCode}`);
      const teamData = lookupRes.team;
      setTeam(teamData);

      // 2. Get active criteria
      const critRes = await api.get('/scoring', { active_only: 'true' });
      setCriteriaList(critRes.criteria || []);

      // 3. Get or initialize draft evaluation
      const evalRes = await api.post('/evaluations', { team_id: teamData.id });
      const currentEval = evalRes.evaluation;
      setEvaluation(currentEval);
      setOverallComments(currentEval.comments || '');

      // Populate scores map
      const initialScores = {};
      const initialComments = {};
      (currentEval.scores || []).forEach(s => {
        initialScores[s.criteria_id] = s.score !== null ? Number(s.score) : '';
        initialComments[s.criteria_id] = s.comment || '';
      });
      setScores(initialScores);
      setComments(initialComments);
    } catch (err) {
      toast.error(err.message || 'Failed to load evaluation');
      navigate('/jury/teams');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [teamCode]);

  // Save draft logic for autosave and manual save
  const saveDraftPayload = useCallback(async (currentData) => {
    if (!evaluation || evaluation.status === 'submitted') return;

    const formattedScores = Object.entries(currentData.scores).map(([critId, scVal]) => ({
      criteria_id: critId,
      criterion_id: critId,
      score: scVal === '' || scVal === null || scVal === undefined ? null : Number(scVal),
      comment: currentData.comments[critId] || null,
    }));

    const res = await api.put(`/evaluations/${evaluation.id}`, {
      scores: formattedScores,
      comments: currentData.overallComments,
    });

    if (res.evaluation) {
      setEvaluation(res.evaluation);
    }
    return res;
  }, [evaluation]);

  const autosaveData = { scores, comments, overallComments };
  const isSubmitted = evaluation?.status === 'submitted';

  const { saveStatus, statusText, forceSave } = useAutosave(
    saveDraftPayload,
    autosaveData,
    15000,
    !isSubmitted && !loading
  );

  const handleScoreChange = (criteriaId, val, maxScore) => {
    if (isSubmitted) return;
    let numericVal = val === '' ? '' : Number(val);
    if (numericVal !== '' && numericVal > maxScore) numericVal = maxScore;
    if (numericVal !== '' && numericVal < 0) numericVal = 0;

    setScores(prev => ({ ...prev, [criteriaId]: numericVal }));
  };

  const handleCommentChange = (criteriaId, val) => {
    if (isSubmitted) return;
    setComments(prev => ({ ...prev, [criteriaId]: val }));
  };

  const calculateTotal = () => {
    return Object.values(scores).reduce((acc, curr) => {
      return acc + (curr !== '' && !isNaN(curr) ? Number(curr) : 0);
    }, 0);
  };

  const totalMax = criteriaList.reduce((acc, c) => acc + c.max_score, 0);

  const handleSubmit = async () => {
    // Check if all criteria are filled
    const missing = criteriaList.filter(c => scores[c.id] === '' || scores[c.id] === null || scores[c.id] === undefined);
    if (missing.length > 0) {
      toast.error(`Please score all criteria before submitting. Missing: ${missing.map(m => m.name).join(', ')}`);
      return;
    }

    if (!confirm(`Are you sure you want to submit official evaluation for ${team.team_code}?\n\nTotal Score: ${calculateTotal()}/${totalMax}\n\nOnce submitted, scores cannot be edited.`)) {
      return;
    }

    try {
      setSubmitting(true);
      const formattedScores = Object.entries(scores).map(([critId, scVal]) => ({
        criteria_id: critId,
        criterion_id: critId,
        score: Number(scVal),
        comment: comments[critId] || null,
      }));

      await api.post(`/evaluations/${evaluation.id}/submit`, {
        scores: formattedScores,
        comments: overallComments,
      });

      toast.success('Evaluation submitted successfully!');
      navigate('/jury/teams');
    } catch (err) {
      toast.error(err.message || 'Failed to submit evaluation');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="skeleton skeleton-card" style={{ height: 400 }} />;
  if (!team) return <div className="empty-state"><div className="empty-state-title">Team not found</div></div>;

  const members = Array.isArray(team.team_members) ? team.team_members : [];

  return (
    <div>
      <div className="breadcrumbs" style={{ marginBottom: 'var(--space-4)' }}>
        <Link to="/jury/teams">My Teams</Link>
        <span className="separator">/</span>
        <span className="current">{team?.team_code}</span>
      </div>

      {/* Team Header */}
      <div className="eval-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div className="eval-team-code">{team?.team_code}</div>
            <div className="eval-team-name">{team?.team_name}</div>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            <button
              className="btn btn-ghost btn-sm"
              style={{ color: '#fff', border: '1px solid rgba(255,255,255,0.3)' }}
              onClick={() => setShowRoster(!showRoster)}
            >
              👥 {showRoster ? 'Hide Roster' : 'View Roster'}
            </button>
            <span className={`badge ${getStatusClass(evaluation?.status)}`} style={{ fontSize: 'var(--text-sm)', padding: '4px 12px' }}>
              {evaluation?.status?.toUpperCase()}
            </span>
          </div>
        </div>

        <div className="eval-team-details">
          <div>
            <div className="eval-detail-label">Problem Statement</div>
            <div className="eval-detail-value">
              {team?.problem_statement_id && <span className="tag" style={{ marginRight: 4 }}>{team.problem_statement_id}</span>}
              {team?.problem_statement_title || 'N/A'}
            </div>
          </div>
          <div>
            <div className="eval-detail-label">Department & Course</div>
            <div className="eval-detail-value">{team?.department || team?.track || 'N/A'} {team?.course ? `(${team.course})` : ''}</div>
          </div>
          <div>
            <div className="eval-detail-label">Team Leader</div>
            <div className="eval-detail-value">
              {team?.team_leader || 'N/A'}
              {team?.leader_enrollment && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginLeft: 6 }}>({team.leader_enrollment})</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Toggleable Team Roster for Jury Verification */}
      {showRoster && (
        <div className="card" style={{ marginBottom: 'var(--space-6)', border: '1.5px solid var(--color-accent-light)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
            <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <span>👥</span> Student Roster for Identity Verification
            </h4>
            <span className="tag">{members.length + 1} Total Members</span>
          </div>

          <div style={{ padding: 'var(--space-3)', background: 'var(--color-bg-surface-alt)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-3)' }}>
            <strong>👑 Team Leader:</strong> {team?.team_leader || 'N/A'} |
            <span style={{ marginLeft: 6 }}>Enrollment: <strong style={{ fontFamily: 'var(--font-mono)' }}>{team?.leader_enrollment || '—'}</strong></span> |
            <span style={{ marginLeft: 6 }}>Email: <strong>{team?.leader_email || '—'}</strong></span>
          </div>

          <div className="roster-grid">
            {members.map((m, idx) => {
              const isGirl = !!m.is_girl_member || m.member_number === 1;
              return (
                <div key={idx} className={`roster-card ${isGirl ? 'girl-member' : ''}`} style={{ padding: 'var(--space-3)' }}>
                  <div className="roster-card-header" style={{ marginBottom: 4, paddingBottom: 4 }}>
                    <span className="roster-card-title">Member {m.member_number || idx + 1}</span>
                    {isGirl ? (
                      <span className="badge-girl">👩 Girl Member</span>
                    ) : (
                      <span className="tag" style={{ fontSize: 10 }}>{m.gender || 'Member'}</span>
                    )}
                  </div>
                  <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{m.name || '—'}</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 2 }}>
                    Enrollment: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-primary)' }}>{m.enrollment_number || '—'}</span>
                  </div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                    Dept: {m.department || '—'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Scoring Form */}
      <div className="card" style={{ marginBottom: 'var(--space-6)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-6)' }}>
          <h3 className="card-title">Rubric Criteria Scoring</h3>
          {!isSubmitted && (
            <div className={`autosave-indicator ${saveStatus}`}>
              <span className="autosave-dot" />
              <span>{statusText}</span>
            </div>
          )}
        </div>

        {criteriaList.map((crit, idx) => {
          const currentScore = scores[crit.id] !== undefined && scores[crit.id] !== '' ? scores[crit.id] : 0;
          return (
            <div key={crit.id} className="score-input-group" style={{ paddingBottom: 'var(--space-6)', borderBottom: idx < criteriaList.length - 1 ? '1px solid var(--color-border-light)' : 'none' }}>
              <div className="score-input-header">
                <div>
                  <span className="score-input-name">{crit.name}</span>
                  {crit.weight && crit.weight !== 1 && (
                    <span className="tag" style={{ marginLeft: 'var(--space-2)' }}>Weight: {crit.weight}x</span>
                  )}
                </div>
                <div className="score-input-max">Max: {crit.max_score} pts</div>
              </div>

              {crit.description && (
                <div className="score-input-desc">{crit.description}</div>
              )}

              <div className="score-slider-row">
                <input
                  type="range"
                  min="0"
                  max={crit.max_score}
                  step="1"
                  value={currentScore}
                  disabled={isSubmitted}
                  onChange={e => handleScoreChange(crit.id, e.target.value, crit.max_score)}
                  className="score-slider"
                />
                <input
                  type="number"
                  min="0"
                  max={crit.max_score}
                  value={scores[crit.id] !== undefined ? scores[crit.id] : ''}
                  disabled={isSubmitted}
                  placeholder="0"
                  onChange={e => handleScoreChange(crit.id, e.target.value, crit.max_score)}
                  className="score-number-input"
                />
              </div>

              <div style={{ marginTop: 'var(--space-3)' }}>
                <input
                  type="text"
                  className="input"
                  placeholder={`Feedback for ${crit.name} (optional)...`}
                  value={comments[crit.id] || ''}
                  disabled={isSubmitted}
                  onChange={e => handleCommentChange(crit.id, e.target.value)}
                />
              </div>
            </div>
          );
        })}

        <div className="form-group" style={{ marginTop: 'var(--space-6)' }}>
          <label className="form-label">Overall Evaluation Comments</label>
          <textarea
            className="textarea"
            placeholder="General remarks, strengths, or suggestions for the team..."
            value={overallComments}
            disabled={isSubmitted}
            onChange={e => setOverallComments(e.target.value)}
            rows={4}
          />
        </div>
      </div>

      {/* Live Total Banner */}
      <div className="eval-total">
        <div>
          <div className="eval-total-label">
            {isSubmitted ? 'Official Total Score' : 'Score Preview'}
          </div>
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', marginTop: 4 }}>
            {isSubmitted
              ? 'Authoritative score calculated and locked by PostgreSQL'
              : 'Temporary UI preview — official score calculated by PostgreSQL upon save'}
          </div>
        </div>
        <div className="eval-total-score">
          {isSubmitted && evaluation?.total_score !== null
            ? Number(evaluation.total_score).toFixed(0)
            : calculateTotal()} <span style={{ fontSize: 'var(--text-lg)', fontWeight: 400, opacity: 0.7 }}>/ {totalMax}</span>
        </div>
      </div>

      {/* Sticky Bar / Actions */}
      <div className="sticky-bar">
        <button className="btn btn-secondary" onClick={() => navigate('/jury/teams')}>
          ← Back to Teams
        </button>

        {!isSubmitted ? (
          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <button
              className="btn btn-secondary"
              onClick={() => forceSave().then(() => toast.info('Draft saved'))}
            >
              💾 Save Draft
            </button>
            <button
              className="btn btn-success btn-lg"
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? 'Submitting...' : '✓ Submit Final Score'}
            </button>
          </div>
        ) : (
          <div style={{ color: 'var(--color-success)', fontWeight: 600 }}>
            ✓ Submitted & Locked
          </div>
        )}
      </div>
    </div>
  );
}

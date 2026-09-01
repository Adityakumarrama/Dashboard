import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { formatDateTime, truncate } from '../../lib/utils';

export default function JuryCompletedEvals() {
  const [evaluations, setEvaluations] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/evaluations', { status: 'submitted' })
      .then(data => {
        setEvaluations(data.evaluations || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Completed Evaluations</h1>
          <p className="page-subtitle">Historical records of your submitted scores</p>
        </div>
      </div>

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Team Code</th>
              <th>Team Name</th>
              <th>Organization</th>
              <th>Category</th>
              <th>Total Score</th>
              <th>Submitted At</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(3)].map((_, i) => (
                <tr key={i}><td colSpan="7"><div className="skeleton skeleton-text" /></td></tr>
              ))
            ) : evaluations.length === 0 ? (
              <tr>
                <td colSpan="7" className="empty-state">
                  <div className="empty-state-icon">✅</div>
                  <div className="empty-state-title">No completed evaluations yet</div>
                  <div className="empty-state-text">Scores you submit will appear here permanently.</div>
                </td>
              </tr>
            ) : (
              evaluations.map(ev => (
                <tr key={ev.id}>
                  <td>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--color-accent)' }}>
                      {ev.team_code}
                    </span>
                  </td>
                  <td><strong>{ev.team_name}</strong></td>
                  <td style={{ fontSize: 'var(--text-sm)' }}>{truncate(ev.organization, 25)}</td>
                  <td><span className="tag">{ev.category || '—'}</span></td>
                  <td>
                    <span className="badge badge-success" style={{ fontSize: 'var(--text-sm)' }}>
                      {ev.total_score} pts
                    </span>
                  </td>
                  <td style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
                    {formatDateTime(ev.submitted_at)}
                  </td>
                  <td>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => navigate(`/jury/team/${ev.team_code}/evaluate`)}
                    >
                      View Details
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api';
import { useToast } from '../../context/ToastContext';

export default function AdminLeaderboard() {
  const [leaderboard, setLeaderboard] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [track, setTrack] = useState('');
  const [page, setPage] = useState(1);
  const toast = useToast();

  const fetchLeaderboard = async () => {
    setLoading(true);
    try {
      const data = await api.get('/evaluations/leaderboard', {
        page,
        limit: 25,
        search,
        category,
        track,
      });
      setLeaderboard(data.leaderboard || []);
      setPagination(data.pagination || null);
    } catch (err) {
      toast.error(err.message || 'Failed to fetch leaderboard');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeaderboard();
  }, [page, search, category, track]);

  const getRankBadge = (rank) => {
    if (rank === 1) return <span style={{ fontSize: '1.25rem' }}>🥇</span>;
    if (rank === 2) return <span style={{ fontSize: '1.25rem' }}>🥈</span>;
    if (rank === 3) return <span style={{ fontSize: '1.25rem' }}>🥉</span>;
    return <span style={{ fontWeight: 700, color: 'var(--color-text-secondary)' }}>#{rank}</span>;
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">🏆 Leaderboard</h1>
          <p className="page-subtitle">
            Authoritative rankings and aggregate scores computed directly by PostgreSQL
          </p>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary" onClick={fetchLeaderboard}>
            🔄 Refresh
          </button>
        </div>
      </div>

      {/* Filters Toolbar */}
      <div className="toolbar" style={{ flexWrap: 'wrap', gap: 'var(--space-3)' }}>
        <div className="search-container" style={{ flex: 1, minWidth: 260 }}>
          <span className="search-icon">🔍</span>
          <input
            className="input"
            placeholder="Search by code, team name, organization..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>

        <select
          className="select"
          style={{ width: 180 }}
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All Categories</option>
          <option value="Software">Software</option>
          <option value="Hardware">Hardware</option>
        </select>

        <select
          className="select"
          style={{ width: 180 }}
          value={track}
          onChange={(e) => {
            setTrack(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All Tracks</option>
          <option value="Smart Automation">Smart Automation</option>
          <option value="Clean & Green Tech">Clean & Green Tech</option>
          <option value="Healthcare">Healthcare</option>
          <option value="Cyber Security">Cyber Security</option>
          <option value="Disaster Management">Disaster Management</option>
        </select>
      </div>

      {/* Leaderboard Table */}
      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 70, textAlign: 'center' }}>Rank</th>
              <th>Team Code</th>
              <th>Team Name</th>
              <th>Category / Track</th>
              <th style={{ textAlign: 'center' }}>Judges Completed</th>
              <th style={{ textAlign: 'right' }}>Aggregate Score</th>
              <th style={{ textAlign: 'right' }}>Weighted Score</th>
              <th style={{ textAlign: 'right' }}>High / Low</th>
              <th style={{ textAlign: 'center' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(6)].map((_, i) => (
                <tr key={i}>
                  <td colSpan="9">
                    <div className="skeleton skeleton-text" />
                  </td>
                </tr>
              ))
            ) : leaderboard.length === 0 ? (
              <tr>
                <td colSpan="9" className="empty-state">
                  <div className="empty-state-icon">🏆</div>
                  <div className="empty-state-title">No evaluated teams found</div>
                  <div className="empty-state-text">
                    Teams will appear here as jury members submit their official evaluations.
                  </div>
                </td>
              </tr>
            ) : (
              leaderboard.map((item) => (
                <tr key={item.team_id}>
                  <td style={{ textAlign: 'center' }}>{getRankBadge(item.overall_rank)}</td>
                  <td>
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--color-accent)',
                        fontWeight: 600,
                      }}
                    >
                      {item.team_code}
                    </span>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{item.team_name}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                      {item.organization || '—'}
                    </div>
                  </td>
                  <td>
                    <span className="badge badge-neutral">
                      {item.category || 'General'}
                    </span>
                    {item.track && (
                      <span
                        style={{
                          fontSize: 'var(--text-xs)',
                          color: 'var(--color-text-secondary)',
                          marginLeft: 6,
                        }}
                      >
                        {item.track}
                      </span>
                    )}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <span
                      className={`badge ${
                        Number(item.completed_judges) > 0 ? 'badge-success' : 'badge-warning'
                      }`}
                    >
                      {item.completed_judges} / {item.assigned_judges || 0}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <span
                      style={{
                        fontSize: 'var(--text-base)',
                        fontWeight: 700,
                        color:
                          item.aggregate_score !== null
                            ? 'var(--color-success)'
                            : 'var(--color-text-muted)',
                      }}
                    >
                      {item.aggregate_score !== null ? Number(item.aggregate_score).toFixed(2) : '—'}
                    </span>
                  </td>
                  <td
                    style={{
                      textAlign: 'right',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    {item.weighted_aggregate_score !== null
                      ? Number(item.weighted_aggregate_score).toFixed(2)
                      : '—'}
                  </td>
                  <td
                    style={{
                      textAlign: 'right',
                      fontSize: 'var(--text-xs)',
                      color: 'var(--color-text-muted)',
                    }}
                  >
                    {item.highest_score !== null ? `${item.highest_score} / ${item.lowest_score}` : '—'}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <Link to={`/admin/teams/${item.team_id}`} className="btn btn-ghost btn-sm">
                      Details →
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pagination && pagination.totalPages > 1 && (
        <div className="pagination">
          <span>{pagination.total} total teams ranked</span>
          <div className="pagination-buttons">
            <button
              className="pagination-btn"
              disabled={!pagination.hasPrev}
              onClick={() => setPage((p) => p - 1)}
            >
              ← Prev
            </button>
            <button
              className="pagination-btn"
              disabled={!pagination.hasNext}
              onClick={() => setPage((p) => p + 1)}
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

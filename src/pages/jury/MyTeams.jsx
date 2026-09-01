import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { getStatusClass, truncate } from '../../lib/utils';

export default function JuryMyTeams() {
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/stats/jury')
      .then(data => {
        setTeams(data.teams || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const filteredTeams = teams.filter(team => {
    const matchesSearch = search === '' ||
      team.team_code.toLowerCase().includes(search.toLowerCase()) ||
      team.team_name.toLowerCase().includes(search.toLowerCase()) ||
      (team.organization && team.organization.toLowerCase().includes(search.toLowerCase()));

    const matchesStatus = statusFilter === '' || team.eval_status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">My Assigned Teams</h1>
          <p className="page-subtitle">Teams assigned to you for judging</p>
        </div>
      </div>

      <div className="toolbar">
        <div className="search-container" style={{ flex: 1, maxWidth: 400 }}>
          <span className="search-icon">🔍</span>
          <input
            className="input"
            placeholder="Search assigned teams..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select
          className="select"
          style={{ width: 180 }}
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
        >
          <option value="">All Statuses</option>
          <option value="not_started">Not Started</option>
          <option value="draft">Draft (In Progress)</option>
          <option value="submitted">Submitted</option>
        </select>
      </div>

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Team Code</th>
              <th>Team Name</th>
              <th>Problem Statement</th>
              <th>Organization</th>
              <th>Category</th>
              <th>Evaluation Status</th>
              <th>Score</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(5)].map((_, i) => (
                <tr key={i}><td colSpan="8"><div className="skeleton skeleton-text" /></td></tr>
              ))
            ) : filteredTeams.length === 0 ? (
              <tr>
                <td colSpan="8" className="empty-state">
                  <div className="empty-state-icon">👥</div>
                  <div className="empty-state-title">No matching teams</div>
                  <div className="empty-state-text">Try adjusting your search or filters.</div>
                </td>
              </tr>
            ) : (
              filteredTeams.map(team => (
                <tr key={team.id}>
                  <td>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--color-accent)' }}>
                      {team.team_code}
                    </span>
                  </td>
                  <td><strong>{team.team_name}</strong></td>
                  <td style={{ fontSize: 'var(--text-sm)' }}>
                    {team.problem_statement_id && <span className="tag" style={{ marginRight: 4 }}>{team.problem_statement_id}</span>}
                    {truncate(team.problem_statement_title, 25)}
                  </td>
                  <td style={{ fontSize: 'var(--text-sm)' }}>{truncate(team.organization, 25)}</td>
                  <td><span className="tag">{team.category || '—'}</span></td>
                  <td>
                    <span className={`badge ${getStatusClass(team.eval_status)}`}>
                      {team.eval_status === 'not_started' ? 'Not Started' : team.eval_status}
                    </span>
                  </td>
                  <td><strong>{team.total_score !== null && team.total_score !== undefined ? team.total_score : '—'}</strong></td>
                  <td>
                    <button
                      className={`btn btn-sm ${team.eval_status === 'submitted' ? 'btn-secondary' : 'btn-primary'}`}
                      onClick={() => navigate(`/jury/team/${team.team_code}/evaluate`)}
                    >
                      {team.eval_status === 'submitted' ? 'View' : team.eval_status === 'draft' ? 'Resume' : 'Score'}
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

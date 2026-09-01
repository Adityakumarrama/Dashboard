import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { useToast } from '../../context/ToastContext';

export default function JurySearchTeam() {
  const [teamCode, setTeamCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [searchedTeam, setSearchedTeam] = useState(null);
  const navigate = useNavigate();
  const toast = useToast();

  const handleSearch = async (e) => {
    e.preventDefault();
    const code = teamCode.trim().toUpperCase();
    if (!code) return;

    setLoading(true);
    setSearchedTeam(null);
    try {
      const data = await api.get(`/teams/lookup/${code}`);
      setSearchedTeam(data.team);
    } catch (err) {
      if (err.status === 403) {
        toast.error('This team is not assigned to you for evaluation.');
      } else if (err.status === 404) {
        toast.error('Team not found. Please verify the code.');
      } else {
        toast.error(err.message || 'Lookup failed');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="search-hero">
        <h2>⚡ Fast Team Lookup</h2>
        <p>Enter a team's code to immediately jump into scoring</p>

        <form onSubmit={handleSearch} className="search-input-wrapper">
          <input
            type="text"
            className="input"
            placeholder="e.g. SIH2026-001"
            value={teamCode}
            onChange={e => setTeamCode(e.target.value)}
            autoFocus
          />
          <button type="submit" className="btn btn-primary btn-lg" disabled={loading}>
            {loading ? 'Searching...' : 'Lookup'}
          </button>
        </form>
      </div>

      {searchedTeam && (
        <div className="card" style={{ maxWidth: 600, margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <span className="team-card-code">{searchedTeam.team_code}</span>
              <h3 style={{ marginTop: 'var(--space-1)' }}>{searchedTeam.team_name}</h3>
            </div>
            <span className="tag">{searchedTeam.category || 'General'}</span>
          </div>

          <div style={{ margin: 'var(--space-4) 0', fontSize: 'var(--text-sm)' }}>
            <div style={{ marginBottom: 'var(--space-2)' }}>
              <strong>Problem:</strong> {searchedTeam.problem_statement_title || 'N/A'}
            </div>
            <div style={{ marginBottom: 'var(--space-2)' }}>
              <strong>Organization:</strong> {searchedTeam.organization || 'N/A'}
            </div>
            <div>
              <strong>Leader:</strong> {searchedTeam.team_leader || 'N/A'}
            </div>
          </div>

          <button
            className="btn btn-primary btn-block btn-lg"
            onClick={() => navigate(`/jury/team/${searchedTeam.team_code}/evaluate`)}
          >
            Start / Continue Evaluation →
          </button>
        </div>
      )}
    </div>
  );
}

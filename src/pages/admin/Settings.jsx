import { useState, useEffect } from 'react';
import api from '../../lib/api';
import { useToast } from '../../context/ToastContext';

export default function AdminSettings() {
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    api.get('/settings').then(data => { setSettings(data.settings || {}); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const data = await api.put('/settings', { settings });
      setSettings(data.settings);
      toast.success('Settings saved');
    } catch (err) { toast.error(err.message); }
    setSaving(false);
  };

  const update = (key, value) => setSettings(prev => ({ ...prev, [key]: value }));

  const handleExport = async (type) => {
    try {
      await api.download(`/export/${type}`);
      toast.success(`${type} exported successfully`);
    } catch {
      toast.error('Export failed');
    }
  };

  if (loading) return <div className="skeleton skeleton-card" style={{ height: 400 }} />;

  return (
    <div>
      <div className="page-header">
        <div><h1 className="page-title">Settings</h1><p className="page-subtitle">Competition configuration</p></div>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : '💾 Save Settings'}</button>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">🏆 Competition Details</div>
        <div className="grid grid-2" style={{ gap: 'var(--space-4)' }}>
          <div className="form-group"><label className="form-label">Competition Name</label><input className="input" value={settings.competition_name || ''} onChange={e => update('competition_name', e.target.value)} /></div>
          <div className="form-group"><label className="form-label">Competition Year</label><input className="input" value={settings.competition_year || ''} onChange={e => update('competition_year', e.target.value)} /></div>
          <div className="form-group"><label className="form-label">Competition Status</label>
            <select className="select" value={settings.competition_status || 'active'} onChange={e => update('competition_status', e.target.value)}>
              <option value="active">Active</option><option value="paused">Paused</option><option value="completed">Completed</option>
            </select>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">📊 Scoring Settings</div>
        <div className="grid grid-2" style={{ gap: 'var(--space-4)' }}>
          <div className="form-group">
            <label className="form-label">Scoring Enabled</label>
            <select className="select" value={settings.scoring_enabled ? 'true' : 'false'} onChange={e => update('scoring_enabled', e.target.value === 'true')}>
              <option value="true">Yes</option><option value="false">No</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Score Editing After Submission</label>
            <select className="select" value={settings.score_editing_allowed ? 'true' : 'false'} onChange={e => update('score_editing_allowed', e.target.value === 'true')}>
              <option value="false">Not Allowed</option><option value="true">Allowed</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Evaluation Locking</label>
            <select className="select" value={settings.evaluation_locking ? 'true' : 'false'} onChange={e => update('evaluation_locking', e.target.value === 'true')}>
              <option value="true">Enabled</option><option value="false">Disabled</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Autosave Interval (seconds)</label>
            <input className="input" type="number" min="10" value={settings.autosave_interval || 30} onChange={e => update('autosave_interval', parseInt(e.target.value))} />
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">📥 Import Settings</div>
        <div className="form-group">
          <label className="form-label">Default Duplicate Strategy</label>
          <select className="select" style={{ maxWidth: 300 }} value={settings.import_duplicate_strategy || 'skip'} onChange={e => update('import_duplicate_strategy', e.target.value)}>
            <option value="skip">Skip duplicates</option><option value="update">Update existing</option><option value="replace">Replace existing</option>
          </select>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">📤 Data Export</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
          <button className="btn btn-secondary" onClick={() => handleExport('teams')}>📥 Teams CSV</button>
          <button className="btn btn-secondary" onClick={() => handleExport('users')}>📥 Users CSV</button>
          <button className="btn btn-secondary" onClick={() => handleExport('assignments')}>📥 Assignments CSV</button>
          <button className="btn btn-secondary" onClick={() => handleExport('evaluations')}>📥 Evaluations CSV</button>
          <button className="btn btn-secondary" onClick={() => handleExport('scores')}>📥 Score Details CSV</button>
          <button className="btn btn-secondary" onClick={() => handleExport('imports')}>📥 Import History CSV</button>
        </div>
      </div>
    </div>
  );
}

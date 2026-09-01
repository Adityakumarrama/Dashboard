import { useState, useEffect } from 'react';
import api from '../../lib/api';
import { useToast } from '../../context/ToastContext';

export default function ScoringCriteria() {
  const [criteria, setCriteria] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', description: '', max_score: 20, weight: 1.0, sort_order: 0 });
  const toast = useToast();

  const fetch = async () => {
    try { const data = await api.get('/scoring'); setCriteria(data.criteria); } catch {} setLoading(false);
  };
  useEffect(() => { fetch(); }, []);

  const totalMax = criteria.filter(c => c.is_active).reduce((s, c) => s + c.max_score, 0);

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      if (editing) { await api.put(`/scoring/${editing}`, form); toast.success('Criterion updated'); }
      else { await api.post('/scoring', form); toast.success('Criterion created'); }
      setShowForm(false); setEditing(null); setForm({ name: '', description: '', max_score: 20, weight: 1.0, sort_order: 0 }); fetch();
    } catch (err) { toast.error(err.message); }
  };

  const handleEdit = (c) => { setForm({ name: c.name, description: c.description || '', max_score: c.max_score, weight: c.weight, sort_order: c.sort_order }); setEditing(c.id); setShowForm(true); };

  const handleToggle = async (c) => {
    try { await api.put(`/scoring/${c.id}`, { is_active: !c.is_active }); toast.success(`Criterion ${c.is_active ? 'deactivated' : 'activated'}`); fetch(); }
    catch (err) { toast.error(err.message); }
  };

  const handleDelete = async (c) => {
    if (!confirm(`Delete criterion "${c.name}"?`)) return;
    try { await api.delete(`/scoring/${c.id}`); toast.success('Criterion deleted'); fetch(); }
    catch (err) { toast.error(err.message); }
  };

  return (
    <div>
      <div className="page-header">
        <div><h1 className="page-title">Scoring Criteria</h1><p className="page-subtitle">Total Maximum: {totalMax} points</p></div>
        <button className="btn btn-primary" onClick={() => { setEditing(null); setForm({ name: '', description: '', max_score: 20, weight: 1.0, sort_order: criteria.length }); setShowForm(true); }}>+ Add Criterion</button>
      </div>

      {/* Live Preview */}
      <div className="card" style={{ marginBottom: 'var(--space-6)' }}>
        <h4 style={{ marginBottom: 'var(--space-3)' }}>Scoring Rubric Preview</h4>
        {criteria.filter(c => c.is_active).map(c => (
          <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', padding: 'var(--space-2) 0', borderBottom: '1px solid var(--color-border-light)' }}>
            <span style={{ fontWeight: 500 }}>{c.name}</span>
            <span style={{ color: 'var(--color-text-muted)' }}>Max: {c.max_score} pts (Weight: {c.weight}x)</span>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: 'var(--space-3) 0', fontWeight: 700, borderTop: '2px solid var(--color-border)' }}>
          <span>TOTAL</span><span>{totalMax} Points</span>
        </div>
      </div>

      {/* Criteria Table */}
      <div className="table-container">
        <table className="table">
          <thead><tr><th>Order</th><th>Name</th><th>Description</th><th>Max Score</th><th>Weight</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan="7"><div className="skeleton skeleton-text" /></td></tr> :
            criteria.map(c => (
              <tr key={c.id} style={{ opacity: c.is_active ? 1 : 0.5 }}>
                <td>{c.sort_order}</td>
                <td><strong>{c.name}</strong></td>
                <td style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>{c.description || '—'}</td>
                <td><span className="badge badge-accent">{c.max_score}</span></td>
                <td>{c.weight}x</td>
                <td><span className={`badge ${c.is_active ? 'badge-success' : 'badge-muted'}`}>{c.is_active ? 'Active' : 'Inactive'}</span></td>
                <td>
                  <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => handleEdit(c)}>Edit</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => handleToggle(c)}>{c.is_active ? 'Disable' : 'Enable'}</button>
                    <button className="btn btn-ghost btn-sm" style={{ color: 'var(--color-error)' }} onClick={() => handleDelete(c)}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h3 className="modal-title">{editing ? 'Edit' : 'Add'} Criterion</h3><button className="modal-close" onClick={() => setShowForm(false)}>×</button></div>
            <form onSubmit={handleSave}>
              <div className="modal-body">
                <div className="form-group"><label className="form-label">Name *</label><input className="input" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required /></div>
                <div className="form-group"><label className="form-label">Description</label><textarea className="textarea" value={form.description} onChange={e => setForm({...form, description: e.target.value})} /></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-4)' }}>
                  <div className="form-group"><label className="form-label">Max Score *</label><input className="input" type="number" min="1" value={form.max_score} onChange={e => setForm({...form, max_score: parseInt(e.target.value)})} required /></div>
                  <div className="form-group"><label className="form-label">Weight</label><input className="input" type="number" min="0.1" step="0.1" value={form.weight} onChange={e => setForm({...form, weight: parseFloat(e.target.value)})} /></div>
                  <div className="form-group"><label className="form-label">Sort Order</label><input className="input" type="number" value={form.sort_order} onChange={e => setForm({...form, sort_order: parseInt(e.target.value)})} /></div>
                </div>
              </div>
              <div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button><button type="submit" className="btn btn-primary">Save</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

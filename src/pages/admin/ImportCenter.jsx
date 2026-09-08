import { useState, useEffect } from 'react';
import api from '../../lib/api';
import { useToast } from '../../context/ToastContext';
import { formatFileSize } from '../../lib/utils';

const STEPS = ['Upload', 'Analysis', 'Field Mapping', 'Validation', 'Preview', 'Confirm', 'Result'];

export default function ImportCenter() {
  const [step, setStep] = useState(0);
  const [file, setFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [importData, setImportData] = useState(null);
  const [mapping, setMapping] = useState({});
  const [dupStrategy, setDupStrategy] = useState('skip');
  const [assignmentStrategy, setAssignmentStrategy] = useState('auto_round_robin');
  const [selectedJuries, setSelectedJuries] = useState([]);
  const [activeJuries, setActiveJuries] = useState([]);
  const [previewTab, setPreviewTab] = useState('valid');
  const [result, setResult] = useState(null);
  const toast = useToast();

  useEffect(() => {
    api.get('/users', { role: 'JURY', limit: 100 })
      .then(data => setActiveJuries((data.users || []).filter(u => u.status === 'active')))
      .catch(() => {});
  }, []);

  const handleFile = (f) => {
    const ext = f.name.split('.').pop().toLowerCase();
    if (!['csv', 'tsv', 'txt', 'xml', 'pdf'].includes(ext)) {
      toast.error('Supported formats: CSV, TSV, TXT, XML, and PDF');
      return;
    }
    setFile(f);
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    try {
      const data = await api.upload('/import/upload', file);
      setImportData(data);
      setMapping(data.fieldMapping || {});
      setStep(1);
    } catch (err) { toast.error(err.message || 'Upload failed'); }
    setUploading(false);
  };

  const handleConfirm = async () => {
    if (assignmentStrategy === 'specific' && selectedJuries.length === 0) {
      toast.warning('Please select at least one jury member or choose another assignment option');
      return;
    }
    try {
      const recordsToSend = dupStrategy === 'skip'
        ? (importData.validRecords || [])
        : [...(importData.validRecords || []), ...(importData.duplicates || [])];

      const data = await api.post('/import/confirm', {
        records: recordsToSend,
        duplicateStrategy: dupStrategy,
        assignmentStrategy,
        selectedJuryIds: selectedJuries,
        fileName: file?.name,
        fileType: importData.file?.type,
      });
      setResult(data.results);
      setStep(6);
      toast.success('Import completed!');
    } catch (err) { toast.error(err.message); }
  };

  const toggleJury = (id) => {
    setSelectedJuries(prev => prev.includes(id) ? prev.filter(j => j !== id) : [...prev, id]);
  };

  const handleDownloadTemplate = (format) => { window.open(`/api/import/templates/${format}`, '_blank'); };

  return (
    <div>
      <div className="page-header">
        <div><h1 className="page-title">Import Center</h1><p className="page-subtitle">Import team data from Rama Google Forms (CSV/TSV), XML, or PDF</p></div>
      </div>

      {/* Steps */}
      <div className="steps">
        {STEPS.map((s, i) => (
          <div key={s}>
            {i > 0 && <span className="step-connector" style={{ display: 'inline-block', margin: '0 4px' }} />}
            <span className={`step ${i === step ? 'active' : i < step ? 'completed' : ''}`}>
              <span className="step-number">{i < step ? '✓' : i + 1}</span>
              <span>{s}</span>
            </span>
          </div>
        ))}
      </div>

      {/* Step 0: Upload */}
      {step === 0 && (
        <div>
          <div
            className={`upload-zone ${dragOver ? 'dragover' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); }}
            onClick={() => document.getElementById('file-input').click()}
          >
            <div className="upload-zone-icon">📂</div>
            <div className="upload-zone-text">
              {file ? file.name : 'Drag & Drop your Rama SIH Form Export here'}
            </div>
            <div className="upload-zone-hint">
              {file ? `${formatFileSize(file.size)} — ${file.name.split('.').pop().toUpperCase()}` : 'Supports CSV, TSV (Google Sheets/Form), TXT, XML, PDF (Max 10MB)'}
            </div>
            <input id="file-input" type="file" accept=".csv,.tsv,.txt,.xml,.pdf" style={{ display: 'none' }} onChange={e => e.target.files[0] && handleFile(e.target.files[0])} />
          </div>

          {file && (
            <div style={{ textAlign: 'center', marginTop: 'var(--space-4)' }}>
              <button className="btn btn-primary btn-lg" onClick={handleUpload} disabled={uploading}>
                {uploading ? 'Processing...' : '📤 Upload & Analyze'}
              </button>
            </div>
          )}

          <div className="import-templates" style={{ flexWrap: 'wrap' }}>
            <button className="btn btn-secondary btn-sm" onClick={() => handleDownloadTemplate('csv')}>📥 Download Rama SIH CSV Template</button>
            <button className="btn btn-secondary btn-sm" onClick={() => handleDownloadTemplate('tsv')}>📥 Download Rama SIH TSV Template</button>
            <button className="btn btn-ghost btn-sm" onClick={() => handleDownloadTemplate('xml')}>📥 Download XML Template</button>
          </div>
        </div>
      )}

      {/* Step 1: Analysis */}
      {step === 1 && importData && (
        <div className="card">
          <h3>File Analysis</h3>
          {importData.isRamaFormat && (
            <div style={{ marginTop: 'var(--space-4)', padding: 'var(--space-4)', background: 'rgba(79, 70, 229, 0.08)', border: '1.5px solid var(--color-accent-light)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontWeight: 600, color: 'var(--color-accent)' }}>
                <span>🎓</span> Rama University F.E.T Google Form Format Recognized!
              </div>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', marginTop: 4, marginBottom: 0 }}>
                All 34 columns (Submitter, Department, Course, Team Leader, and 5 Members with Girl Member auto-flagged) have been detected and structured.
              </p>
            </div>
          )}
          <div className="import-summary-grid" style={{ marginTop: 'var(--space-4)' }}>
            <div className="import-summary-item" style={{ background: 'var(--color-bg-surface-alt)' }}>
              <div className="import-summary-count">{importData.file?.name}</div>
              <div className="import-summary-label">File Name</div>
            </div>
            <div className="import-summary-item" style={{ background: 'var(--color-bg-surface-alt)' }}>
              <div className="import-summary-count">{importData.file?.type?.toUpperCase()}</div>
              <div className="import-summary-label">Format</div>
            </div>
            <div className="import-summary-item" style={{ background: 'var(--color-bg-surface-alt)' }}>
              <div className="import-summary-count">{importData.summary?.totalRecords}</div>
              <div className="import-summary-label">Records Detected</div>
            </div>
            <div className="import-summary-item" style={{ background: 'var(--color-bg-surface-alt)' }}>
              <div className="import-summary-count">{importData.detectedHeaders?.length}</div>
              <div className="import-summary-label">Fields</div>
            </div>
          </div>
          {importData.parseErrors?.length > 0 && (
            <div style={{ marginTop: 'var(--space-4)', padding: 'var(--space-3)', background: 'var(--color-error-light)', borderRadius: 'var(--radius-md)', color: 'var(--color-error-dark)' }}>
              {importData.parseErrors.map((e, i) => <div key={i}>{e.error}</div>)}
            </div>
          )}
          <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
            <button className="btn btn-secondary" onClick={() => { setStep(0); setFile(null); setImportData(null); }}>← Back</button>
            {importData.isRamaFormat ? (
              <button className="btn btn-primary" onClick={() => setStep(3)} disabled={importData.summary?.totalRecords === 0}>
                Continue to Validation & Preview →
              </button>
            ) : (
              <button className="btn btn-primary" onClick={() => setStep(2)} disabled={importData.summary?.totalRecords === 0}>
                Continue to Field Mapping →
              </button>
            )}
          </div>
        </div>
      )}

      {/* Step 2: Field Mapping */}
      {step === 2 && importData && (
        <div className="card">
          <h3>Field Mapping</h3>
          <p style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-4)' }}>Map detected fields to database fields</p>
          {importData.detectedHeaders?.map((header, idx) => {
            const fieldKey = header || `col_${idx}`;
            return (
              <div className="mapping-row" key={`${fieldKey}-${idx}`}>
                <div className="mapping-source">
                  {header ? header : <span style={{ color: 'var(--color-warning-dark)', fontStyle: 'italic' }}>Column {idx + 1} (No Header)</span>}
                </div>
                <div className="mapping-arrow">→</div>
                <div className="mapping-target">
                  <select className="select" value={mapping[fieldKey] || ''} onChange={e => setMapping({...mapping, [fieldKey]: e.target.value || null})}>
                    <option value="">— Skip —</option>
                    {importData.dbFields?.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
              </div>
            );
          })}
          <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
            <button className="btn btn-secondary" onClick={() => setStep(1)}>← Back</button>
            <button className="btn btn-primary" onClick={() => setStep(3)}>Continue to Validation →</button>
          </div>
        </div>
      )}

      {/* Step 3: Validation */}
      {step === 3 && importData && (
        <div className="card">
          <h3>Validation & Duplicity Results</h3>
          <div className="import-summary-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
            <div className="import-summary-item" style={{ background: 'var(--color-success-light)' }}>
              <div className="import-summary-count" style={{ color: 'var(--color-success-dark)' }}>{importData.summary?.validRecords}</div>
              <div className="import-summary-label">Clean & Valid</div>
            </div>
            <div className="import-summary-item" style={{ background: 'var(--color-warning-light)' }}>
              <div className="import-summary-count" style={{ color: 'var(--color-warning-dark)' }}>{importData.summary?.duplicates}</div>
              <div className="import-summary-label">Flagged Duplicates</div>
            </div>
            <div className="import-summary-item" style={{ background: 'rgba(245, 158, 11, 0.15)', border: '1px solid rgba(245, 158, 11, 0.4)' }}>
              <div className="import-summary-count" style={{ color: '#b45309' }}>{importData.summary?.enrollmentConflictsCount || 0}</div>
              <div className="import-summary-label">Enrollment Collisions</div>
            </div>
            <div className="import-summary-item" style={{ background: 'var(--color-error-light)' }}>
              <div className="import-summary-count" style={{ color: 'var(--color-error-dark)' }}>{importData.summary?.errors}</div>
              <div className="import-summary-label">Errors</div>
            </div>
            <div className="import-summary-item" style={{ background: 'var(--color-accent-light)' }}>
              <div className="import-summary-count" style={{ color: 'var(--color-accent-active)' }}>{importData.summary?.validRecords}</div>
              <div className="import-summary-label">Ready to Import</div>
            </div>
          </div>

          {/* DUPLICATE ENROLLMENT NUMBERS ALERT TABLE */}
          {importData.enrollmentConflicts?.length > 0 && (
            <div style={{ marginTop: 'var(--space-5)', padding: 'var(--space-4)', background: 'rgba(245, 158, 11, 0.08)', border: '1.5px solid #f59e0b', borderRadius: 'var(--radius-md)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontWeight: 700, color: '#b45309', fontSize: 'var(--text-md)' }}>
                  <span>⚠️</span> Duplicate Enrollment Numbers Flagged ({importData.enrollmentConflicts.length})
                </div>
                <span className="tag" style={{ background: '#fef3c7', color: '#92400e', fontWeight: 600, border: '1px solid #fcd34d' }}>
                  Student Collision Detected
                </span>
              </div>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-3)' }}>
                The following student enrollment numbers appear in multiple teams or are already registered in the system. Check where each enrollment exists below:
              </p>
              <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid rgba(245, 158, 11, 0.3)', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg-surface)' }}>
                <table className="table" style={{ fontSize: 'var(--text-xs)', margin: 0 }}>
                  <thead style={{ background: 'rgba(245, 158, 11, 0.1)' }}>
                    <tr>
                      <th style={{ color: '#92400e' }}>Enrollment No</th>
                      <th style={{ color: '#92400e' }}>Student Name & Role</th>
                      <th style={{ color: '#92400e' }}>Current Team (This File)</th>
                      <th style={{ color: '#92400e' }}>Where Else This Enrollment Is</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importData.enrollmentConflicts.map((c, i) => (
                      <tr key={i}>
                        <td style={{ verticalAlign: 'middle' }}>
                          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, background: '#fef3c7', padding: '3px 8px', borderRadius: 4, color: '#92400e', border: '1px solid #fcd34d', display: 'inline-block' }}>
                            {c.enrollmentNumber}
                          </span>
                        </td>
                        <td style={{ verticalAlign: 'middle' }}>
                          <strong>{c.currentStudent}</strong>
                          <div style={{ color: 'var(--color-text-muted)', fontSize: '11px' }}>{c.currentRole}</div>
                        </td>
                        <td style={{ verticalAlign: 'middle' }}>
                          <div>Row {c.currentRow}: <strong>{c.currentTeamName}</strong></div>
                          <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-accent)', fontSize: '11px' }}>{c.currentTeamCode}</div>
                        </td>
                        <td style={{ verticalAlign: 'middle' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                            <span className={`tag ${c.conflictSource === 'Database' ? 'tag-info' : c.conflictSource === 'Same Team' ? 'tag-error' : 'tag-warning'}`} style={{ fontSize: '10px', padding: '1px 6px' }}>
                              {c.conflictSource === 'Database' ? '🗄️ In Database' : c.conflictSource === 'Same Team' ? '👥 Same Team' : `📄 File Row ${c.conflictRow}`}
                            </span>
                            <strong>{c.conflictTeamName}</strong> {c.conflictTeamCode ? `(${c.conflictTeamCode})` : ''}
                          </div>
                          <div style={{ color: 'var(--color-text-secondary)', fontSize: '11px' }}>
                            Registered as: <strong>{c.conflictRole}</strong> ({c.conflictStudent})
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* FLAGGED DUPLICATES SUMMARY */}
          {importData.duplicates?.length > 0 && (
            <div style={{ marginTop: 'var(--space-4)', padding: 'var(--space-3)', background: 'var(--color-bg-surface-alt)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontWeight: 600, color: 'var(--color-warning-dark)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-2)' }}>
                📋 Flagged Duplicate Teams ({importData.duplicates.length})
              </div>
              <div style={{ maxHeight: 180, overflowY: 'auto' }}>
                {importData.duplicates.map((d, i) => (
                  <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid var(--color-border)', fontSize: 'var(--text-xs)', display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
                    <div>
                      <strong>Row {d._rowIndex}: {d.team_name}</strong> <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-accent)' }}>({d.team_code})</span>
                      <div style={{ color: 'var(--color-text-secondary)', marginTop: 2 }}>{d._reason}</div>
                    </div>
                    {d._hasEnrollmentConflict && (
                      <span className="tag tag-warning" style={{ alignSelf: 'flex-start', fontSize: '10px', whiteSpace: 'nowrap' }}>
                        Enrollment Conflict
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {importData.validationErrors?.length > 0 && (
            <div style={{ marginTop: 'var(--space-4)' }}>
              <h4>Validation Errors</h4>
              {importData.validationErrors.map((e, i) => (
                <div key={i} style={{ padding: 'var(--space-2)', fontSize: 'var(--text-sm)', color: 'var(--color-error-dark)' }}>
                  Row {e.row} — {e.field}: {e.error}
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
            <button className="btn btn-secondary" onClick={() => setStep(importData.isRamaFormat ? 1 : 2)}>← Back</button>
            <button className="btn btn-primary" onClick={() => setStep(4)}>Preview Records →</button>
          </div>
        </div>
      )}

      {/* Step 4: Preview */}
      {step === 4 && importData && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
            <h3>Preview Records</h3>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <button
                className={`btn btn-sm ${previewTab === 'valid' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setPreviewTab('valid')}
              >
                ✓ Clean Valid Teams ({importData.validRecords?.length || 0})
              </button>
              {importData.duplicates?.length > 0 && (
                <button
                  className={`btn btn-sm ${previewTab === 'duplicates' ? 'btn-warning' : 'btn-ghost'}`}
                  onClick={() => setPreviewTab('duplicates')}
                >
                  ⚠️ Flagged Duplicates ({importData.duplicates?.length || 0})
                </button>
              )}
            </div>
          </div>

          <div className="table-container" style={{ maxHeight: 400, overflow: 'auto', marginTop: 'var(--space-4)' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Team Code</th>
                  <th>Team Name</th>
                  <th>Department & Course</th>
                  <th>Team Leader</th>
                  <th>Members</th>
                </tr>
              </thead>
              <tbody>
                {((previewTab === 'valid' ? importData.validRecords : importData.duplicates) || []).slice(0, 50).map((r, i) => (
                  <tr key={i} style={r._hasEnrollmentConflict ? { background: 'rgba(245, 158, 11, 0.04)' } : {}}>
                    <td>{r._rowIndex}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-accent)', fontWeight: 600 }}>{r.team_code}</td>
                    <td>
                      <div>
                        <strong>{r.team_name}</strong>
                        {r._hasEnrollmentConflict && (
                          <span className="tag tag-warning" style={{ marginLeft: 6, fontSize: '10px', padding: '1px 5px' }} title={r._reason}>
                            ⚠️ Duplicate Enrollment
                          </span>
                        )}
                      </div>
                      {r._reason && previewTab === 'duplicates' && (
                        <div style={{ fontSize: '11px', color: 'var(--color-warning-dark)', marginTop: 2 }}>{r._reason}</div>
                      )}
                    </td>
                    <td>
                      <div>{r.department || r.track || '—'}</div>
                      {r.course && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{r.course}</div>}
                    </td>
                    <td>
                      <div>{r.team_leader || '—'}</div>
                      {r.leader_enrollment && (
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
                          Enrollment: <strong>{r.leader_enrollment}</strong>
                        </div>
                      )}
                    </td>
                    <td>
                      <span className="tag">
                        {Array.isArray(r.team_members) && r.team_members.length > 0 ? `${r.team_members.length} Members` : '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
            <button className="btn btn-secondary" onClick={() => setStep(3)}>← Back</button>
            <button className="btn btn-primary" onClick={() => setStep(5)}>Confirm Import →</button>
          </div>
        </div>
      )}

      {/* Step 5: Confirm */}
      {step === 5 && (
        <div className="card">
          <h3>Confirm Import</h3>
          <p style={{ marginBottom: 'var(--space-4)' }}>Ready to import <strong>{importData.validRecords?.length}</strong> teams.</p>
          
          <div className="form-group">
            <label className="form-label">Duplicate Handling Strategy</label>
            <select className="select" value={dupStrategy} onChange={e => setDupStrategy(e.target.value)}>
              <option value="skip">Skip duplicates (default)</option>
              <option value="update">Update existing teams</option>
              <option value="replace">Replace existing teams</option>
            </select>
          </div>

          <div className="form-group" style={{ marginTop: 'var(--space-5)' }}>
            <label className="form-label" style={{ fontSize: 'var(--text-md)', fontWeight: 600 }}>
              Jury Team Assignment Option
            </label>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 2, marginBottom: 'var(--space-3)' }}>
              Choose how to allocate these {importData.validRecords?.length} teams among active jury members ({activeJuries.length} active judges available).
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
              <div
                onClick={() => setAssignmentStrategy('auto_round_robin')}
                style={{
                  padding: 'var(--space-3)',
                  border: `2px solid ${assignmentStrategy === 'auto_round_robin' ? 'var(--color-primary)' : 'var(--color-border)'}`,
                  background: assignmentStrategy === 'auto_round_robin' ? 'rgba(79, 70, 229, 0.08)' : 'var(--color-bg-surface)',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontWeight: 600 }}>
                  <input type="radio" name="assignment" checked={assignmentStrategy === 'auto_round_robin'} onChange={() => setAssignmentStrategy('auto_round_robin')} />
                  <span>⚡ Auto-Assign (Round-Robin)</span>
                </div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', marginTop: 'var(--space-1)', paddingLeft: '22px' }}>
                  Distributes teams equally among {activeJuries.length} active judges (~{activeJuries.length > 0 ? Math.ceil((importData.validRecords?.length || 0) / activeJuries.length) : 0} teams/judge).
                </div>
              </div>

              <div
                onClick={() => setAssignmentStrategy('auto_all')}
                style={{
                  padding: 'var(--space-3)',
                  border: `2px solid ${assignmentStrategy === 'auto_all' ? 'var(--color-primary)' : 'var(--color-border)'}`,
                  background: assignmentStrategy === 'auto_all' ? 'rgba(79, 70, 229, 0.08)' : 'var(--color-bg-surface)',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontWeight: 600 }}>
                  <input type="radio" name="assignment" checked={assignmentStrategy === 'auto_all'} onChange={() => setAssignmentStrategy('auto_all')} />
                  <span>👥 Auto-Assign (Full Panel)</span>
                </div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', marginTop: 'var(--space-1)', paddingLeft: '22px' }}>
                  Every active judge will be assigned all {importData.validRecords?.length} imported teams.
                </div>
              </div>

              <div
                onClick={() => setAssignmentStrategy('specific')}
                style={{
                  padding: 'var(--space-3)',
                  border: `2px solid ${assignmentStrategy === 'specific' ? 'var(--color-primary)' : 'var(--color-border)'}`,
                  background: assignmentStrategy === 'specific' ? 'rgba(79, 70, 229, 0.08)' : 'var(--color-bg-surface)',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontWeight: 600 }}>
                  <input type="radio" name="assignment" checked={assignmentStrategy === 'specific'} onChange={() => setAssignmentStrategy('specific')} />
                  <span>👤 Assign to Specific Judge(s)</span>
                </div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', marginTop: 'var(--space-1)', paddingLeft: '22px' }}>
                  Choose exactly which judges will evaluate these imported teams.
                </div>
              </div>

              <div
                onClick={() => setAssignmentStrategy('none')}
                style={{
                  padding: 'var(--space-3)',
                  border: `2px solid ${assignmentStrategy === 'none' ? 'var(--color-primary)' : 'var(--color-border)'}`,
                  background: assignmentStrategy === 'none' ? 'rgba(79, 70, 229, 0.08)' : 'var(--color-bg-surface)',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontWeight: 600 }}>
                  <input type="radio" name="assignment" checked={assignmentStrategy === 'none'} onChange={() => setAssignmentStrategy('none')} />
                  <span>⏸️ Manual Assignment Later</span>
                </div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', marginTop: 'var(--space-1)', paddingLeft: '22px' }}>
                  Import teams without assigning. You can assign them manually from the Teams page.
                </div>
              </div>
            </div>

            {assignmentStrategy === 'specific' && (
              <div style={{ marginTop: 'var(--space-3)', padding: 'var(--space-3)', background: 'var(--color-bg-surface-alt)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
                <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', marginBottom: 'var(--space-2)' }}>
                  Select Judges ({selectedJuries.length} selected):
                </div>
                {activeJuries.length === 0 ? (
                  <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>No active jury members found.</div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 'var(--space-2)' }}>
                    {activeJuries.map(j => (
                      <label key={j.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-sm)', cursor: 'pointer' }}>
                        <input type="checkbox" checked={selectedJuries.includes(j.id)} onChange={() => toggleJury(j.id)} />
                        <span>{j.full_name}</span>
                        {j.judge_id && <span className="tag" style={{ fontSize: '10px' }}>{j.judge_id}</span>}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-5)' }}>
            <button className="btn btn-secondary" onClick={() => setStep(4)}>← Back</button>
            <button className="btn btn-success btn-lg" onClick={handleConfirm}>✓ Confirm Import</button>
          </div>
        </div>
      )}

      {/* Step 6: Result */}
      {step === 6 && result && (
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 'var(--space-4)' }}>✅</div>
          <h2>Import Completed</h2>
          <div className="import-summary-grid" style={{ marginTop: 'var(--space-6)', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
            <div className="import-summary-item" style={{ background: 'var(--color-success-light)' }}>
              <div className="import-summary-count" style={{ color: 'var(--color-success-dark)' }}>{result.created}</div>
              <div className="import-summary-label">Created</div>
            </div>
            <div className="import-summary-item" style={{ background: 'var(--color-info-light)' }}>
              <div className="import-summary-count" style={{ color: 'var(--color-info-dark)' }}>{result.updated}</div>
              <div className="import-summary-label">Updated</div>
            </div>
            <div className="import-summary-item" style={{ background: 'rgba(79, 70, 229, 0.12)' }}>
              <div className="import-summary-count" style={{ color: 'var(--color-primary)' }}>{result.assigned || 0}</div>
              <div className="import-summary-label">Assigned</div>
            </div>
            <div className="import-summary-item" style={{ background: 'var(--color-warning-light)' }}>
              <div className="import-summary-count" style={{ color: 'var(--color-warning-dark)' }}>{result.skipped}</div>
              <div className="import-summary-label">Skipped</div>
            </div>
            <div className="import-summary-item" style={{ background: 'var(--color-error-light)' }}>
              <div className="import-summary-count" style={{ color: 'var(--color-error-dark)' }}>{result.failed}</div>
              <div className="import-summary-label">Failed</div>
            </div>
          </div>
          <button className="btn btn-primary" style={{ marginTop: 'var(--space-6)' }} onClick={() => { setStep(0); setFile(null); setImportData(null); setResult(null); }}>Import More Teams</button>
        </div>
      )}
    </div>
  );
}

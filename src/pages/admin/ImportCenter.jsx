import { useState } from 'react';
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
  const [result, setResult] = useState(null);
  const toast = useToast();

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
    try {
      const data = await api.post('/import/confirm', {
        records: importData.validRecords,
        duplicateStrategy: dupStrategy,
        fileName: file?.name,
        fileType: importData.file?.type,
      });
      setResult(data.results);
      setStep(6);
      toast.success('Import completed!');
    } catch (err) { toast.error(err.message); }
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
          <h3>Validation Results</h3>
          <div className="import-summary-grid">
            <div className="import-summary-item" style={{ background: 'var(--color-success-light)' }}>
              <div className="import-summary-count" style={{ color: 'var(--color-success-dark)' }}>{importData.summary.validRecords}</div>
              <div className="import-summary-label">Valid</div>
            </div>
            <div className="import-summary-item" style={{ background: 'var(--color-warning-light)' }}>
              <div className="import-summary-count" style={{ color: 'var(--color-warning-dark)' }}>{importData.summary.duplicates}</div>
              <div className="import-summary-label">Duplicates</div>
            </div>
            <div className="import-summary-item" style={{ background: 'var(--color-error-light)' }}>
              <div className="import-summary-count" style={{ color: 'var(--color-error-dark)' }}>{importData.summary.errors}</div>
              <div className="import-summary-label">Errors</div>
            </div>
            <div className="import-summary-item" style={{ background: 'var(--color-accent-light)' }}>
              <div className="import-summary-count" style={{ color: 'var(--color-accent-active)' }}>{importData.summary.validRecords}</div>
              <div className="import-summary-label">Ready to Import</div>
            </div>
          </div>
          {importData.validationErrors?.length > 0 && (
            <div style={{ marginTop: 'var(--space-4)' }}>
              <h4>Errors</h4>
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
          <h3>Preview ({importData.validRecords?.length} records)</h3>
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
                {importData.validRecords?.slice(0, 50).map((r, i) => (
                  <tr key={i}>
                    <td>{r._rowIndex}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-accent)', fontWeight: 600 }}>{r.team_code}</td>
                    <td><strong>{r.team_name}</strong></td>
                    <td>
                      <div>{r.department || r.track || '—'}</div>
                      {r.course && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{r.course}</div>}
                    </td>
                    <td>
                      <div>{r.team_leader || '—'}</div>
                      {r.leader_enrollment && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>{r.leader_enrollment}</div>}
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
          <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
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
          <div className="import-summary-grid" style={{ marginTop: 'var(--space-6)' }}>
            <div className="import-summary-item" style={{ background: 'var(--color-success-light)' }}>
              <div className="import-summary-count" style={{ color: 'var(--color-success-dark)' }}>{result.created}</div>
              <div className="import-summary-label">Created</div>
            </div>
            <div className="import-summary-item" style={{ background: 'var(--color-info-light)' }}>
              <div className="import-summary-count" style={{ color: 'var(--color-info-dark)' }}>{result.updated}</div>
              <div className="import-summary-label">Updated</div>
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

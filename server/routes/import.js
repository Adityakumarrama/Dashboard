import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { authenticate } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/rbac.js';
import { upload } from '../middleware/upload.js';
import { query, queryOne, queryAll } from '../config/database.js';
import { logAction, getClientIp } from '../services/auditService.js';
import { sanitize } from '../utils/helpers.js';
import { parse } from 'csv-parse/sync';
import { XMLParser } from 'fast-xml-parser';
import pdf from 'pdf-parse/lib/pdf-parse.js';

const router = Router();

// Default field mappings for auto-detection
const KNOWN_HEADERS = {
  'team_code': ['team_code', 'teamcode', 'team code', 'code', 'team id', 'teamid', 'team_id'],
  'team_name': ['team_name', 'teamname', 'team name', 'name', 'team'],
  'problem_statement_id': ['problem_statement_id', 'problem_id', 'ps_id', 'problem id', 'psid'],
  'problem_statement_title': ['problem_statement_title', 'problem_title', 'problem statement', 'problem', 'ps_title'],
  'organization': ['organization', 'college', 'institute', 'university', 'org', 'institution', 'college_name'],
  'category': ['category', 'type', 'cat'],
  'track': ['track', 'domain', 'theme'],
  'team_leader': ['team_leader', 'leader', 'team_lead', 'captain'],
  'team_members': ['team_members', 'members', 'team_member'],
  'contact_info': ['contact_info', 'contact', 'email', 'phone', 'mobile'],
};

const DB_FIELDS = Object.keys(KNOWN_HEADERS);

function autoMapFields(detectedHeaders) {
  const mapping = {};
  for (const header of detectedHeaders) {
    const normalized = header.toLowerCase().trim().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_');
    for (const [dbField, aliases] of Object.entries(KNOWN_HEADERS)) {
      if (aliases.includes(normalized) || aliases.includes(header.toLowerCase().trim())) {
        mapping[header] = dbField;
        break;
      }
    }
    if (!mapping[header]) {
      mapping[header] = null; // Unmapped
    }
  }
  return mapping;
}

function validateRecord(record, index) {
  const errors = [];
  if (!record.team_code || record.team_code.trim() === '') {
    errors.push({ row: index + 1, field: 'team_code', error: 'Missing required value' });
  }
  if (!record.team_name || record.team_name.trim() === '') {
    errors.push({ row: index + 1, field: 'team_name', error: 'Missing required value' });
  }
  return errors;
}

/**
 * POST /api/import/upload
 * Upload and parse file, return preview data
 */
router.post('/upload', authenticate, requireAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded', code: 'NO_FILE' });
    }

    const filePath = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();
    const fileContent = fs.readFileSync(filePath);

    let records = [];
    let detectedHeaders = [];
    let parseErrors = [];

    if (ext === '.csv') {
      try {
        const parsed = parse(fileContent, {
          columns: true,
          skip_empty_lines: true,
          trim: true,
          relax_column_count: true,
        });
        detectedHeaders = parsed.length > 0 ? Object.keys(parsed[0]) : [];
        records = parsed;
      } catch (e) {
        parseErrors.push({ error: `CSV parse error: ${e.message}` });
      }
    } else if (ext === '.xml') {
      try {
        const parser = new XMLParser({
          ignoreAttributes: false,
          parseAttributeValue: true,
        });
        const result = parser.parse(fileContent);

        // Try to find team array in various structures
        let teamArray = null;
        if (result.teams && result.teams.team) {
          teamArray = Array.isArray(result.teams.team) ? result.teams.team : [result.teams.team];
        } else if (result.data && result.data.team) {
          teamArray = Array.isArray(result.data.team) ? result.data.team : [result.data.team];
        } else if (result.root && result.root.team) {
          teamArray = Array.isArray(result.root.team) ? result.root.team : [result.root.team];
        }

        if (teamArray) {
          records = teamArray;
          detectedHeaders = records.length > 0 ? Object.keys(records[0]) : [];
        } else {
          parseErrors.push({ error: 'Could not find team records in XML structure' });
        }
      } catch (e) {
        parseErrors.push({ error: `XML parse error: ${e.message}` });
      }
    } else if (ext === '.pdf') {
      try {
        const pdfData = await pdf(fileContent);
        const text = pdfData.text;

        // Attempt to extract team records from PDF text
        records = extractTeamsFromPdfText(text);
        if (records.length > 0) {
          detectedHeaders = Object.keys(records[0]);
        } else {
          parseErrors.push({ error: 'Could not extract team records from PDF. Try CSV or XML format.' });
        }
      } catch (e) {
        parseErrors.push({ error: `PDF parse error: ${e.message}` });
      }
    }

    // Auto-map fields
    const fieldMapping = autoMapFields(detectedHeaders);

    // Apply mapping to records
    const mappedRecords = records.map((record, idx) => {
      const mapped = {};
      for (const [header, dbField] of Object.entries(fieldMapping)) {
        if (dbField && record[header] !== undefined) {
          mapped[dbField] = sanitize(String(record[header] || ''));
        }
      }
      return mapped;
    });

    // Validate records
    const validationErrors = [];
    const validRecords = [];
    const duplicates = [];

    // Check for existing team codes
    const existingCodes = await queryAll('SELECT team_code FROM teams');
    const existingCodeSet = new Set(existingCodes.map(t => t.team_code.toLowerCase()));

    // Check for duplicates within the file
    const seenCodes = new Set();

    mappedRecords.forEach((record, idx) => {
      const rowErrors = validateRecord(record, idx);
      if (rowErrors.length > 0) {
        validationErrors.push(...rowErrors);
      } else if (existingCodeSet.has(record.team_code.toLowerCase())) {
        duplicates.push({ ...record, _rowIndex: idx + 1, _reason: 'Already exists in database' });
      } else if (seenCodes.has(record.team_code.toLowerCase())) {
        duplicates.push({ ...record, _rowIndex: idx + 1, _reason: 'Duplicate in file' });
      } else {
        seenCodes.add(record.team_code.toLowerCase());
        validRecords.push({ ...record, _rowIndex: idx + 1 });
      }
    });

    // Clean up the uploaded file
    try { fs.unlinkSync(filePath); } catch {}

    res.json({
      file: {
        name: req.file.originalname,
        type: ext.substring(1),
        size: req.file.size,
      },
      detectedHeaders,
      fieldMapping,
      dbFields: DB_FIELDS,
      summary: {
        totalRecords: records.length,
        validRecords: validRecords.length,
        duplicates: duplicates.length,
        errors: validationErrors.length,
      },
      records: mappedRecords.map((r, i) => ({ ...r, _rowIndex: i + 1 })),
      validRecords,
      duplicates,
      validationErrors,
      parseErrors,
    });
  } catch (error) {
    console.error('Import upload error:', error);
    res.status(500).json({ error: 'Failed to process file', code: 'IMPORT_ERROR' });
  }
});

/**
 * POST /api/import/confirm
 * Execute the import with validated records
 */
router.post('/confirm', authenticate, requireAdmin, async (req, res) => {
  try {
    const { records, duplicateStrategy, fileName, fileType } = req.body;

    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: 'No records to import', code: 'NO_RECORDS' });
    }

    // Create import record
    const importRecord = await queryOne(
      `INSERT INTO imports (user_id, file_name, file_type, total_records, status)
       VALUES ($1, $2, $3, $4, 'processing') RETURNING *`,
      [req.user.id, fileName || 'unknown', fileType || 'csv', records.length]
    );

    let created = 0, updated = 0, skipped = 0, failed = 0;

    for (const record of records) {
      try {
        // Remove internal fields
        const { _rowIndex, _reason, ...teamData } = record;

        const existing = await queryOne('SELECT id FROM teams WHERE team_code = $1', [teamData.team_code]);

        if (existing) {
          if (duplicateStrategy === 'update' || duplicateStrategy === 'replace') {
            await query(
              `UPDATE teams SET
                team_name = COALESCE($1, team_name),
                problem_statement_id = COALESCE($2, problem_statement_id),
                problem_statement_title = COALESCE($3, problem_statement_title),
                organization = COALESCE($4, organization),
                category = COALESCE($5, category),
                track = COALESCE($6, track),
                team_leader = COALESCE($7, team_leader),
                team_members = COALESCE($8, team_members),
                contact_info = COALESCE($9, contact_info)
               WHERE id = $10`,
              [
                teamData.team_name, teamData.problem_statement_id, teamData.problem_statement_title,
                teamData.organization, teamData.category, teamData.track,
                teamData.team_leader, teamData.team_members ? JSON.stringify(teamData.team_members) : null,
                teamData.contact_info, existing.id,
              ]
            );
            updated++;
          } else {
            skipped++;
          }
        } else {
          await query(
            `INSERT INTO teams (team_code, team_name, problem_statement_id, problem_statement_title,
              organization, category, track, team_leader, team_members, contact_info)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              teamData.team_code, teamData.team_name, teamData.problem_statement_id || null,
              teamData.problem_statement_title || null, teamData.organization || null,
              teamData.category || null, teamData.track || null, teamData.team_leader || null,
              teamData.team_members ? JSON.stringify(teamData.team_members) : '[]',
              teamData.contact_info || null,
            ]
          );
          created++;
        }
      } catch (e) {
        failed++;
        await query(
          'INSERT INTO import_errors (import_id, row_number, error, raw_data) VALUES ($1, $2, $3, $4)',
          [importRecord.id, record._rowIndex || 0, e.message, JSON.stringify(record)]
        );
      }
    }

    // Update import record
    await query(
      `UPDATE imports SET status = 'completed', created_count = $1, updated_count = $2,
        skipped_count = $3, failed_count = $4
       WHERE id = $5`,
      [created, updated, skipped, failed, importRecord.id]
    );

    await logAction(req.user.id, 'import.completed', 'import', importRecord.id,
      { fileName, fileType, created, updated, skipped, failed }, getClientIp(req));

    res.json({
      message: 'Import completed',
      importId: importRecord.id,
      results: { created, updated, skipped, failed },
    });
  } catch (error) {
    console.error('Import confirm error:', error);
    res.status(500).json({ error: 'Failed to execute import', code: 'IMPORT_ERROR' });
  }
});

/**
 * GET /api/import/history
 */
router.get('/history', authenticate, requireAdmin, async (req, res) => {
  try {
    const imports = await queryAll(
      `SELECT i.*, u.full_name as imported_by
       FROM imports i
       JOIN users u ON i.user_id = u.id
       ORDER BY i.created_at DESC
       LIMIT 50`
    );
    res.json({ imports });
  } catch (error) {
    console.error('Import history error:', error);
    res.status(500).json({ error: 'Failed to get import history', code: 'INTERNAL_ERROR' });
  }
});

/**
 * GET /api/import/templates/:format
 * Download sample import template
 */
router.get('/templates/:format', authenticate, requireAdmin, (req, res) => {
  const format = req.params.format.toLowerCase();

  if (format === 'csv') {
    const csv = `team_code,team_name,problem_statement_id,problem_statement_title,organization,category,track,team_leader,team_members,contact_info
SIH2026-001,AgriVision,PS-1042,AI Based Crop Monitoring,XYZ Institute of Technology,Software,Agriculture,Rahul Kumar,"Priya Singh;Amit Shah;Neha Verma",rahul@example.com
SIH2026-002,MediConnect,PS-2051,Smart Healthcare Platform,ABC Engineering College,Software,Healthcare,Sita Patel,"Ravi Sharma;Meera Joshi",sita@example.com`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="team_import_template.csv"');
    return res.send(csv);
  }

  if (format === 'xml') {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<teams>
    <team>
        <team_code>SIH2026-001</team_code>
        <team_name>AgriVision</team_name>
        <problem_statement_id>PS-1042</problem_statement_id>
        <problem_statement_title>AI Based Crop Monitoring</problem_statement_title>
        <organization>XYZ Institute of Technology</organization>
        <category>Software</category>
        <track>Agriculture</track>
        <team_leader>Rahul Kumar</team_leader>
        <team_members>Priya Singh;Amit Shah;Neha Verma</team_members>
        <contact_info>rahul@example.com</contact_info>
    </team>
    <team>
        <team_code>SIH2026-002</team_code>
        <team_name>MediConnect</team_name>
        <problem_statement_id>PS-2051</problem_statement_id>
        <problem_statement_title>Smart Healthcare Platform</problem_statement_title>
        <organization>ABC Engineering College</organization>
        <category>Software</category>
        <track>Healthcare</track>
        <team_leader>Sita Patel</team_leader>
        <team_members>Ravi Sharma;Meera Joshi</team_members>
        <contact_info>sita@example.com</contact_info>
    </team>
</teams>`;
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', 'attachment; filename="team_import_template.xml"');
    return res.send(xml);
  }

  res.status(400).json({ error: 'Unsupported format. Use csv or xml', code: 'INVALID_FORMAT' });
});

/**
 * Extract team records from raw PDF text using heuristic patterns
 */
function extractTeamsFromPdfText(text) {
  const teams = [];

  // Pattern: Look for team code patterns (e.g., SIH2026-001, SIH-001, TEAM-001)
  const teamCodePattern = /\b(SIH[\-_]?\d{4}[\-_]\d{1,4}|TEAM[\-_]\d{1,4}|[A-Z]{2,5}[\-_]\d{3,6})\b/gi;
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // Try tabular detection — look for consistent separators
  const tabularRecords = tryTabularExtraction(lines);
  if (tabularRecords.length > 0) return tabularRecords;

  // Fallback: segment by team code and extract fields
  let currentTeam = null;
  const codeMatches = [...text.matchAll(teamCodePattern)];

  if (codeMatches.length === 0) {
    // No team codes found — try line-by-line keyword extraction
    return tryKeywordExtraction(lines);
  }

  for (const match of codeMatches) {
    const codeIdx = match.index;
    const nextMatch = codeMatches[codeMatches.indexOf(match) + 1];
    const endIdx = nextMatch ? nextMatch.index : text.length;
    const segment = text.substring(codeIdx, endIdx).trim();

    const team = {
      team_code: match[1],
      team_name: extractField(segment, ['team name', 'name'], match[1]),
      problem_statement_id: extractField(segment, ['problem id', 'ps id', 'problem statement id']),
      problem_statement_title: extractField(segment, ['problem', 'problem statement', 'title']),
      organization: extractField(segment, ['college', 'organization', 'institute', 'university']),
      category: extractField(segment, ['category', 'type']),
      track: extractField(segment, ['track', 'domain', 'theme']),
      team_leader: extractField(segment, ['leader', 'captain', 'team lead']),
    };

    // Clean up: if team_name is still the code, try the next non-empty token
    if (!team.team_name || team.team_name === team.team_code) {
      const segLines = segment.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      if (segLines.length > 1) {
        team.team_name = segLines[1].replace(/^[\-:]+/, '').trim().substring(0, 100);
      }
    }

    if (team.team_code) {
      teams.push(team);
    }
  }

  return teams;
}

function extractField(text, keywords, skip = '') {
  for (const kw of keywords) {
    const regex = new RegExp(`${kw}\\s*[:\\-]?\\s*(.+)`, 'i');
    const match = text.match(regex);
    if (match && match[1] && match[1].trim() !== skip) {
      return match[1].trim().split('\n')[0].trim().substring(0, 200);
    }
  }
  return null;
}

function tryTabularExtraction(lines) {
  // Look for header line containing known field names
  const records = [];
  let headerIdx = -1;
  let headers = [];

  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const line = lines[i].toLowerCase();
    if ((line.includes('team') && line.includes('code')) ||
        (line.includes('team') && line.includes('name'))) {
      // Possible header — split by common delimiters
      headers = lines[i].split(/[|\t]/).map(h => h.trim()).filter(h => h.length > 0);
      if (headers.length >= 2) {
        headerIdx = i;
        break;
      }
    }
  }

  if (headerIdx === -1) return [];

  const mapping = autoMapFields(headers);

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const values = lines[i].split(/[|\t]/).map(v => v.trim()).filter(v => v.length > 0);
    if (values.length < 2) continue;
    if (values.every(v => v === '-' || v === '—' || v === '')) continue;

    const record = {};
    headers.forEach((header, idx) => {
      const dbField = mapping[header];
      if (dbField && values[idx]) {
        record[dbField] = values[idx];
      }
    });

    if (record.team_code) {
      records.push(record);
    }
  }

  return records;
}

function tryKeywordExtraction(lines) {
  // Group lines by detecting team-like boundaries
  return [];
}

export default router;

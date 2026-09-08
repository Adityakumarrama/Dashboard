import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { authenticate } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/rbac.js';
import { upload } from '../middleware/upload.js';
import { query, queryOne, queryAll } from '../config/database.js';
import { logAction, getClientIp } from '../services/auditService.js';
import { sanitize, generateTeamCode, getNextTeamSequence } from '../utils/helpers.js';
import { parse } from 'csv-parse/sync';
import { XMLParser } from 'fast-xml-parser';
import pdf from 'pdf-parse/lib/pdf-parse.js';
import supabaseAdmin from '../config/supabase.js';

const router = Router();

// Default field mappings for auto-detection
const KNOWN_HEADERS = {
  'team_code': ['team_code', 'teamcode', 'team code', 'code', 'team id', 'teamid', 'team_id', 'problem code'],
  'team_name': ['team_name', 'teamname', 'team name', 'name', 'team'],
  'problem_statement_id': ['problem_statement_id', 'problem_id', 'ps_id', 'problem id', 'psid', 'problem code'],
  'problem_statement_title': ['problem_statement_title', 'problem_title', 'problem statement', 'problem statement   (sih)', 'problem', 'ps_title'],
  'organization': ['organization', 'college', 'institute', 'university', 'org', 'institution', 'college_name'],
  'department': ['department', 'dept', 'branch'],
  'course': ['course', 'degree', 'program'],
  'category': ['category', 'type', 'cat'],
  'track': ['track', 'domain', 'theme'],
  'team_leader': ['team_leader', 'leader', 'team_lead', 'captain', 'team leader name'],
  'leader_phone': ['leader contact number', 'leader phone', 'leader contact', 'contact number', 'leader_phone'],
  'leader_email': ['rama official email id leader', 'leader email', 'leader_email', 'official email id leader'],
  'leader_enrollment': ['enrollment number (team leader)', 'leader enrollment', 'enrollment number leader', 'leader_enrollment'],
  'team_members': ['team_members', 'members', 'team_member'],
  'contact_info': ['contact_info', 'contact', 'email', 'phone', 'mobile'],
};

const DB_FIELDS = Object.keys(KNOWN_HEADERS);

function isRamaFormat(headers) {
  if (!Array.isArray(headers) || headers.length === 0) return false;
  const joined = headers.map(h => String(h || '').toLowerCase().trim()).join(' ');
  return (
    joined.includes('member 1') &&
    (joined.includes('rama official') || joined.includes('problem code') || joined.includes('team leader') || joined.includes('enrollment number') || joined.includes('team name'))
  );
}

function parseRamaRow(rawCells, headers, index, usedCodes, baseSequence = 1) {
  const get = (idx) => {
    if (idx < 0 || idx >= rawCells.length) return '';
    let val = sanitize(String(rawCells[idx] || '').trim());
    if (val.length > 0 && ['=', '+', '-', '@'].includes(val[0])) {
      val = val.replace(/^[=+\-@]+/, '').trim();
    }
    return val;
  };

  // Dynamic column finder by pattern matching
  const findCol = (pattern, excludePattern = null) => {
    if (!Array.isArray(headers)) return -1;
    return headers.findIndex(h => {
      const s = String(h || '').toLowerCase().trim();
      if (!s) return false;
      const match = Array.isArray(pattern) ? pattern.some(p => s.includes(p.toLowerCase())) : s.includes(pattern.toLowerCase());
      if (!match) return false;
      if (excludePattern) {
        const ex = Array.isArray(excludePattern) ? excludePattern.some(p => s.includes(p.toLowerCase())) : s.includes(excludePattern.toLowerCase());
        if (ex) return false;
      }
      return true;
    });
  };

  // Find columns dynamically
  const teamNameCol = findCol(['team name', 'team_name']);
  const teamCodeCol = findCol(['teamcode', 'team code', 'problem code']);
  const problemTitleCol = findCol(['problem statement', 'ps_title']);
  const submitterEmailCol = findCol(['email address', 'submitter email'], ['member', 'leader']);
  const departmentCol = findCol(['department', 'dept'], ['member']);
  const courseCol = findCol(['course', 'degree', 'program']);
  const yearCol = findCol(['year', 'academic year']);
  const leaderContactCol = findCol(['leader contact', 'contact number', 'leader phone']);
  const leaderNameCol = findCol(['team leader name', 'leader name', 'team leader']);
  const leaderEmailCol = findCol(['official email id leader', 'leader email', 'leader official email']);
  const leaderEnrollCol = findCol(['enrollment number (team leader)', 'leader enrollment', 'enrollment number leader']);

  // Extract values with legacy index fallbacks
  const teamName = get(teamNameCol >= 0 ? teamNameCol : 3) || `Team ${index + 1}`;
  let problemCode = get(teamCodeCol >= 0 ? teamCodeCol : 5);
  const problemTitle = get(problemTitleCol >= 0 ? problemTitleCol : 6);
  const submitterEmail = get(submitterEmailCol >= 0 ? submitterEmailCol : 0);
  const department = get(departmentCol >= 0 ? departmentCol : 1);
  const course = get(courseCol >= 0 ? courseCol : 2);
  const rawYear = get(yearCol);
  const parsedYear = rawYear ? parseInt(String(rawYear).replace(/[^0-9]/g, ''), 10) || null : null;
  const leaderContact = get(leaderContactCol >= 0 ? leaderContactCol : 4);
  const leaderName = get(leaderNameCol >= 0 ? leaderNameCol : 7);
  const leaderEmail = get(leaderEmailCol >= 0 ? leaderEmailCol : 8);
  const leaderEnroll = get(leaderEnrollCol >= 0 ? leaderEnrollCol : 9);

  // Generate team code in format: SIH_<TEAM NAME 4 chars>_<Sr Number>
  const serialNumber = baseSequence + index;
  const uniqueCode = generateTeamCode(teamName, serialNumber);
  usedCodes.add(uniqueCode.toUpperCase());

  // Locate Member 1 to 5 starting columns
  const mIndices = [];
  for (let m = 1; m <= 5; m++) {
    const idx = headers.findIndex(h => new RegExp(`member\\s*${m}`, 'i').test(String(h || '')));
    mIndices.push(idx);
  }

  const legacyMemberStarts = [10, 15, 20, 25, 30];
  const members = [];

  for (let m = 0; m < 5; m++) {
    let startIdx = mIndices[m];
    if (startIdx === -1 && headers.length <= 34) {
      startIdx = legacyMemberStarts[m];
    }
    if (startIdx === -1 || startIdx >= rawCells.length) continue;

    const mName = get(startIdx);
    if (!mName) continue;

    let mEmail = '', mEnroll = '', mGender = m === 0 ? 'Female' : 'Male', mDept = department;

    if (mIndices[m] !== -1) {
      const nextIdx = (m < 4 && mIndices[m + 1] !== -1) ? mIndices[m + 1] : Math.min(startIdx + 6, headers.length);
      for (let c = startIdx + 1; c < nextIdx; c++) {
        const h = String(headers[c] || '').toLowerCase();
        const val = get(c);
        if (!val) continue;
        if (h.includes('email')) mEmail = val;
        else if (h.includes('enroll')) mEnroll = val;
        else if (h.includes('gender')) mGender = val;
        else if (h.includes('department') || h.includes('dept')) mDept = val;
      }
    } else {
      mEmail = get(startIdx + 1);
      mEnroll = get(startIdx + 2);
      mGender = get(startIdx + 3) || (m === 0 ? 'Female' : 'Male');
      mDept = get(startIdx + 4) || department;
    }

    const isGirl = m === 0 || /female/i.test(mGender) || /girl/i.test(String(headers[startIdx] || ''));

    members.push({
      member_number: m + 1,
      name: mName,
      email: mEmail || null,
      enrollment_number: mEnroll || null,
      gender: mGender,
      department: mDept || department || null,
      course: course || null,
      academic_year: parsedYear || null,
      member_year: parsedYear || null,
      contact: null,
      is_girl_member: isGirl,
    });
  }

  const contactInfo = [
    leaderName ? `Leader: ${leaderName}` : null,
    leaderEmail ? `Email: ${leaderEmail}` : null,
    leaderContact ? `Phone: ${leaderContact}` : null,
  ].filter(Boolean).join(' | ');

  return {
    team_code: uniqueCode,
    team_name: teamName,
    problem_statement_id: problemCode || uniqueCode,
    problem_statement_title: problemTitle,
    organization: 'Rama University (F.E.T)',
    department,
    course,
    category: 'Software',
    track: department || course || 'Technology',
    team_leader: leaderName,
    leader_phone: leaderContact,
    leader_email: leaderEmail,
    leader_enrollment: leaderEnroll,
    submitter_email: submitterEmail,
    academic_year: parsedYear,
    contact_info: contactInfo,
    team_members: members,
    raw_data: rawCells,
  };
}

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
      mapping[header] = null;
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

    const ext = path.extname(req.file.originalname).toLowerCase();
    const fileContent = req.file.buffer || (req.file.path ? fs.readFileSync(req.file.path) : null);
    if (!fileContent) {
      return res.status(400).json({ error: 'File content is empty', code: 'EMPTY_FILE' });
    }

    let records = [];
    let detectedHeaders = [];
    let parseErrors = [];
    let isRama = false;
    const usedCodes = new Set();

    // Query existing team codes in DB to calculate true starting serial number
    let existingCodes = [];
    try {
      existingCodes = await queryAll('SELECT team_code FROM teams');
    } catch {
      const { data } = await supabaseAdmin.from('teams').select('team_code');
      existingCodes = data || [];
    }
    const existingCodeList = (existingCodes || []).map(t => t.team_code).filter(Boolean);
    const existingCodeSet = new Set(existingCodeList.map(c => c.toLowerCase()));
    const baseSequence = getNextTeamSequence(existingCodeList);

    if (ext === '.csv' || ext === '.tsv' || ext === '.txt') {
      try {
        const text = fileContent.toString('utf-8');
        const firstLine = text.split('\n')[0] || '';
        const delimiter = firstLine.includes('\t') ? '\t' : ',';

        // Parse with columns: false to keep raw column array intact
        const rawRows = parse(text, {
          delimiter,
          skip_empty_lines: true,
          trim: true,
          relax_column_count: true,
        });

        if (rawRows.length > 0) {
          // 1. Scan top rows (up to 10) to find the true header row
          let headerRowIndex = 0;
          for (let r = 0; r < Math.min(rawRows.length, 10); r++) {
            const row = rawRows[r];
            if (!Array.isArray(row) || row.length === 0) continue;
            const nonEmpty = row.filter(c => c && String(c).trim().length > 0).length;
            if (nonEmpty < 2) continue; // skip row if it's empty or almost empty

            const rowText = row.map(c => String(c || '').toLowerCase().trim()).join(' ');
            const headerKeywords = ['email', 'team', 'member', 'department', 'course', 'problem', 'code', 'leader'];
            const matchCount = headerKeywords.filter(kw => rowText.includes(kw)).length;

            if (matchCount >= 2) {
              headerRowIndex = r;
              break;
            }
          }

          detectedHeaders = rawRows[headerRowIndex].map(h => String(h || '').trim());
          isRama = isRamaFormat(detectedHeaders);

          // 2. Filter out ghost / empty rows from data
          const dataRows = rawRows.slice(headerRowIndex + 1);
          const validDataRows = dataRows.filter(row => {
            if (!Array.isArray(row) || row.length === 0) return false;
            // Check if row has at least 2 non-empty cells
            const nonEmptyCells = row.filter(c => c !== null && c !== undefined && String(c).trim().length > 0);
            return nonEmptyCells.length >= 2;
          });

          if (isRama) {
            records = validDataRows.map((row, idx) => parseRamaRow(row, detectedHeaders, idx, usedCodes, baseSequence));
          } else {
            // Standard CSV mapping: map valid rows using detectedHeaders
            records = validDataRows.map(row => {
              const obj = {};
              detectedHeaders.forEach((header, colIdx) => {
                const key = header || `column_${colIdx + 1}`;
                obj[key] = sanitize(String(row[colIdx] || '').trim());
              });
              return obj;
            });
          }
        }
      } catch (e) {
        parseErrors.push({ error: `CSV/TSV parse error: ${e.message}` });
      }
    } else if (ext === '.xml') {
      try {
        const parser = new XMLParser({
          ignoreAttributes: false,
          parseAttributeValue: true,
        });
        const result = parser.parse(fileContent);

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

    let mappedRecords = [];
    let fieldMapping = {};

    if (isRama) {
      mappedRecords = records;
      fieldMapping = {
        'Rama University SIH Format': 'Auto-detected (Leader + 5 Members, Dept, Course, Problem Code)',
      };
    } else {
      fieldMapping = autoMapFields(detectedHeaders);
      mappedRecords = records.map((record, idx) => {
        const mapped = {};
        for (const [header, dbField] of Object.entries(fieldMapping)) {
          if (dbField && record[header] !== undefined) {
            mapped[dbField] = sanitize(String(record[header] || ''));
          }
        }
        if (!mapped.team_code && mapped.team_name) {
          mapped.team_code = generateTeamCode(mapped.team_name, baseSequence + idx);
        }
        return mapped;
      });
    }

    // Validate records
    const validationErrors = [];
    const validRecords = [];
    const duplicates = [];

    const seenCodes = new Set();

    mappedRecords.forEach((record, idx) => {
      const rowErrors = validateRecord(record, idx);
      if (rowErrors.length > 0) {
        validationErrors.push(...rowErrors);
      } else if (existingCodeSet.has((record.team_code || '').toLowerCase())) {
        duplicates.push({ ...record, _rowIndex: idx + 1, _reason: 'Already exists in database' });
      } else if (seenCodes.has((record.team_code || '').toLowerCase())) {
        duplicates.push({ ...record, _rowIndex: idx + 1, _reason: 'Duplicate in file' });
      } else {
        seenCodes.add((record.team_code || '').toLowerCase());
        validRecords.push({ ...record, _rowIndex: idx + 1 });
      }
    });

    if (req.file.path) {
      try { fs.unlinkSync(req.file.path); } catch {}
    }

    res.json({
      file: {
        name: req.file.originalname,
        type: ext.substring(1),
        size: req.file.size,
        isRamaFormat: isRama,
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

// ============================================================
// HIGH-PERFORMANCE BATCH HELPERS FOR IMPORT CONFIRMATION
// ============================================================

async function batchInsertTeams(rows) {
  if (!rows || rows.length === 0) return [];
  const CHUNK_SIZE = 50;
  const columns = [
    'team_code', 'team_name', 'problem_statement_id', 'problem_statement_title',
    'organization', 'category', 'track', 'team_leader', 'team_members',
    'contact_info', 'department', 'course', 'leader_phone', 'leader_email',
    'leader_enrollment', 'submitter_email', 'raw_data'
  ];
  const inserted = [];

  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    try {
      const placeholders = [];
      const params = [];
      let pIdx = 1;

      for (const row of chunk) {
        const rowVals = [];
        for (const col of columns) {
          rowVals.push(`$${pIdx++}`);
          params.push(row[col] !== undefined ? row[col] : null);
        }
        placeholders.push(`(${rowVals.join(', ')})`);
      }

      const sql = `INSERT INTO teams (${columns.join(', ')}) VALUES ${placeholders.join(', ')} RETURNING id, team_code`;
      const res = await query(sql, params);
      if (res?.rows) {
        inserted.push(...res.rows);
      }
    } catch (pgErr) {
      console.warn('Postgres batchInsertTeams fallback to Supabase REST:', pgErr.message);
      const cleanChunk = chunk.map(r => {
        const obj = {};
        for (const col of columns) {
          if (r[col] !== undefined) {
            if ((col === 'team_members' || col === 'raw_data') && typeof r[col] === 'string') {
              try { obj[col] = JSON.parse(r[col]); } catch { obj[col] = r[col]; }
            } else {
              obj[col] = r[col];
            }
          }
        }
        return obj;
      });

      const { data, error: supaErr } = await supabaseAdmin
        .from('teams')
        .insert(cleanChunk)
        .select('id, team_code');

      if (supaErr) {
        console.error('Supabase batchInsertTeams error:', supaErr.message);
        throw supaErr;
      }
      if (data) {
        inserted.push(...data);
      }
    }
  }
  return inserted;
}

async function batchInsertRows(tableName, columns, rows, onConflictClause = '') {
  if (!rows || rows.length === 0) return [];
  const CHUNK_SIZE = 50;

  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    try {
      const placeholders = [];
      const params = [];
      let pIdx = 1;

      for (const row of chunk) {
        const rowVals = [];
        for (const col of columns) {
          rowVals.push(`$${pIdx++}`);
          params.push(row[col] !== undefined ? row[col] : null);
        }
        placeholders.push(`(${rowVals.join(', ')})`);
      }

      const sql = `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES ${placeholders.join(', ')} ${onConflictClause}`;
      await query(sql, params);
    } catch (pgErr) {
      console.warn(`Postgres batchInsertRows to ${tableName} fallback to Supabase REST:`, pgErr.message);
      const cleanChunk = chunk.map(r => {
        const obj = {};
        for (const col of columns) {
          if (r[col] !== undefined) obj[col] = r[col];
        }
        return obj;
      });

      let queryBuilder = supabaseAdmin.from(tableName);
      if (onConflictClause && onConflictClause.includes('DO NOTHING')) {
        queryBuilder = queryBuilder.upsert(cleanChunk, { onConflict: 'user_id,team_id', ignoreDuplicates: true });
      } else {
        queryBuilder = queryBuilder.insert(cleanChunk);
      }

      const { error: supaErr } = await queryBuilder;
      if (supaErr) {
        console.warn(`Supabase fallback error for ${tableName}:`, supaErr.message);
      }
    }
  }
}

/**
 * POST /api/import/confirm
 * Execute the import with validated records in ultra-fast batched queries
 */
router.post('/confirm', authenticate, requireAdmin, async (req, res) => {
  try {
    const { 
      records, 
      duplicateStrategy = 'skip', 
      fileName, 
      fileType, 
      assignmentStrategy = 'auto_round_robin', 
      selectedJuryIds = [] 
    } = req.body;

    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: 'No records to import', code: 'NO_RECORDS' });
    }

    let importRecord = null;
    try {
      importRecord = await queryOne(
        `INSERT INTO imports (user_id, file_name, file_type, total_records, status)
         VALUES ($1, $2, $3, $4, 'processing') RETURNING *`,
        [req.user.id, fileName || 'unknown', fileType || 'csv', records.length]
      );
    } catch {
      const { data } = await supabaseAdmin.from('imports').insert({
        user_id: req.user.id,
        file_name: fileName || 'unknown',
        file_type: fileType || 'csv',
        total_records: records.length,
        status: 'processing',
      }).select().single();
      importRecord = data;
    }

    let created = 0, updated = 0, skipped = 0, failed = 0, assigned = 0;
    const insertedTeamIds = [];
    const processedTeamsWithMembers = [];

    // 1. Batch pre-fetch all existing teams in 1 single database query
    const allCleanCodes = records.map(r => sanitize(r.team_code)).filter(Boolean);
    let existingTeams = [];
    try {
      existingTeams = await queryAll(
        'SELECT id, team_code FROM teams WHERE team_code = ANY($1)',
        [allCleanCodes]
      );
    } catch {
      const { data } = await supabaseAdmin
        .from('teams')
        .select('id, team_code')
        .in('team_code', allCleanCodes);
      existingTeams = data || [];
    }
    const existingMap = new Map();
    for (const t of existingTeams) {
      if (t.team_code) existingMap.set(t.team_code.toLowerCase(), t.id);
    }

    // 2. Categorize records into toCreate, toUpdate, toSkip in memory
    const toCreate = [];
    const toUpdate = [];

    for (const record of records) {
      const { _rowIndex, _reason, ...teamData } = record;
      const cleanCode = sanitize(teamData.team_code);
      const cleanName = sanitize(teamData.team_name);
      if (!cleanCode || !cleanName) {
        failed++;
        continue;
      }

      const existingId = existingMap.get(cleanCode.toLowerCase());

      const teamPayload = {
        team_code: cleanCode,
        team_name: cleanName,
        problem_statement_id: teamData.problem_statement_id || null,
        problem_statement_title: teamData.problem_statement_title || null,
        organization: teamData.organization || 'Rama University (F.E.T)',
        department: teamData.department || null,
        course: teamData.course || null,
        category: teamData.category || 'Software',
        track: teamData.track || teamData.department || 'Technology',
        team_leader: teamData.team_leader || null,
        leader_phone: teamData.leader_phone || null,
        leader_email: teamData.leader_email || null,
        leader_enrollment: teamData.leader_enrollment || null,
        submitter_email: teamData.submitter_email || null,
        contact_info: teamData.contact_info || null,
        team_members: JSON.stringify(Array.isArray(teamData.team_members) ? teamData.team_members : []),
        raw_data: teamData.raw_data ? JSON.stringify(teamData.raw_data) : null,
        _originalMembers: Array.isArray(teamData.team_members) ? teamData.team_members : [],
        academic_year: teamData.academic_year || null,
      };

      if (existingId) {
        if (duplicateStrategy === 'update' || duplicateStrategy === 'replace') {
          toUpdate.push({ existingId, payload: teamPayload });
        } else {
          skipped++;
        }
      } else {
        toCreate.push(teamPayload);
      }
    }

    // 3. Batch insert new teams in ONE multi-row query
    if (toCreate.length > 0) {
      try {
        const insertedRows = await batchInsertTeams(toCreate);
        const insertedIdMap = new Map();
        for (const row of insertedRows) {
          if (row.team_code) insertedIdMap.set(row.team_code.toLowerCase(), row.id);
        }

        for (const payload of toCreate) {
          const teamId = insertedIdMap.get(payload.team_code.toLowerCase());
          if (teamId) {
            insertedTeamIds.push(teamId);
            created++;
            if (payload._originalMembers && payload._originalMembers.length > 0) {
              processedTeamsWithMembers.push({
                teamId,
                teamCode: payload.team_code,
                members: payload._originalMembers,
                department: payload.department,
                course: payload.course,
                academicYear: payload.academic_year,
              });
            }
          }
        }
      } catch (insertErr) {
        console.error('Batch team insert error:', insertErr);
        failed += toCreate.length;
      }
    }

    // 4. Concurrent update for existing duplicate teams (if update selected)
    if (toUpdate.length > 0) {
      await Promise.allSettled(
        toUpdate.map(async ({ existingId, payload }) => {
          try {
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
                contact_info = COALESCE($9, contact_info),
                department = COALESCE($10, department),
                course = COALESCE($11, course),
                leader_phone = COALESCE($12, leader_phone),
                leader_email = COALESCE($13, leader_email),
                leader_enrollment = COALESCE($14, leader_enrollment),
                submitter_email = COALESCE($15, submitter_email)
               WHERE id = $16`,
              [
                payload.team_name, payload.problem_statement_id, payload.problem_statement_title,
                payload.organization, payload.category, payload.track,
                payload.team_leader, payload.team_members,
                payload.contact_info, payload.department, payload.course,
                payload.leader_phone, payload.leader_email, payload.leader_enrollment,
                payload.submitter_email, existingId,
              ]
            );
            updated++;
            if (payload._originalMembers && payload._originalMembers.length > 0) {
              processedTeamsWithMembers.push({
                teamId: existingId,
                teamCode: payload.team_code,
                members: payload._originalMembers,
                department: payload.department,
                course: payload.course,
                academicYear: payload.academic_year,
              });
            }
          } catch (updateErr) {
            console.warn('Update team fallback to Supabase:', updateErr.message);
            try {
              const cleanPayload = { ...payload };
              delete cleanPayload._originalMembers;
              delete cleanPayload.team_members;
              await supabaseAdmin.from('teams').update(cleanPayload).eq('id', existingId);
              updated++;
            } catch {
              failed++;
            }
          }
        })
      );
    }

    // 5. Batch insert relational team_members and master_team_member_details
    if (processedTeamsWithMembers.length > 0) {
      const allTeamMembers = [];
      const allMasterMembers = [];
      const teamIdsWithMembers = [];

      for (const item of processedTeamsWithMembers) {
        const { teamId, teamCode, members, department, course, academicYear } = item;
        teamIdsWithMembers.push(teamId);

        for (const m of members) {
          const mContact = m.contact || m.phone || null;
          const mCourse = m.course || course || null;
          const mDept = m.department || department || null;
          const rawYr = m.member_year || m.academic_year || m.year || academicYear || null;
          const mYear = rawYr ? parseInt(String(rawYr).replace(/[^0-9]/g, ''), 10) || null : null;

          allTeamMembers.push({
            team_id: teamId,
            team_code: teamCode,
            member_number: m.member_number,
            name: m.name,
            email: m.email || null,
            enrollment_number: m.enrollment_number || null,
            gender: m.gender || null,
            department: mDept,
            course: mCourse,
            contact: mContact,
            academic_year: mYear,
            is_girl_member: !!m.is_girl_member,
          });

          allMasterMembers.push({
            team_id: teamId,
            team_code: teamCode,
            member_number: m.member_number,
            member_name: m.name,
            member_email: m.email || null,
            member_enrolment: m.enrollment_number || null,
            member_contact: mContact,
            member_department: mDept,
            member_course: mCourse,
            member_year: mYear,
            gender: m.gender || null,
            is_girl_member: !!m.is_girl_member,
          });
        }
      }

      // Batch delete old member records for updated teams
      if (teamIdsWithMembers.length > 0) {
        try {
          await query('DELETE FROM team_members WHERE team_id = ANY($1)', [teamIdsWithMembers]);
          await query('DELETE FROM master_team_member_details WHERE team_id = ANY($1)', [teamIdsWithMembers]);
        } catch {
          await supabaseAdmin.from('team_members').delete().in('team_id', teamIdsWithMembers);
          await supabaseAdmin.from('master_team_member_details').delete().in('team_id', teamIdsWithMembers);
        }
      }

      // Batch insert into team_members in chunks of 50
      const memberCols = [
        'team_id', 'team_code', 'member_number', 'name', 'email',
        'enrollment_number', 'gender', 'department', 'course', 'contact',
        'academic_year', 'is_girl_member'
      ];
      await batchInsertRows('team_members', memberCols, allTeamMembers);

      // Batch insert into master_team_member_details in chunks of 50
      const masterCols = [
        'team_id', 'team_code', 'member_number', 'member_name', 'member_email',
        'member_enrolment', 'member_contact', 'member_department', 'member_course',
        'member_year', 'gender', 'is_girl_member'
      ];
      await batchInsertRows('master_team_member_details', masterCols, allMasterMembers);
    }

    // 6. Batch assign new teams to juries in ONE single operation
    if (insertedTeamIds.length > 0 && assignmentStrategy !== 'none') {
      try {
        let targetJuries = [];
        if (assignmentStrategy === 'specific' && Array.isArray(selectedJuryIds) && selectedJuryIds.length > 0) {
          try {
            targetJuries = await queryAll("SELECT id FROM users WHERE id = ANY($1) AND role = 'JURY' AND status = 'active'", [selectedJuryIds]);
          } catch {
            const { data } = await supabaseAdmin.from('users').select('id').in('id', selectedJuryIds).eq('role', 'JURY').eq('status', 'active');
            targetJuries = data || [];
          }
        } else {
          try {
            targetJuries = await queryAll("SELECT id FROM users WHERE role = 'JURY' AND status = 'active' ORDER BY created_at");
          } catch {
            const { data } = await supabaseAdmin.from('users').select('id').eq('role', 'JURY').eq('status', 'active').order('created_at');
            targetJuries = data || [];
          }
        }

        if (targetJuries.length > 0) {
          const assignmentRows = [];
          if (assignmentStrategy === 'auto_all' || assignmentStrategy === 'specific') {
            for (const teamId of insertedTeamIds) {
              for (const jury of targetJuries) {
                assignmentRows.push({
                  user_id: jury.id,
                  team_id: teamId,
                  assigned_by: req.user.id,
                });
              }
            }
          } else if (assignmentStrategy === 'auto_round_robin') {
            for (let i = 0; i < insertedTeamIds.length; i++) {
              const teamId = insertedTeamIds[i];
              const jury = targetJuries[i % targetJuries.length];
              assignmentRows.push({
                user_id: jury.id,
                team_id: teamId,
                assigned_by: req.user.id,
              });
            }
          }

          if (assignmentRows.length > 0) {
            const assignCols = ['user_id', 'team_id', 'assigned_by'];
            await batchInsertRows('jury_assignments', assignCols, assignmentRows, 'ON CONFLICT (user_id, team_id) DO NOTHING');
            assigned = assignmentRows.length;
          }
        }
      } catch (assignErr) {
        console.warn('Assign post-import notice:', assignErr.message);
      }
    }

    // 7. Update import record status
    if (importRecord?.id) {
      try {
        await query(
          `UPDATE imports SET status = 'completed', created_count = $1, updated_count = $2,
            skipped_count = $3, failed_count = $4
           WHERE id = $5`,
          [created, updated, skipped, failed, importRecord.id]
        );
      } catch {
        await supabaseAdmin.from('imports').update({
          status: 'completed',
          created_count: created,
          updated_count: updated,
          skipped_count: skipped,
          failed_count: failed,
        }).eq('id', importRecord.id);
      }
    }

    try {
      await logAction(req.user.id, 'import.completed', 'import', importRecord?.id,
        { fileName, fileType, created, updated, skipped, failed, assigned, assignmentStrategy }, getClientIp(req));
    } catch {}

    res.json({
      message: 'Import completed successfully',
      importId: importRecord?.id,
      results: { created, updated, skipped, failed, assigned },
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
    let imports = [];
    try {
      imports = await queryAll(
        `SELECT i.*, u.full_name as imported_by
         FROM imports i
         JOIN users u ON i.user_id = u.id
         ORDER BY i.created_at DESC
         LIMIT 50`
      );
    } catch {
      const { data } = await supabaseAdmin.from('imports').select('*, users(full_name)').order('created_at', { ascending: false }).limit(50);
      imports = (data || []).map(i => ({ ...i, imported_by: i.users?.full_name }));
    }
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
router.get('/templates/:format', (req, res) => {
  const format = req.params.format.toLowerCase();

  if (format === 'csv' || format === 'tsv') {
    const isTsv = format === 'tsv';
    const sep = isTsv ? '\t' : ',';
    const headers = [
      'Email Address', 'Department', 'Course', 'Team Name', 'Leader Contact Number',
      'Problem Code (SIH)( Like: SIHXXXXX)', 'Problem Statement   (SIH)',
      'Team Leader Name   ( Like:  Name -F.E.T)', 'Rama official Email id Leader', 'Enrollment Number (Team Leader)', 'YEAR',
      'Member 1 - Girl     ( Like:  Name -F.E.T)', 'Email id  (Rama official) Member 1', 'Enrollment Number (Member 1)', 'Gender', 'Department',
      'Member 2     ( Like:  Name -F.E.T)', 'Gender', 'Email id (Rama official) Member 2', 'Enrollment Number (Member 2)', 'Department',
      'Member 3     ( Like:  Name -FET)', 'Gender', 'Email id (Rama offical ) Member 3', 'Enrollment Number (Member 3)', 'Department',
      'Member 4     ( Like:  Name -F.E.T)', 'Email id (Rama official) Member 4', 'Gender', 'Enrollment Number (Member 4)', 'Department',
      'Member 5  ( Like:  Name -F.E.T)', 'Email id (Rama offical )Member 5', 'Enrollment Number (Member 5)', 'Department'
    ];

    const row1 = [
      'leader@ramauniversity.ac.in', 'Computer Science & Engineering', 'B.Tech CSE', 'Code Mavericks', '9876543210',
      'SIH1523', 'AI Powered Real-time Traffic Management System',
      'Rahul Sharma - F.E.T', 'rahul.sharma@ramauniversity.ac.in', 'RU2022CSE045', '3rd',
      'Priya Patel - F.E.T', 'priya.patel@ramauniversity.ac.in', 'RU2022CSE088', 'Female', 'Computer Science & Engineering',
      'Aman Verma - F.E.T', 'Male', 'aman.verma@ramauniversity.ac.in', 'RU2022CSE012', 'Computer Science & Engineering',
      'Rohan Gupta - FET', 'Male', 'rohan.gupta@ramauniversity.ac.in', 'RU2022CSE067', 'Computer Science & Engineering',
      'Sneha Singh - F.E.T', 'sneha.singh@ramauniversity.ac.in', 'Female', 'RU2022IT019', 'Information Technology',
      'Vikas Yadav - F.E.T', 'vikas.yadav@ramauniversity.ac.in', 'RU2022ME004', 'Mechanical Engineering'
    ];

    const output = [
      headers.join(sep),
      row1.map(v => isTsv ? v : `"${v.replace(/"/g, '""')}"`).join(sep)
    ].join('\n');

    res.setHeader('Content-Type', isTsv ? 'text/tab-separated-values' : 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="rama_sih_team_template.${format}"`);
    return res.send(output);
  }

  if (format === 'xml') {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<teams>
    <team>
        <team_code>SIH1523</team_code>
        <team_name>Code Mavericks</team_name>
        <problem_statement_id>SIH1523</problem_statement_id>
        <problem_statement_title>AI Powered Real-time Traffic Management System</problem_statement_title>
        <organization>Rama University (F.E.T)</organization>
        <category>Software</category>
        <track>Computer Science &amp; Engineering</track>
        <team_leader>Rahul Sharma - F.E.T</team_leader>
        <contact_info>rahul.sharma@ramauniversity.ac.in | 9876543210</contact_info>
    </team>
</teams>`;
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', 'attachment; filename="team_import_template.xml"');
    return res.send(xml);
  }

  res.status(400).json({ error: 'Unsupported format. Use csv, tsv or xml', code: 'INVALID_FORMAT' });
});

function extractTeamsFromPdfText(text) {
  const teams = [];
  const teamCodePattern = /\b(SIH[\-_]?\d{4}[\-_]\d{1,4}|TEAM[\-_]\d{1,4}|[A-Z]{2,5}[\-_]\d{3,6})\b/gi;
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const codeMatches = [...text.matchAll(teamCodePattern)];

  if (codeMatches.length === 0) return [];

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

export default router;

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
    (joined.includes('rama official') || joined.includes('problem code') || joined.includes('team leader name') || joined.includes('enrollment number'))
  );
}

function parseRamaRow(rawCells, headers, index, usedCodes) {
  const getVal = (idx) => sanitize(String(rawCells[idx] || '').trim());

  // Problem Code (SIH)
  let problemCode = getVal(5);
  // Team Name
  const teamName = getVal(3) || `Team ${index + 1}`;
  // Problem Statement
  const problemTitle = getVal(6) || '';
  // Submitter Email
  const submitterEmail = getVal(0) || '';
  // Department & Course
  const department = getVal(1) || '';
  const course = getVal(2) || '';

  // Team Leader
  const leaderContact = getVal(4) || '';
  const leaderName = getVal(7) || '';
  const leaderEmail = getVal(8) || '';
  const leaderEnroll = getVal(9) || '';

  // Clean and format team code
  let teamCode = problemCode ? problemCode.replace(/[^a-zA-Z0-9_-]/g, '-').toUpperCase() : `SIH2026-TEAM-${index + 1}`;
  if (!teamCode.startsWith('SIH')) teamCode = `SIH-${teamCode}`;

  // Ensure unique team code
  let uniqueCode = teamCode;
  let counter = 1;
  while (usedCodes.has(uniqueCode.toLowerCase())) {
    counter++;
    uniqueCode = `${teamCode}-${String(counter).padStart(2, '0')}`;
  }
  usedCodes.add(uniqueCode.toLowerCase());

  // Extract up to 5 members
  const members = [];

  // Member 1 (Girl)
  const m1Name = getVal(10);
  if (m1Name) {
    members.push({
      member_number: 1,
      name: m1Name,
      email: getVal(11),
      enrollment_number: getVal(12),
      gender: getVal(13) || 'Female',
      department: getVal(14) || department,
      course: course || null,
      is_girl_member: true,
    });
  }

  // Member 2
  const m2Name = getVal(15);
  if (m2Name) {
    members.push({
      member_number: 2,
      name: m2Name,
      gender: getVal(16) || 'Male',
      email: getVal(17),
      enrollment_number: getVal(18),
      department: getVal(19) || department,
      course: course || null,
      is_girl_member: false,
    });
  }

  // Member 3
  const m3Name = getVal(20);
  if (m3Name) {
    members.push({
      member_number: 3,
      name: m3Name,
      gender: getVal(21) || 'Male',
      email: getVal(22),
      enrollment_number: getVal(23),
      department: getVal(24) || department,
      course: course || null,
      is_girl_member: false,
    });
  }

  // Member 4
  const m4Name = getVal(25);
  if (m4Name) {
    members.push({
      member_number: 4,
      name: m4Name,
      email: getVal(26),
      gender: getVal(27) || 'Male',
      enrollment_number: getVal(28),
      department: getVal(29) || department,
      course: course || null,
      is_girl_member: false,
    });
  }

  // Member 5
  const m5Name = getVal(30);
  if (m5Name) {
    members.push({
      member_number: 5,
      name: m5Name,
      email: getVal(31),
      enrollment_number: getVal(32),
      department: getVal(33) || department,
      course: course || null,
      gender: 'Male',
      is_girl_member: false,
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
          detectedHeaders = rawRows[0];
          isRama = isRamaFormat(detectedHeaders);

          if (isRama) {
            records = rawRows.slice(1).map((row, idx) => parseRamaRow(row, detectedHeaders, idx, usedCodes));
          } else {
            // Standard CSV mapping
            const parsed = parse(text, {
              delimiter,
              columns: true,
              skip_empty_lines: true,
              trim: true,
              relax_column_count: true,
            });
            records = parsed;
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
      mappedRecords = records.map((record) => {
        const mapped = {};
        for (const [header, dbField] of Object.entries(fieldMapping)) {
          if (dbField && record[header] !== undefined) {
            mapped[dbField] = sanitize(String(record[header] || ''));
          }
        }
        return mapped;
      });
    }

    // Validate records
    const validationErrors = [];
    const validRecords = [];
    const duplicates = [];

    // Check for existing team codes in DB
    let existingCodes = [];
    try {
      existingCodes = await queryAll('SELECT team_code FROM teams');
    } catch {
      const { data } = await supabaseAdmin.from('teams').select('team_code');
      existingCodes = data || [];
    }
    const existingCodeSet = new Set((existingCodes || []).map(t => (t.team_code || '').toLowerCase()));

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

    let created = 0, updated = 0, skipped = 0, failed = 0;
    const insertedTeams = [];

    for (const record of records) {
      try {
        const { _rowIndex, _reason, ...teamData } = record;
        const cleanCode = sanitize(teamData.team_code);
        const cleanName = sanitize(teamData.team_name);

        let existing = null;
        try {
          existing = await queryOne('SELECT id FROM teams WHERE team_code = $1', [cleanCode]);
        } catch {
          const { data } = await supabaseAdmin.from('teams').select('id').eq('team_code', cleanCode).maybeSingle();
          existing = data;
        }

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
          team_members: Array.isArray(teamData.team_members) ? teamData.team_members : [],
          raw_data: teamData.raw_data || null,
        };

        let currentTeamId = null;

        if (existing) {
          if (duplicateStrategy === 'update' || duplicateStrategy === 'replace') {
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
                  teamPayload.team_name, teamPayload.problem_statement_id, teamPayload.problem_statement_title,
                  teamPayload.organization, teamPayload.category, teamPayload.track,
                  teamPayload.team_leader, JSON.stringify(teamPayload.team_members),
                  teamPayload.contact_info, teamPayload.department, teamPayload.course,
                  teamPayload.leader_phone, teamPayload.leader_email, teamPayload.leader_enrollment,
                  teamPayload.submitter_email, existing.id,
                ]
              );
            } catch {
              await supabaseAdmin.from('teams').update(teamPayload).eq('id', existing.id);
            }
            currentTeamId = existing.id;
            updated++;
          } else {
            skipped++;
            continue;
          }
        } else {
          try {
            const insRes = await queryOne(
              `INSERT INTO teams (
                team_code, team_name, problem_statement_id, problem_statement_title,
                organization, category, track, team_leader, team_members, contact_info,
                department, course, leader_phone, leader_email, leader_enrollment, submitter_email, raw_data
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
              RETURNING id`,
              [
                teamPayload.team_code, teamPayload.team_name, teamPayload.problem_statement_id,
                teamPayload.problem_statement_title, teamPayload.organization, teamPayload.category,
                teamPayload.track, teamPayload.team_leader, JSON.stringify(teamPayload.team_members),
                teamPayload.contact_info, teamPayload.department, teamPayload.course,
                teamPayload.leader_phone, teamPayload.leader_email, teamPayload.leader_enrollment,
                teamPayload.submitter_email, teamPayload.raw_data ? JSON.stringify(teamPayload.raw_data) : null,
              ]
            );
            currentTeamId = insRes?.id;
          } catch {
            const { data } = await supabaseAdmin.from('teams').insert(teamPayload).select('id').single();
            currentTeamId = data?.id;
          }
          created++;
          if (currentTeamId) insertedTeams.push(currentTeamId);
        }

        // Insert/update relational rows into master_team_member_details and team_members
        if (currentTeamId && Array.isArray(teamPayload.team_members) && teamPayload.team_members.length > 0) {
          try {
            await query('DELETE FROM team_members WHERE team_id = $1', [currentTeamId]);
            await query('DELETE FROM master_team_member_details WHERE team_id = $1', [currentTeamId]);

            for (const m of teamPayload.team_members) {
              const mContact = m.contact || m.phone || null;
              const mCourse = m.course || teamPayload.course || null;
              const mDept = m.department || teamPayload.department || null;
              const mYear = m.member_year || m.year || null;

              // Insert into team_members
              await query(
                `INSERT INTO team_members (
                  team_id, team_code, member_number, name, email, 
                  enrollment_number, gender, department, course, contact, academic_year, is_girl_member
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
                [
                  currentTeamId, teamPayload.team_code, m.member_number, m.name, 
                  m.email || null, m.enrollment_number || null, m.gender || null, 
                  mDept, mCourse, mContact, mYear, !!m.is_girl_member
                ]
              );

              // Insert into master_team_member_details
              await query(
                `INSERT INTO master_team_member_details (
                  team_id, team_code, member_number, member_name, member_email, 
                  member_enrolment, member_contact, member_department, member_course, member_year,
                  gender, is_girl_member
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
                [
                  currentTeamId, teamPayload.team_code, m.member_number, m.name, 
                  m.email || null, m.enrollment_number || null, mContact, 
                  mDept, mCourse, mYear, m.gender || null, !!m.is_girl_member
                ]
              );
            }
          } catch (mErr) {
            console.warn('Postgres member relational insert fallback to Supabase REST:', mErr.message);
            try {
              await supabaseAdmin.from('team_members').delete().eq('team_id', currentTeamId);
              await supabaseAdmin.from('master_team_member_details').delete().eq('team_id', currentTeamId);

              const memberInserts = teamPayload.team_members.map(m => ({
                team_id: currentTeamId,
                team_code: teamPayload.team_code,
                member_number: m.member_number,
                name: m.name,
                email: m.email || null,
                enrollment_number: m.enrollment_number || null,
                gender: m.gender || null,
                department: m.department || teamPayload.department || null,
                course: m.course || teamPayload.course || null,
                contact: m.contact || m.phone || null,
                academic_year: m.member_year || m.year || null,
                is_girl_member: !!m.is_girl_member,
              }));
              await supabaseAdmin.from('team_members').insert(memberInserts);

              const masterInserts = teamPayload.team_members.map(m => ({
                team_id: currentTeamId,
                team_code: teamPayload.team_code,
                member_number: m.member_number,
                member_name: m.name,
                member_email: m.email || null,
                member_enrolment: m.enrollment_number || null,
                member_contact: m.contact || m.phone || null,
                member_department: m.department || teamPayload.department || null,
                member_course: m.course || teamPayload.course || null,
                member_year: m.member_year || m.year || null,
                gender: m.gender || null,
                is_girl_member: !!m.is_girl_member,
              }));
              await supabaseAdmin.from('master_team_member_details').insert(masterInserts);
            } catch (supaErr) {
              console.warn('Supabase member relational insert fallback error:', supaErr.message);
            }
          }
        }
      } catch (e) {
        failed++;
        console.error('Record import error:', e);
        if (importRecord?.id) {
          try {
            await query(
              'INSERT INTO import_errors (import_id, row_number, error, raw_data) VALUES ($1, $2, $3, $4)',
              [importRecord.id, record._rowIndex || 0, e.message, JSON.stringify(record)]
            );
          } catch {}
        }
      }
    }

    // Auto-assign new teams across active jury members
    if (insertedTeams.length > 0) {
      try {
        let activeJuries = [];
        try {
          activeJuries = await queryAll("SELECT id FROM users WHERE role = 'JURY' AND status = 'active'");
        } catch {
          const { data } = await supabaseAdmin.from('users').select('id').eq('role', 'JURY').eq('status', 'active');
          activeJuries = data || [];
        }

        if (activeJuries.length > 0) {
          for (const teamId of insertedTeams) {
            for (const jury of activeJuries) {
              try {
                await query(
                  'INSERT INTO jury_assignments (user_id, team_id, assigned_by) VALUES ($1, $2, $3) ON CONFLICT (user_id, team_id) DO NOTHING',
                  [jury.id, teamId, req.user.id]
                );
              } catch {
                await supabaseAdmin.from('jury_assignments').upsert({
                  user_id: jury.id,
                  team_id: teamId,
                  assigned_by: req.user.id,
                }, { onConflict: 'user_id,team_id' });
              }
            }
          }
        }
      } catch (assignErr) {
        console.warn('Auto-assign post-import notice:', assignErr.message);
      }
    }

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
        { fileName, fileType, created, updated, skipped, failed }, getClientIp(req));
    } catch {}

    res.json({
      message: 'Import completed successfully',
      importId: importRecord?.id,
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
router.get('/templates/:format', authenticate, requireAdmin, (req, res) => {
  const format = req.params.format.toLowerCase();

  if (format === 'csv' || format === 'tsv') {
    const isTsv = format === 'tsv';
    const sep = isTsv ? '\t' : ',';
    const headers = [
      'Email Address', 'Department', 'Course', 'Team Name', 'Leader Contact Number',
      'Problem Code (SIH)( Like: SIHXXXXX)', 'Problem Statement   (SIH)',
      'Team Leader Name   ( Like:  Name -F.E.T)', 'Rama official Email id Leader', 'Enrollment Number (Team Leader)',
      'Member 1 - Girl     ( Like:  Name -F.E.T)', 'Email id  (Rama official) Member 1', 'Enrollment Number (Member 1)', 'Gender', 'Department',
      'Member 2     ( Like:  Name -F.E.T)', 'Gender', 'Email id (Rama official) Member 2', 'Enrollment Number (Member 2)', 'Department',
      'Member 3     ( Like:  Name -FET)', 'Gender', 'Email id (Rama offical ) Member 3', 'Enrollment Number (Member 3)', 'Department',
      'Member 4     ( Like:  Name -F.E.T)', 'Email id (Rama official) Member 4', 'Gender', 'Enrollment Number (Member 4)', 'Department',
      'Member 5  ( Like:  Name -F.E.T)', 'Email id (Rama offical )Member 5', 'Enrollment Number (Member 5)', 'Department'
    ];

    const row1 = [
      'leader@ramauniversity.ac.in', 'Computer Science & Engineering', 'B.Tech CSE', 'Code Mavericks', '9876543210',
      'SIH1523', 'AI Powered Real-time Traffic Management System',
      'Rahul Sharma - F.E.T', 'rahul.sharma@ramauniversity.ac.in', 'RU2022CSE045',
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

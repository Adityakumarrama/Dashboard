import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireAdmin, requireAny } from '../middleware/rbac.js';
import { query, queryOne, queryAll } from '../config/database.js';
import { buildPaginationQuery, paginationMeta, sanitize } from '../utils/helpers.js';
import { logAction, getClientIp } from '../services/auditService.js';
import { getTeamScores } from '../services/scoringService.js';
import supabaseAdmin from '../config/supabase.js';

const router = Router();

/**
 * GET /api/teams
 * List teams with pagination, filtering, and search
 */
router.get('/', authenticate, requireAny, async (req, res) => {
  try {
    const { page, limit, search, category, track, status } = req.query;
    const { limit: safeLimit, offset, page: safePage } = buildPaginationQuery(page, limit);

    try {
      let where = [];
      let params = [];
      let paramIdx = 1;

      if (search) {
        where.push(`(team_code ILIKE $${paramIdx} OR team_name ILIKE $${paramIdx} OR organization ILIKE $${paramIdx})`);
        params.push(`%${search}%`);
        paramIdx++;
      }
      if (category) {
        where.push(`category = $${paramIdx}`);
        params.push(category);
        paramIdx++;
      }
      if (track) {
        where.push(`track = $${paramIdx}`);
        params.push(track);
        paramIdx++;
      }
      if (status) {
        where.push(`registration_status = $${paramIdx}`);
        params.push(status);
        paramIdx++;
      }

      const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

      const countResult = await queryOne(`SELECT COUNT(*) as count FROM teams ${whereClause}`, params);
      const total = parseInt(countResult?.count || 0);

      const teams = await queryAll(
        `SELECT * FROM teams ${whereClause} ORDER BY created_at DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, safeLimit, offset]
      );

      return res.json({
        teams: teams || [],
        pagination: paginationMeta(total, safePage, safeLimit),
      });
    } catch (pgErr) {
      console.warn('Postgres query failed in GET /api/teams, falling back to Supabase REST client:', pgErr.message);

      let queryBuilder = supabaseAdmin.from('teams').select('*', { count: 'exact' });
      if (category) queryBuilder = queryBuilder.eq('category', category);
      if (track) queryBuilder = queryBuilder.eq('track', track);
      if (status) queryBuilder = queryBuilder.eq('registration_status', status);
      if (search) queryBuilder = queryBuilder.or(`team_code.ilike.%${search}%,team_name.ilike.%${search}%,organization.ilike.%${search}%`);

      const { data: supaTeams, count, error: supaErr } = await queryBuilder
        .order('created_at', { ascending: false })
        .range(offset, offset + safeLimit - 1);

      if (supaErr) throw supaErr;

      return res.json({
        teams: supaTeams || [],
        pagination: paginationMeta(count || (supaTeams?.length || 0), safePage, safeLimit),
      });
    }
  } catch (error) {
    console.error('List teams error:', error);
    res.status(500).json({ error: error.message || 'Failed to list teams', code: 'INTERNAL_ERROR' });
  }
});

async function getTeamMembersList(teamId, fallbackJson) {
  let members = [];
  try {
    members = await queryAll('SELECT * FROM team_members WHERE team_id = $1 ORDER BY member_number ASC', [teamId]);
  } catch {
    try {
      const { data } = await supabaseAdmin.from('team_members').select('*').eq('team_id', teamId).order('member_number', { ascending: true });
      members = data || [];
    } catch {}
  }
  if (members && members.length > 0) {
    return members;
  }
  if (fallbackJson) {
    if (typeof fallbackJson === 'string') {
      try { return JSON.parse(fallbackJson); } catch { return []; }
    }
    if (Array.isArray(fallbackJson)) return fallbackJson;
  }
  return [];
}

/**
 * GET /api/teams/lookup/:teamCode
 * Fast team code lookup for jury search
 */
router.get('/lookup/:teamCode', authenticate, requireAny, async (req, res) => {
  try {
    const teamCode = sanitize(req.params.teamCode);

    let team = null;
    try {
      team = await queryOne('SELECT * FROM teams WHERE team_code ILIKE $1', [teamCode]);
    } catch (pgErr) {
      console.warn('Postgres query failed in GET /lookup/:teamCode, falling back to Supabase REST:', pgErr.message);
      const { data } = await supabaseAdmin.from('teams').select('*').ilike('team_code', teamCode).maybeSingle();
      team = data;
    }

    if (!team) {
      return res.status(404).json({ error: 'Team not found', code: 'TEAM_NOT_FOUND' });
    }

    // Attach team members list
    team.team_members = await getTeamMembersList(team.id, team.team_members);

    // If jury, ensure team is assigned (auto-assign on-demand if needed)
    if (req.user.role === 'JURY') {
      let assignment = null;
      try {
        assignment = await queryOne(
          'SELECT id FROM jury_assignments WHERE user_id = $1 AND team_id = $2',
          [req.user.id, team.id]
        );
      } catch (pgErr) {
        console.warn('Postgres query failed in jury_assignments check, falling back to Supabase REST:', pgErr.message);
        const { data } = await supabaseAdmin
          .from('jury_assignments')
          .select('id')
          .eq('user_id', req.user.id)
          .eq('team_id', team.id)
          .maybeSingle();
        assignment = data;
      }

      if (!assignment) {
        // Automatically assign team to this jury member on-the-fly
        try {
          try {
            await query(
              'INSERT INTO jury_assignments (user_id, team_id, assigned_by) VALUES ($1, $2, $1) ON CONFLICT (user_id, team_id) DO NOTHING',
              [req.user.id, team.id]
            );
          } catch {
            await supabaseAdmin.from('jury_assignments').upsert({
              user_id: req.user.id,
              team_id: team.id,
              assigned_by: req.user.id,
            }, { onConflict: 'user_id,team_id' });
          }
        } catch (assignErr) {
          console.warn('Auto-assign on lookup notice:', assignErr.message);
        }
      }
    }

    res.json({ team });
  } catch (error) {
    console.error('Team lookup error:', error);
    res.status(500).json({ error: error.message || 'Failed to lookup team', code: 'INTERNAL_ERROR' });
  }
});

/**
 * GET /api/teams/:id
 * Get single team with evaluation data
 */
router.get('/:id', authenticate, requireAny, async (req, res) => {
  try {
    let team = null;
    try {
      team = await queryOne('SELECT * FROM teams WHERE id = $1', [req.params.id]);
    } catch (pgErr) {
      console.warn('Postgres query failed in GET /teams/:id, falling back to Supabase REST:', pgErr.message);
      const { data } = await supabaseAdmin.from('teams').select('*').eq('id', req.params.id).maybeSingle();
      team = data;
    }

    if (!team) {
      return res.status(404).json({ error: 'Team not found', code: 'NOT_FOUND' });
    }

    // Attach full team members list
    team.team_members = await getTeamMembersList(team.id, team.team_members);

    // Get evaluations for this team
    let evaluations = [];
    try {
      evaluations = await queryAll(
        `SELECT e.*, u.full_name as judge_name, u.judge_id
         FROM evaluations e
         JOIN users u ON e.user_id = u.id
         WHERE e.team_id = $1
         ORDER BY e.submitted_at DESC NULLS LAST`,
        [team.id]
      );

      // Get evaluation scores for submitted evaluations
      for (const evaluation of evaluations) {
        const scores = await queryAll(
          `SELECT es.*, sc.name as criteria_name, sc.max_score, sc.weight
           FROM evaluation_scores es
           JOIN scoring_criteria sc ON (COALESCE(es.criteria_id, es.criterion_id) = sc.id)
           WHERE es.evaluation_id = $1
           ORDER BY sc.sort_order`,
          [evaluation.id]
        );
        evaluation.scores = scores;
      }
    } catch (pgErr) {
      console.warn('Postgres query failed for team evaluations, falling back to Supabase REST:', pgErr.message);
      const { data: evals } = await supabaseAdmin
        .from('evaluations')
        .select('*, users(full_name, judge_id)')
        .eq('team_id', team.id)
        .order('submitted_at', { ascending: false });

      const { data: allCriteria } = await supabaseAdmin.from('scoring_criteria').select('*').order('sort_order');
      const criteriaMap = new Map((allCriteria || []).map(c => [c.id, c]));

      evaluations = [];
      for (const ev of (evals || [])) {
        const { data: scores } = await supabaseAdmin
          .from('evaluation_scores')
          .select('*')
          .eq('evaluation_id', ev.id);

        const mappedScores = (scores || []).map(s => {
          const crit = criteriaMap.get(s.criteria_id || s.criterion_id);
          return {
            ...s,
            criteria_name: crit?.name,
            max_score: crit?.max_score,
            weight: crit?.weight,
          };
        });

        evaluations.push({
          ...ev,
          judge_name: ev.users?.full_name,
          judge_id: ev.users?.judge_id,
          scores: mappedScores,
        });
      }
    }

    // Authoritative team statistics calculated by PostgreSQL view v_team_score_aggregates
    let stats = null;
    try {
      const teamAgg = await getTeamScores(team.id);
      stats = {
        totalJudges: evaluations.length,
        completedJudges: parseInt(teamAgg?.completed_judges || 0),
        averageScore: teamAgg?.aggregate_score !== null && teamAgg?.aggregate_score !== undefined ? parseFloat(teamAgg.aggregate_score).toFixed(1) : '—',
        weightedAverageScore: teamAgg?.weighted_aggregate_score !== null && teamAgg?.weighted_aggregate_score !== undefined ? parseFloat(teamAgg.weighted_aggregate_score).toFixed(1) : '—',
        highestScore: teamAgg?.highest_score !== null && teamAgg?.highest_score !== undefined ? parseFloat(teamAgg.highest_score).toFixed(1) : '—',
        lowestScore: teamAgg?.lowest_score !== null && teamAgg?.lowest_score !== undefined ? parseFloat(teamAgg.lowest_score).toFixed(1) : '—',
      };
    } catch {
      const submitted = evaluations.filter(e => e.status === 'submitted');
      const scores = submitted.map(e => parseFloat(e.total_score)).filter(s => !isNaN(s));
      stats = {
        totalJudges: evaluations.length,
        completedJudges: submitted.length,
        averageScore: scores.length > 0 ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : '—',
        weightedAverageScore: '—',
        highestScore: scores.length > 0 ? Math.max(...scores).toFixed(1) : '—',
        lowestScore: scores.length > 0 ? Math.min(...scores).toFixed(1) : '—',
      };
    }

    res.json({ team, evaluations, stats });
  } catch (error) {
    console.error('Get team error:', error);
    res.status(500).json({ error: error.message || 'Failed to get team', code: 'INTERNAL_ERROR' });
  }
});

/**
 * POST /api/teams
 * Create a new team
 */
router.post('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const {
      team_code, team_name, problem_statement_id, problem_statement_title,
      organization, category, track, team_leader, team_members, contact_info,
      department, course, leader_phone, leader_email, leader_enrollment, submitter_email,
    } = req.body;

    if (!team_code || !team_name) {
      return res.status(400).json({ error: 'Team code and name are required', code: 'VALIDATION_ERROR' });
    }

    const cleanCode = sanitize(team_code);
    const cleanName = sanitize(team_name);

    // Check for duplicate
    let existing = null;
    try {
      existing = await queryOne('SELECT id FROM teams WHERE team_code = $1', [cleanCode]);
    } catch {
      const { data } = await supabaseAdmin.from('teams').select('id').eq('team_code', cleanCode).maybeSingle();
      existing = data;
    }

    if (existing) {
      return res.status(409).json({ error: 'Team code already exists', code: 'DUPLICATE_TEAM_CODE' });
    }

    const teamPayload = {
      team_code: cleanCode,
      team_name: cleanName,
      problem_statement_id: problem_statement_id || null,
      problem_statement_title: problem_statement_title || null,
      organization: organization || 'Rama University (F.E.T)',
      category: category || 'Software',
      track: track || department || 'Technology',
      team_leader: team_leader || null,
      team_members: Array.isArray(team_members) ? team_members : [],
      contact_info: contact_info || (leader_email ? `${team_leader} | ${leader_email} | ${leader_phone || ''}` : null),
      department: department || null,
      course: course || null,
      leader_phone: leader_phone || null,
      leader_email: leader_email || null,
      leader_enrollment: leader_enrollment || null,
      submitter_email: submitter_email || null,
    };

    let team = null;
    try {
      team = await queryOne(
        `INSERT INTO teams (
          team_code, team_name, problem_statement_id, problem_statement_title,
          organization, category, track, team_leader, team_members, contact_info,
          department, course, leader_phone, leader_email, leader_enrollment, submitter_email
        )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         RETURNING *`,
        [
          cleanCode, cleanName, teamPayload.problem_statement_id,
          teamPayload.problem_statement_title, teamPayload.organization, teamPayload.category,
          teamPayload.track, teamPayload.team_leader,
          JSON.stringify(teamPayload.team_members), teamPayload.contact_info,
          teamPayload.department, teamPayload.course, teamPayload.leader_phone,
          teamPayload.leader_email, teamPayload.leader_enrollment, teamPayload.submitter_email,
        ]
      );
    } catch (pgErr) {
      console.warn('Postgres insert failed in POST /api/teams, falling back to Supabase REST client:', pgErr.message);
      const { data, error: supaErr } = await supabaseAdmin.from('teams').insert(teamPayload).select().single();
      if (supaErr) throw supaErr;
      team = data;
    }

    // Sync team_members table
    if (team?.id && Array.isArray(teamPayload.team_members) && teamPayload.team_members.length > 0) {
      try {
        await query('DELETE FROM team_members WHERE team_id = $1', [team.id]);
        for (const m of teamPayload.team_members) {
          await query(
            `INSERT INTO team_members (team_id, member_number, name, email, enrollment_number, gender, department, is_girl_member)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [team.id, m.member_number, m.name, m.email || null, m.enrollment_number || null, m.gender || null, m.department || null, !!m.is_girl_member]
          );
        }
      } catch {
        await supabaseAdmin.from('team_members').delete().eq('team_id', team.id);
        const memberRows = teamPayload.team_members.map(m => ({
          team_id: team.id,
          member_number: m.member_number,
          name: m.name,
          email: m.email || null,
          enrollment_number: m.enrollment_number || null,
          gender: m.gender || null,
          department: m.department || null,
          is_girl_member: !!m.is_girl_member,
        }));
        await supabaseAdmin.from('team_members').insert(memberRows);
      }
    }

    try {
      await logAction(req.user.id, 'team.created', 'team', team.id, { team_code: team.team_code }, getClientIp(req));
    } catch (logErr) {
      console.warn('Audit log error on team create:', logErr.message);
    }

    // Auto-assign new team to active juries based on jury count
    try {
      let activeJuries = [];
      try {
        activeJuries = await queryAll("SELECT id FROM users WHERE role = 'JURY' AND status = 'active' ORDER BY created_at");
      } catch {
        const { data } = await supabaseAdmin.from('users').select('id').eq('role', 'JURY').eq('status', 'active');
        activeJuries = data || [];
      }
      if (activeJuries && activeJuries.length > 0) {
        for (const j of activeJuries) {
          try {
            await query(
              'INSERT INTO jury_assignments (user_id, team_id, assigned_by) VALUES ($1, $2, $3) ON CONFLICT (user_id, team_id) DO NOTHING',
              [j.id, team.id, req.user.id]
            );
          } catch {
            await supabaseAdmin.from('jury_assignments').upsert({
              user_id: j.id,
              team_id: team.id,
              assigned_by: req.user.id,
            }, { onConflict: 'user_id,team_id' });
          }
        }
      }
    } catch (autoErr) {
      console.warn('Auto assign for new team notice:', autoErr.message);
    }

    res.status(201).json({ team });
  } catch (error) {
    console.error('Create team error:', error);
    res.status(500).json({ error: error.message || 'Failed to create team', code: 'INTERNAL_ERROR' });
  }
});

/**
 * PUT /api/teams/:id
 * Update a team
 */
router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    let existing = null;
    try {
      existing = await queryOne('SELECT * FROM teams WHERE id = $1', [req.params.id]);
    } catch {
      const { data } = await supabaseAdmin.from('teams').select('*').eq('id', req.params.id).maybeSingle();
      existing = data;
    }

    if (!existing) {
      return res.status(404).json({ error: 'Team not found', code: 'NOT_FOUND' });
    }

    const {
      team_code, team_name, problem_statement_id, problem_statement_title,
      organization, category, track, team_leader, team_members, contact_info,
      presentation_status, demo_status, registration_status,
      department, course, leader_phone, leader_email, leader_enrollment, submitter_email,
    } = req.body;

    // Check for duplicate code if changed
    if (team_code && team_code !== existing.team_code) {
      let dup = null;
      try {
        dup = await queryOne('SELECT id FROM teams WHERE team_code = $1 AND id != $2', [team_code, req.params.id]);
      } catch {
        const { data } = await supabaseAdmin.from('teams').select('id').eq('team_code', team_code).neq('id', req.params.id).maybeSingle();
        dup = data;
      }
      if (dup) {
        return res.status(409).json({ error: 'Team code already exists', code: 'DUPLICATE_TEAM_CODE' });
      }
    }

    let team = null;
    try {
      team = await queryOne(
        `UPDATE teams SET
          team_code = COALESCE($1, team_code),
          team_name = COALESCE($2, team_name),
          problem_statement_id = COALESCE($3, problem_statement_id),
          problem_statement_title = COALESCE($4, problem_statement_title),
          organization = COALESCE($5, organization),
          category = COALESCE($6, category),
          track = COALESCE($7, track),
          team_leader = COALESCE($8, team_leader),
          team_members = COALESCE($9, team_members),
          contact_info = COALESCE($10, contact_info),
          presentation_status = COALESCE($11, presentation_status),
          demo_status = COALESCE($12, demo_status),
          registration_status = COALESCE($13, registration_status),
          department = COALESCE($14, department),
          course = COALESCE($15, course),
          leader_phone = COALESCE($16, leader_phone),
          leader_email = COALESCE($17, leader_email),
          leader_enrollment = COALESCE($18, leader_enrollment),
          submitter_email = COALESCE($19, submitter_email)
         WHERE id = $20
         RETURNING *`,
        [
          team_code, team_name, problem_statement_id, problem_statement_title,
          organization, category, track, team_leader,
          team_members ? JSON.stringify(team_members) : null, contact_info,
          presentation_status, demo_status, registration_status,
          department, course, leader_phone, leader_email, leader_enrollment, submitter_email,
          req.params.id,
        ]
      );
    } catch (pgErr) {
      console.warn('Postgres update failed in PUT /api/teams/:id, falling back to Supabase REST client:', pgErr.message);
      const updateData = {};
      if (team_code !== undefined) updateData.team_code = team_code;
      if (team_name !== undefined) updateData.team_name = team_name;
      if (problem_statement_id !== undefined) updateData.problem_statement_id = problem_statement_id;
      if (problem_statement_title !== undefined) updateData.problem_statement_title = problem_statement_title;
      if (organization !== undefined) updateData.organization = organization;
      if (category !== undefined) updateData.category = category;
      if (track !== undefined) updateData.track = track;
      if (team_leader !== undefined) updateData.team_leader = team_leader;
      if (team_members !== undefined) updateData.team_members = team_members;
      if (contact_info !== undefined) updateData.contact_info = contact_info;
      if (presentation_status !== undefined) updateData.presentation_status = presentation_status;
      if (demo_status !== undefined) updateData.demo_status = demo_status;
      if (registration_status !== undefined) updateData.registration_status = registration_status;
      if (department !== undefined) updateData.department = department;
      if (course !== undefined) updateData.course = course;
      if (leader_phone !== undefined) updateData.leader_phone = leader_phone;
      if (leader_email !== undefined) updateData.leader_email = leader_email;
      if (leader_enrollment !== undefined) updateData.leader_enrollment = leader_enrollment;
      if (submitter_email !== undefined) updateData.submitter_email = submitter_email;

      const { data, error: supaErr } = await supabaseAdmin.from('teams').update(updateData).eq('id', req.params.id).select().single();
      if (supaErr) throw supaErr;
      team = data;
    }

    // Sync team_members table if provided
    if (team?.id && Array.isArray(team_members)) {
      try {
        await query('DELETE FROM team_members WHERE team_id = $1', [team.id]);
        for (const m of team_members) {
          await query(
            `INSERT INTO team_members (team_id, member_number, name, email, enrollment_number, gender, department, is_girl_member)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [team.id, m.member_number, m.name, m.email || null, m.enrollment_number || null, m.gender || null, m.department || null, !!m.is_girl_member]
          );
        }
      } catch {
        await supabaseAdmin.from('team_members').delete().eq('team_id', team.id);
        if (team_members.length > 0) {
          const memberRows = team_members.map(m => ({
            team_id: team.id,
            member_number: m.member_number,
            name: m.name,
            email: m.email || null,
            enrollment_number: m.enrollment_number || null,
            gender: m.gender || null,
            department: m.department || null,
            is_girl_member: !!m.is_girl_member,
          }));
          await supabaseAdmin.from('team_members').insert(memberRows);
        }
      }
    }

    team.team_members = await getTeamMembersList(team.id, team.team_members);

    try {
      await logAction(req.user.id, 'team.updated', 'team', team.id,
        { before: existing, after: team }, getClientIp(req));
    } catch (logErr) {
      console.warn('Audit log error on team update:', logErr.message);
    }

    res.json({ team });
  } catch (error) {
    console.error('Update team error:', error);
    res.status(500).json({ error: error.message || 'Failed to update team', code: 'INTERNAL_ERROR' });
  }
});

/**
 * DELETE /api/teams/:id
 * Permanently delete team and explicitly cascade all assignments, scores, and evaluations
 */
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    let team = null;
    try {
      team = await queryOne('SELECT * FROM teams WHERE id = $1', [req.params.id]);
    } catch {
      const { data } = await supabaseAdmin.from('teams').select('*').eq('id', req.params.id).maybeSingle();
      team = data;
    }

    if (!team) {
      return res.status(404).json({ error: 'Team not found', code: 'NOT_FOUND' });
    }

    // Explicitly cascade delete from dependent tables to guarantee safe deletion
    try {
      await query('DELETE FROM team_members WHERE team_id = $1', [req.params.id]);
      await query('DELETE FROM evaluation_scores WHERE team_id = $1', [req.params.id]);
      await query('DELETE FROM evaluation_score_history WHERE team_id = $1', [req.params.id]);
      await query('DELETE FROM evaluations WHERE team_id = $1', [req.params.id]);
      await query('DELETE FROM jury_assignments WHERE team_id = $1', [req.params.id]);
      await query('DELETE FROM teams WHERE id = $1', [req.params.id]);
    } catch (pgErr) {
      console.warn('Postgres delete failed in DELETE /api/teams/:id, falling back to Supabase REST client:', pgErr.message);
      await supabaseAdmin.from('team_members').delete().eq('team_id', req.params.id);
      await supabaseAdmin.from('evaluation_scores').delete().eq('team_id', req.params.id);
      await supabaseAdmin.from('evaluation_score_history').delete().eq('team_id', req.params.id);
      await supabaseAdmin.from('evaluations').delete().eq('team_id', req.params.id);
      await supabaseAdmin.from('jury_assignments').delete().eq('team_id', req.params.id);
      const { error: supaErr } = await supabaseAdmin.from('teams').delete().eq('id', req.params.id);
      if (supaErr) throw new Error(supaErr.message);
    }

    try {
      await logAction(req.user.id, 'team.deleted', 'team', req.params.id,
        { team_code: team.team_code, team_name: team.team_name }, getClientIp(req));
    } catch (logErr) {
      console.warn('Audit log error on team delete:', logErr.message);
    }

    res.json({ message: 'Team deleted successfully' });
  } catch (error) {
    console.error('Delete team error:', error);
    res.status(500).json({ error: error.message || 'Failed to delete team', code: 'INTERNAL_ERROR' });
  }
});

export default router;

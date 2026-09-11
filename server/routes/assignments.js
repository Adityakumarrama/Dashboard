import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/rbac.js';
import { query, queryOne, queryAll } from '../config/database.js';
import { isValidUUID } from '../utils/helpers.js';
import { validateUuidParams } from '../middleware/validateUuid.js';
import { logAction, getClientIp } from '../services/auditService.js';
import supabaseAdmin from '../config/supabase.js';

const router = Router();

/**
 * GET /api/assignments
 * List all assignments with jury and team details
 */
router.get('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const { jury_id } = req.query;

    try {
      let whereClause = '';
      let params = [];

      if (jury_id) {
        whereClause = 'WHERE ja.user_id = $1';
        params = [jury_id];
      }

      const assignments = await queryAll(
        `SELECT ja.*,
          u.full_name as jury_name, u.judge_id, u.email as jury_email,
          t.team_code, t.team_name, t.category, t.track, t.organization,
          CASE WHEN e.id IS NOT NULL THEN e.status ELSE 'not_started' END as eval_status,
          e.total_score
         FROM jury_assignments ja
         JOIN users u ON ja.user_id = u.id
         JOIN teams t ON ja.team_id = t.id
         LEFT JOIN evaluations e ON e.team_id = ja.team_id AND e.user_id = ja.user_id
         ${whereClause}
         ORDER BY u.full_name, t.team_code`,
        params
      );

      const jurySummary = await queryAll(
        `SELECT u.id, u.full_name, u.judge_id, u.email, u.status, u.username,
          COUNT(ja.id) as assigned_count,
          COUNT(CASE WHEN e.status = 'submitted' THEN 1 END) as completed_count,
          COUNT(CASE WHEN e.status IS NULL OR e.status != 'submitted' THEN 1 END) as pending_count,
          MAX(e.submitted_at) as last_activity
         FROM users u
         LEFT JOIN jury_assignments ja ON ja.user_id = u.id
         LEFT JOIN evaluations e ON e.team_id = ja.team_id AND e.user_id = u.id
         WHERE u.role = 'JURY'
         GROUP BY u.id, u.full_name, u.judge_id, u.email, u.status, u.username
         ORDER BY u.full_name`
      );

      return res.json({ assignments, jurySummary });
    } catch (pgErr) {
      console.warn('Postgres query failed in GET /api/assignments, falling back to Supabase REST:', pgErr.message);

      const [jaRes, usersRes, teamsRes, rawEvalsRes] = await Promise.all([
        jury_id
          ? supabaseAdmin.from('jury_assignments').select('*').eq('user_id', jury_id)
          : supabaseAdmin.from('jury_assignments').select('*'),
        supabaseAdmin.from('users').select('id, full_name, judge_id, email, role, status, username'),
        supabaseAdmin.from('teams').select('id, team_code, team_name, category, track, organization'),
        supabaseAdmin.from('evaluations').select('id, team_id, user_id, status, total_score, submitted_at'),
      ]);

      const userMap = new Map((usersRes.data || []).map(u => [u.id, u]));
      const teamMap = new Map((teamsRes.data || []).map(t => [t.id, t]));
      const rawEvals = rawEvalsRes.data || [];
      const evalMap = new Map(rawEvals.map(e => [`${e.team_id}_${e.user_id}`, e]));

      const rawAssignments = jaRes.data || [];
      const assignments = rawAssignments.map(ja => {
        const u = userMap.get(ja.user_id);
        const t = teamMap.get(ja.team_id);
        const ev = evalMap.get(`${ja.team_id}_${ja.user_id}`);
        return {
          ...ja,
          jury_name: u?.full_name,
          judge_id: u?.judge_id,
          jury_email: u?.email,
          team_code: t?.team_code,
          team_name: t?.team_name,
          category: t?.category,
          track: t?.track,
          organization: t?.organization,
          eval_status: ev ? ev.status : 'not_started',
          total_score: ev ? ev.total_score : null,
        };
      });

      const juryUsers = (usersRes.data || []).filter(u => u.role === 'JURY' || u.judge_id);

      const jurySummary = juryUsers.map(u => {
        const userAssignments = assignments.filter(a => a.user_id === u.id);
        const completed = userAssignments.filter(a => a.eval_status === 'submitted');
        const pending = userAssignments.length - completed.length;
        const userEvals = rawEvals.filter(e => e.user_id === u.id && e.status === 'submitted');
        const lastActivity = userEvals.length > 0
          ? userEvals.sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at))[0].submitted_at
          : null;
        return {
          id: u.id,
          full_name: u.full_name,
          judge_id: u.judge_id,
          email: u.email,
          status: u.status,
          username: u.username,
          assigned_count: userAssignments.length,
          completed_count: completed.length,
          pending_count: pending,
          last_activity: lastActivity,
        };
      });

      return res.json({ assignments, jurySummary });
    }
  } catch (error) {
    console.error('List assignments error:', error);
    res.status(500).json({ error: error.message || 'Failed to list assignments', code: 'INTERNAL_ERROR' });
  }
});

/**
 * POST /api/assignments
 * Create individual assignment
 */
router.post('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const { user_id, team_id } = req.body;

    if (!user_id || !team_id) {
      return res.status(400).json({ error: 'user_id and team_id are required', code: 'VALIDATION_ERROR' });
    }

    if (!isValidUUID(user_id) || !isValidUUID(team_id)) {
      return res.status(400).json({ error: 'user_id and team_id must be valid UUIDs', code: 'INVALID_UUID' });
    }

    // Verify jury member exists and is active
    let jury = null;
    try {
      jury = await queryOne('SELECT id, full_name FROM users WHERE id = $1 AND role = \'JURY\' AND status = \'active\'', [user_id]);
    } catch {
      const { data } = await supabaseAdmin.from('users').select('id, full_name').eq('id', user_id).eq('role', 'JURY').eq('status', 'active').maybeSingle();
      jury = data;
    }
    if (!jury) {
      return res.status(404).json({ error: 'Jury member not found or inactive', code: 'NOT_FOUND' });
    }

    // Verify team exists
    let team = null;
    try {
      team = await queryOne('SELECT id, team_code FROM teams WHERE id = $1', [team_id]);
    } catch {
      const { data } = await supabaseAdmin.from('teams').select('id, team_code').eq('id', team_id).maybeSingle();
      team = data;
    }
    if (!team) {
      return res.status(404).json({ error: 'Team not found', code: 'NOT_FOUND' });
    }

    // Check for existing assignment
    let existing = null;
    try {
      existing = await queryOne('SELECT id FROM jury_assignments WHERE user_id = $1 AND team_id = $2', [user_id, team_id]);
    } catch {
      const { data } = await supabaseAdmin.from('jury_assignments').select('id').eq('user_id', user_id).eq('team_id', team_id).maybeSingle();
      existing = data;
    }
    if (existing) {
      return res.status(409).json({ error: 'Team is already assigned to this jury member', code: 'DUPLICATE_ASSIGNMENT' });
    }

    let assignment = null;
    try {
      assignment = await queryOne(
        'INSERT INTO jury_assignments (user_id, team_id, assigned_by) VALUES ($1, $2, $3) RETURNING *',
        [user_id, team_id, req.user.id]
      );
    } catch (pgErr) {
      console.warn('Postgres insert failed in POST /api/assignments, falling back to Supabase REST:', pgErr.message);
      const { data, error: supaErr } = await supabaseAdmin
        .from('jury_assignments')
        .insert({ user_id, team_id, assigned_by: req.user.id })
        .select()
        .single();
      if (supaErr) throw supaErr;
      assignment = data;
    }

    try {
      await logAction(req.user.id, 'assignment.created', 'assignment', assignment.id,
        { jury: jury.full_name, team: team.team_code }, getClientIp(req));
    } catch (logErr) {
      console.warn('Audit log error on assignment create:', logErr.message);
    }

    res.status(201).json({ assignment });
  } catch (error) {
    console.error('Create assignment error:', error);
    res.status(500).json({ error: error.message || 'Failed to create assignment', code: 'INTERNAL_ERROR' });
  }
});

/**
 * POST /api/assignments/bulk
 * Bulk assign teams to a jury member
 */
router.post('/bulk', authenticate, requireAdmin, async (req, res) => {
  try {
    const { user_id, team_ids } = req.body;

    if (!user_id || !Array.isArray(team_ids) || team_ids.length === 0) {
      return res.status(400).json({ error: 'user_id and team_ids array are required', code: 'VALIDATION_ERROR' });
    }

    let jury = null;
    try {
      jury = await queryOne('SELECT id, full_name FROM users WHERE id = $1 AND role = \'JURY\' AND status = \'active\'', [user_id]);
    } catch {
      const { data } = await supabaseAdmin.from('users').select('id, full_name').eq('id', user_id).eq('role', 'JURY').eq('status', 'active').maybeSingle();
      jury = data;
    }
    if (!jury) {
      return res.status(404).json({ error: 'Jury member not found or inactive', code: 'NOT_FOUND' });
    }

    let created = 0;
    let skipped = 0;

    for (const team_id of team_ids) {
      try {
        try {
          await query(
            'INSERT INTO jury_assignments (user_id, team_id, assigned_by) VALUES ($1, $2, $3) ON CONFLICT (user_id, team_id) DO NOTHING',
            [user_id, team_id, req.user.id]
          );
        } catch {
          await supabaseAdmin
            .from('jury_assignments')
            .upsert({ user_id, team_id, assigned_by: req.user.id }, { onConflict: 'user_id,team_id' });
        }
        created++;
      } catch {
        skipped++;
      }
    }

    try {
      await logAction(req.user.id, 'assignment.bulk_created', 'assignment', null,
        { jury: jury.full_name, total: team_ids.length, created, skipped }, getClientIp(req));
    } catch (logErr) {
      console.warn('Audit log error on bulk assignment:', logErr.message);
    }

    res.status(201).json({ message: 'Bulk assignment completed', created, skipped });
  } catch (error) {
    console.error('Bulk assignment error:', error);
    res.status(500).json({ error: error.message || 'Failed to bulk assign', code: 'INTERNAL_ERROR' });
  }
});

/**
 * POST /api/assignments/auto-assign
 * Automatically distribute teams among active jury members depending on how many jury members exist
 */
router.post('/auto-assign', authenticate, requireAdmin, async (req, res) => {
  try {
    const { mode = 'round_robin', judges_per_team = 1, team_ids } = req.body;

    // 1. Fetch all active jury members
    let juries = [];
    try {
      juries = await queryAll("SELECT id, full_name, judge_id FROM users WHERE role = 'JURY' AND status = 'active' ORDER BY created_at");
    } catch {
      const { data } = await supabaseAdmin.from('users').select('id, full_name, judge_id').eq('role', 'JURY').eq('status', 'active').order('created_at');
      juries = data || [];
    }

    if (!juries || juries.length === 0) {
      return res.status(400).json({ error: 'No active jury members found to assign teams to', code: 'NO_JURIES' });
    }

    // 2. Fetch teams to assign
    let teams = [];
    try {
      if (Array.isArray(team_ids) && team_ids.length > 0) {
        teams = await queryAll('SELECT id, team_code FROM teams WHERE id = ANY($1) ORDER BY team_code', [team_ids]);
      } else {
        teams = await queryAll('SELECT id, team_code FROM teams ORDER BY team_code');
      }
    } catch {
      let q = supabaseAdmin.from('teams').select('id, team_code').order('team_code');
      if (Array.isArray(team_ids) && team_ids.length > 0) {
        q = q.in('id', team_ids);
      }
      const { data } = await q;
      teams = data || [];
    }

    if (!teams || teams.length === 0) {
      return res.status(400).json({ error: 'No teams found to assign', code: 'NO_TEAMS' });
    }

    let created = 0;
    const assignmentsToInsert = [];

    if (mode === 'all') {
      // Assign every team to every jury member
      for (const team of teams) {
        for (const jury of juries) {
          assignmentsToInsert.push({ user_id: jury.id, team_id: team.id });
        }
      }
    } else {
      // Round-robin / balanced distribution depending on jury count
      // If mode is round_robin and judges_per_team is 1:
      // Each team goes to jury[i % juries.length]
      const k = Math.min(Math.max(parseInt(judges_per_team) || 1, 1), juries.length);
      for (let i = 0; i < teams.length; i++) {
        const team = teams[i];
        for (let j = 0; j < k; j++) {
          const juryIndex = (i * k + j) % juries.length;
          assignmentsToInsert.push({ user_id: juries[juryIndex].id, team_id: team.id });
        }
      }
    }

    for (const item of assignmentsToInsert) {
      try {
        try {
          await query(
            'INSERT INTO jury_assignments (user_id, team_id, assigned_by) VALUES ($1, $2, $3) ON CONFLICT (user_id, team_id) DO NOTHING',
            [item.user_id, item.team_id, req.user.id]
          );
        } catch {
          await supabaseAdmin
            .from('jury_assignments')
            .upsert({ user_id: item.user_id, team_id: item.team_id, assigned_by: req.user.id }, { onConflict: 'user_id,team_id' });
        }
        created++;
      } catch (err) {
        console.warn('Auto-assign insert notice:', err.message);
      }
    }

    try {
      await logAction(req.user.id, 'assignment.auto_assigned', 'assignment', null,
        { total_teams: teams.length, total_juries: juries.length, created, mode },
        getClientIp(req));
    } catch (logErr) {
      console.warn('Audit log error on auto-assign:', logErr.message);
    }

    res.status(201).json({
      message: `Auto-assigned ${teams.length} teams across ${juries.length} jury members (${created} assignments generated).`,
      total_teams: teams.length,
      total_juries: juries.length,
      created,
    });
  } catch (error) {
    console.error('Auto assign error:', error);
    res.status(500).json({ error: error.message || 'Failed to auto-assign teams', code: 'INTERNAL_ERROR' });
  }
});

/**
 * DELETE /api/assignments/:id
 * Remove an assignment
 */
router.delete('/:id', authenticate, requireAdmin, validateUuidParams('id'), async (req, res) => {
  try {
    let assignment = null;
    try {
      assignment = await queryOne(
        `SELECT ja.*, u.full_name as jury_name, t.team_code
         FROM jury_assignments ja
         JOIN users u ON ja.user_id = u.id
         JOIN teams t ON ja.team_id = t.id
         WHERE ja.id = $1`,
        [req.params.id]
      );
    } catch {
      const { data: jaData } = await supabaseAdmin
        .from('jury_assignments')
        .select('*')
        .eq('id', req.params.id)
        .maybeSingle();
      if (jaData) {
        const [uRes, tRes] = await Promise.all([
          supabaseAdmin.from('users').select('full_name').eq('id', jaData.user_id).maybeSingle(),
          supabaseAdmin.from('teams').select('team_code').eq('id', jaData.team_id).maybeSingle(),
        ]);
        assignment = {
          ...jaData,
          jury_name: uRes.data?.full_name,
          team_code: tRes.data?.team_code,
        };
      }
    }

    if (!assignment) {
      return res.status(404).json({ error: 'Assignment not found', code: 'NOT_FOUND' });
    }

    try {
      await query('DELETE FROM jury_assignments WHERE id = $1', [req.params.id]);
    } catch (pgErr) {
      console.warn('Postgres delete failed in DELETE /api/assignments/:id, falling back to Supabase REST:', pgErr.message);
      const { error: supaErr } = await supabaseAdmin.from('jury_assignments').delete().eq('id', req.params.id);
      if (supaErr) throw supaErr;
    }

    try {
      await logAction(req.user.id, 'assignment.deleted', 'assignment', req.params.id,
        { jury: assignment.jury_name, team: assignment.team_code }, getClientIp(req));
    } catch (logErr) {
      console.warn('Audit log error on delete assignment:', logErr.message);
    }

    res.json({ message: 'Assignment removed successfully' });
  } catch (error) {
    console.error('Delete assignment error:', error);
    res.status(500).json({ error: error.message || 'Failed to remove assignment', code: 'INTERNAL_ERROR' });
  }
});

export default router;

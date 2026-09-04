import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/rbac.js';
import { query, queryOne, queryAll } from '../config/database.js';
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
        `SELECT u.id, u.full_name, u.judge_id, u.email,
          COUNT(ja.id) as assigned_count,
          COUNT(CASE WHEN e.status = 'submitted' THEN 1 END) as completed_count,
          COUNT(CASE WHEN e.status IS NULL OR e.status != 'submitted' THEN 1 END) as pending_count,
          MAX(e.submitted_at) as last_activity
         FROM users u
         LEFT JOIN jury_assignments ja ON ja.user_id = u.id
         LEFT JOIN evaluations e ON e.team_id = ja.team_id AND e.user_id = u.id
         WHERE u.role = 'JURY' AND u.status = 'active'
         GROUP BY u.id, u.full_name, u.judge_id, u.email
         ORDER BY u.full_name`
      );

      return res.json({ assignments, jurySummary });
    } catch (pgErr) {
      console.warn('Postgres query failed in GET /api/assignments, falling back to Supabase REST:', pgErr.message);

      let queryBuilder = supabaseAdmin
        .from('jury_assignments')
        .select('*, users(id, full_name, judge_id, email), teams(id, team_code, team_name, category, track, organization)');
      if (jury_id) {
        queryBuilder = queryBuilder.eq('user_id', jury_id);
      }
      const { data: rawAssignments } = await queryBuilder;

      const { data: rawEvals } = await supabaseAdmin
        .from('evaluations')
        .select('id, team_id, user_id, status, total_score, submitted_at');

      const evalMap = new Map((rawEvals || []).map(e => [`${e.team_id}_${e.user_id}`, e]));

      const assignments = (rawAssignments || []).map(ja => {
        const ev = evalMap.get(`${ja.team_id}_${ja.user_id}`);
        return {
          ...ja,
          jury_name: ja.users?.full_name,
          judge_id: ja.users?.judge_id,
          jury_email: ja.users?.email,
          team_code: ja.teams?.team_code,
          team_name: ja.teams?.team_name,
          category: ja.teams?.category,
          track: ja.teams?.track,
          organization: ja.teams?.organization,
          eval_status: ev ? ev.status : 'not_started',
          total_score: ev ? ev.total_score : null,
        };
      });

      const { data: juryUsers } = await supabaseAdmin
        .from('users')
        .select('id, full_name, judge_id, email')
        .eq('role', 'JURY')
        .eq('status', 'active');

      const jurySummary = (juryUsers || []).map(u => {
        const userAssignments = assignments.filter(a => a.user_id === u.id);
        const completed = userAssignments.filter(a => a.eval_status === 'submitted');
        const pending = userAssignments.length - completed.length;
        return {
          id: u.id,
          full_name: u.full_name,
          judge_id: u.judge_id,
          email: u.email,
          assigned_count: userAssignments.length,
          completed_count: completed.length,
          pending_count: pending,
          last_activity: null,
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
 * DELETE /api/assignments/:id
 * Remove an assignment
 */
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
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
      const { data } = await supabaseAdmin
        .from('jury_assignments')
        .select('*, users(full_name), teams(team_code)')
        .eq('id', req.params.id)
        .maybeSingle();
      if (data) {
        assignment = {
          ...data,
          jury_name: data.users?.full_name,
          team_code: data.teams?.team_code,
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

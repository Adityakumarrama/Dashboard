import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/rbac.js';
import { query, queryOne, queryAll } from '../config/database.js';
import { logAction, getClientIp } from '../services/auditService.js';

const router = Router();

/**
 * GET /api/assignments
 * List all assignments with jury and team details
 */
router.get('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const { jury_id } = req.query;

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

    // Group by jury member for summary
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

    res.json({ assignments, jurySummary });
  } catch (error) {
    console.error('List assignments error:', error);
    res.status(500).json({ error: 'Failed to list assignments', code: 'INTERNAL_ERROR' });
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
    const jury = await queryOne('SELECT id, full_name FROM users WHERE id = $1 AND role = \'JURY\' AND status = \'active\'', [user_id]);
    if (!jury) {
      return res.status(404).json({ error: 'Jury member not found or inactive', code: 'NOT_FOUND' });
    }

    // Verify team exists
    const team = await queryOne('SELECT id, team_code FROM teams WHERE id = $1', [team_id]);
    if (!team) {
      return res.status(404).json({ error: 'Team not found', code: 'NOT_FOUND' });
    }

    // Check for existing assignment
    const existing = await queryOne('SELECT id FROM jury_assignments WHERE user_id = $1 AND team_id = $2', [user_id, team_id]);
    if (existing) {
      return res.status(409).json({ error: 'Team is already assigned to this jury member', code: 'DUPLICATE_ASSIGNMENT' });
    }

    const assignment = await queryOne(
      'INSERT INTO jury_assignments (user_id, team_id, assigned_by) VALUES ($1, $2, $3) RETURNING *',
      [user_id, team_id, req.user.id]
    );

    await logAction(req.user.id, 'assignment.created', 'assignment', assignment.id,
      { jury: jury.full_name, team: team.team_code }, getClientIp(req));

    res.status(201).json({ assignment });
  } catch (error) {
    console.error('Create assignment error:', error);
    res.status(500).json({ error: 'Failed to create assignment', code: 'INTERNAL_ERROR' });
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

    const jury = await queryOne('SELECT id, full_name FROM users WHERE id = $1 AND role = \'JURY\' AND status = \'active\'', [user_id]);
    if (!jury) {
      return res.status(404).json({ error: 'Jury member not found or inactive', code: 'NOT_FOUND' });
    }

    let created = 0;
    let skipped = 0;

    for (const team_id of team_ids) {
      try {
        await query(
          'INSERT INTO jury_assignments (user_id, team_id, assigned_by) VALUES ($1, $2, $3) ON CONFLICT (user_id, team_id) DO NOTHING',
          [user_id, team_id, req.user.id]
        );
        created++;
      } catch {
        skipped++;
      }
    }

    await logAction(req.user.id, 'assignment.bulk_created', 'assignment', null,
      { jury: jury.full_name, total: team_ids.length, created, skipped }, getClientIp(req));

    res.status(201).json({ message: 'Bulk assignment completed', created, skipped });
  } catch (error) {
    console.error('Bulk assignment error:', error);
    res.status(500).json({ error: 'Failed to bulk assign', code: 'INTERNAL_ERROR' });
  }
});

/**
 * DELETE /api/assignments/:id
 * Remove an assignment
 */
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const assignment = await queryOne(
      `SELECT ja.*, u.full_name as jury_name, t.team_code
       FROM jury_assignments ja
       JOIN users u ON ja.user_id = u.id
       JOIN teams t ON ja.team_id = t.id
       WHERE ja.id = $1`,
      [req.params.id]
    );

    if (!assignment) {
      return res.status(404).json({ error: 'Assignment not found', code: 'NOT_FOUND' });
    }

    await query('DELETE FROM jury_assignments WHERE id = $1', [req.params.id]);

    await logAction(req.user.id, 'assignment.deleted', 'assignment', req.params.id,
      { jury: assignment.jury_name, team: assignment.team_code }, getClientIp(req));

    res.json({ message: 'Assignment removed successfully' });
  } catch (error) {
    console.error('Delete assignment error:', error);
    res.status(500).json({ error: 'Failed to remove assignment', code: 'INTERNAL_ERROR' });
  }
});

export default router;

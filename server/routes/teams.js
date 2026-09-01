import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireAdmin, requireAny } from '../middleware/rbac.js';
import { query, queryOne, queryAll } from '../config/database.js';
import { buildPaginationQuery, paginationMeta, sanitize } from '../utils/helpers.js';
import { logAction, getClientIp } from '../services/auditService.js';

const router = Router();

/**
 * GET /api/teams
 * List teams with pagination, filtering, and search
 */
router.get('/', authenticate, requireAny, async (req, res) => {
  try {
    const { page, limit, search, category, track, status } = req.query;
    const { limit: safeLimit, offset, page: safePage } = buildPaginationQuery(page, limit);

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
    const total = parseInt(countResult.count);

    const teams = await queryAll(
      `SELECT * FROM teams ${whereClause} ORDER BY created_at DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, safeLimit, offset]
    );

    res.json({
      teams,
      pagination: paginationMeta(total, safePage, safeLimit),
    });
  } catch (error) {
    console.error('List teams error:', error);
    res.status(500).json({ error: 'Failed to list teams', code: 'INTERNAL_ERROR' });
  }
});

/**
 * GET /api/teams/lookup/:teamCode
 * Fast team code lookup for jury search
 */
router.get('/lookup/:teamCode', authenticate, requireAny, async (req, res) => {
  try {
    const teamCode = sanitize(req.params.teamCode);

    const team = await queryOne('SELECT * FROM teams WHERE team_code = $1', [teamCode]);

    if (!team) {
      return res.status(404).json({ error: 'Team not found', code: 'TEAM_NOT_FOUND' });
    }

    // If jury, check assignment
    if (req.user.role === 'JURY') {
      const assignment = await queryOne(
        'SELECT id FROM jury_assignments WHERE user_id = $1 AND team_id = $2',
        [req.user.id, team.id]
      );
      if (!assignment) {
        return res.status(403).json({
          error: 'This team is not assigned to you',
          code: 'NOT_ASSIGNED',
        });
      }
    }

    res.json({ team });
  } catch (error) {
    console.error('Team lookup error:', error);
    res.status(500).json({ error: 'Failed to lookup team', code: 'INTERNAL_ERROR' });
  }
});

/**
 * GET /api/teams/:id
 * Get single team with evaluation data
 */
router.get('/:id', authenticate, requireAny, async (req, res) => {
  try {
    const team = await queryOne('SELECT * FROM teams WHERE id = $1', [req.params.id]);

    if (!team) {
      return res.status(404).json({ error: 'Team not found', code: 'NOT_FOUND' });
    }

    // Get evaluations for this team
    const evaluations = await queryAll(
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
         JOIN scoring_criteria sc ON es.criteria_id = sc.id
         WHERE es.evaluation_id = $1
         ORDER BY sc.sort_order`,
        [evaluation.id]
      );
      evaluation.scores = scores;
    }

    res.json({ team, evaluations });
  } catch (error) {
    console.error('Get team error:', error);
    res.status(500).json({ error: 'Failed to get team', code: 'INTERNAL_ERROR' });
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
    } = req.body;

    if (!team_code || !team_name) {
      return res.status(400).json({ error: 'Team code and name are required', code: 'VALIDATION_ERROR' });
    }

    // Check for duplicate
    const existing = await queryOne('SELECT id FROM teams WHERE team_code = $1', [team_code]);
    if (existing) {
      return res.status(409).json({ error: 'Team code already exists', code: 'DUPLICATE_TEAM_CODE' });
    }

    const team = await queryOne(
      `INSERT INTO teams (team_code, team_name, problem_statement_id, problem_statement_title,
        organization, category, track, team_leader, team_members, contact_info)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        sanitize(team_code), sanitize(team_name), problem_statement_id || null,
        problem_statement_title || null, organization || null, category || null,
        track || null, team_leader || null,
        team_members ? JSON.stringify(team_members) : '[]', contact_info || null,
      ]
    );

    await logAction(req.user.id, 'team.created', 'team', team.id, { team_code: team.team_code }, getClientIp(req));

    res.status(201).json({ team });
  } catch (error) {
    console.error('Create team error:', error);
    res.status(500).json({ error: 'Failed to create team', code: 'INTERNAL_ERROR' });
  }
});

/**
 * PUT /api/teams/:id
 * Update a team
 */
router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const existing = await queryOne('SELECT * FROM teams WHERE id = $1', [req.params.id]);
    if (!existing) {
      return res.status(404).json({ error: 'Team not found', code: 'NOT_FOUND' });
    }

    const {
      team_code, team_name, problem_statement_id, problem_statement_title,
      organization, category, track, team_leader, team_members, contact_info,
      presentation_status, demo_status, registration_status,
    } = req.body;

    // Check for duplicate code if changed
    if (team_code && team_code !== existing.team_code) {
      const dup = await queryOne('SELECT id FROM teams WHERE team_code = $1 AND id != $2', [team_code, req.params.id]);
      if (dup) {
        return res.status(409).json({ error: 'Team code already exists', code: 'DUPLICATE_TEAM_CODE' });
      }
    }

    const team = await queryOne(
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
        registration_status = COALESCE($13, registration_status)
       WHERE id = $14
       RETURNING *`,
      [
        team_code, team_name, problem_statement_id, problem_statement_title,
        organization, category, track, team_leader,
        team_members ? JSON.stringify(team_members) : null, contact_info,
        presentation_status, demo_status, registration_status, req.params.id,
      ]
    );

    await logAction(req.user.id, 'team.updated', 'team', team.id,
      { before: existing, after: team }, getClientIp(req));

    res.json({ team });
  } catch (error) {
    console.error('Update team error:', error);
    res.status(500).json({ error: 'Failed to update team', code: 'INTERNAL_ERROR' });
  }
});

/**
 * DELETE /api/teams/:id
 */
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const team = await queryOne('SELECT * FROM teams WHERE id = $1', [req.params.id]);
    if (!team) {
      return res.status(404).json({ error: 'Team not found', code: 'NOT_FOUND' });
    }

    await query('DELETE FROM teams WHERE id = $1', [req.params.id]);

    await logAction(req.user.id, 'team.deleted', 'team', req.params.id,
      { team_code: team.team_code, team_name: team.team_name }, getClientIp(req));

    res.json({ message: 'Team deleted successfully' });
  } catch (error) {
    console.error('Delete team error:', error);
    res.status(500).json({ error: 'Failed to delete team', code: 'INTERNAL_ERROR' });
  }
});

export default router;

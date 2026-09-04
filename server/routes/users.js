import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/rbac.js';
import { query, queryOne, queryAll } from '../config/database.js';
import { buildPaginationQuery, paginationMeta, sanitize } from '../utils/helpers.js';
import { logAction, getClientIp } from '../services/auditService.js';
import supabaseAdmin from '../config/supabase.js';

const router = Router();

/**
 * GET /api/users
 * List all users with pagination and filtering
 */
router.get('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const { page, limit, search, role, status } = req.query;
    const { limit: safeLimit, offset, page: safePage } = buildPaginationQuery(page, limit);

    let where = [];
    let params = [];
    let paramIdx = 1;

    if (search) {
      where.push(`(full_name ILIKE $${paramIdx} OR email ILIKE $${paramIdx} OR username ILIKE $${paramIdx})`);
      params.push(`%${search}%`);
      paramIdx++;
    }
    if (role) {
      where.push(`role = $${paramIdx}`);
      params.push(role);
      paramIdx++;
    }
    if (status) {
      where.push(`status = $${paramIdx}`);
      params.push(status);
      paramIdx++;
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const countResult = await queryOne(`SELECT COUNT(*) as count FROM users ${whereClause}`, params);
    const total = parseInt(countResult.count);

    const users = await queryAll(
      `SELECT u.*,
        (SELECT COUNT(*) FROM jury_assignments ja WHERE ja.user_id = u.id) as assigned_teams,
        (SELECT COUNT(*) FROM evaluations e WHERE e.user_id = u.id AND e.status = 'submitted') as evaluations_completed
       FROM users u ${whereClause}
       ORDER BY u.created_at DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, safeLimit, offset]
    );

    // Remove sensitive fields
    const safeUsers = users.map(u => {
      const { auth_id, ...rest } = u;
      return rest;
    });

    res.json({
      users: safeUsers,
      pagination: paginationMeta(total, safePage, safeLimit),
    });
  } catch (error) {
    console.error('List users error:', error);
    res.status(500).json({ error: 'Failed to list users', code: 'INTERNAL_ERROR' });
  }
});

/**
 * GET /api/users/:id
 */
router.get('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const user = await queryOne(
      `SELECT u.*,
        (SELECT COUNT(*) FROM jury_assignments ja WHERE ja.user_id = u.id) as assigned_teams,
        (SELECT COUNT(*) FROM evaluations e WHERE e.user_id = u.id AND e.status = 'submitted') as evaluations_completed
       FROM users u WHERE u.id = $1`,
      [req.params.id]
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' });
    }

    const { auth_id, ...safeUser } = user;
    res.json({ user: safeUser });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user', code: 'INTERNAL_ERROR' });
  }
});

/**
 * POST /api/users
 * Create a new user (also creates in Supabase Auth)
 */
router.post('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const { email, password, username, full_name, role, judge_id } = req.body;

    if (!email || !password || !username || !full_name || !role) {
      return res.status(400).json({ error: 'Missing required fields', code: 'VALIDATION_ERROR' });
    }

    if (!['ADMIN', 'JURY'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Must be ADMIN or JURY', code: 'VALIDATION_ERROR' });
    }

    // Check duplicates
    const existingUser = await queryOne('SELECT id FROM users WHERE username = $1 OR email = $2', [username, email]);
    if (existingUser) {
      return res.status(409).json({ error: 'Username or email already exists', code: 'DUPLICATE_USER' });
    }

    // Create in Supabase Auth
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (authError || !authData?.user) {
      return res.status(400).json({
        error: `Auth error: ${authError?.message || 'Failed to create auth user in Supabase'}`,
        code: 'AUTH_ERROR',
      });
    }

    // Create in our users table
    const user = await queryOne(
      `INSERT INTO users (auth_id, username, email, full_name, role, judge_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, username, email, full_name, role, judge_id, status, created_at`,
      [authData.user.id, sanitize(username), email.toLowerCase(), sanitize(full_name), role, judge_id || null]
    );

    if (req.user?.id) {
      await logAction(req.user.id, 'user.created', 'user', user.id,
        { username: user.username, role: user.role }, getClientIp(req));
    }

    res.status(201).json({ user });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Failed to create user', code: 'INTERNAL_ERROR' });
  }
});

/**
 * PUT /api/users/:id
 * Update user
 */
router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const existing = await queryOne('SELECT * FROM users WHERE id = $1', [req.params.id]);
    if (!existing) {
      return res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' });
    }

    const { full_name, role, judge_id, status } = req.body;

    const user = await queryOne(
      `UPDATE users SET
        full_name = COALESCE($1, full_name),
        role = COALESCE($2, role),
        judge_id = COALESCE($3, judge_id),
        status = COALESCE($4, status)
       WHERE id = $5
       RETURNING id, username, email, full_name, role, judge_id, status, created_at, updated_at`,
      [full_name, role, judge_id, status, req.params.id]
    );

    await logAction(req.user.id, 'user.updated', 'user', user.id,
      { before: { full_name: existing.full_name, role: existing.role, status: existing.status },
        after: { full_name: user.full_name, role: user.role, status: user.status } },
      getClientIp(req));

    res.json({ user });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Failed to update user', code: 'INTERNAL_ERROR' });
  }
});

/**
 * DELETE /api/users/:id
 * Soft-delete (deactivate) user
 */
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const user = await queryOne('SELECT * FROM users WHERE id = $1', [req.params.id]);
    if (!user) {
      return res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' });
    }

    // Prevent deleting yourself
    if (user.id === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account', code: 'SELF_DELETE' });
    }

    // Get stats for confirmation
    const evalCount = await queryOne(
      'SELECT COUNT(*) as count FROM evaluations WHERE user_id = $1 AND status = \'submitted\'',
      [req.params.id]
    );
    const pendingCount = await queryOne(
      'SELECT COUNT(*) as count FROM jury_assignments WHERE user_id = $1',
      [req.params.id]
    );

    // Soft delete - deactivate user
    await query('UPDATE users SET status = \'inactive\' WHERE id = $1', [req.params.id]);

    // Disable in Supabase Auth if they have auth_id
    if (user.auth_id) {
      try {
        await supabaseAdmin.auth.admin.updateUserById(user.auth_id, { ban_duration: 'none' });
      } catch (e) {
        console.error('Failed to disable Supabase auth user:', e.message);
      }
    }

    await logAction(req.user.id, 'user.deleted', 'user', req.params.id,
      { username: user.username, submitted_evaluations: evalCount.count, assignments: pendingCount.count },
      getClientIp(req));

    res.json({
      message: 'User deactivated successfully',
      stats: {
        submittedEvaluations: parseInt(evalCount.count),
        assignments: parseInt(pendingCount.count),
      },
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user', code: 'INTERNAL_ERROR' });
  }
});

export default router;

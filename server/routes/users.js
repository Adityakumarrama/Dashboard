import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/rbac.js';
import { query, queryOne, queryAll } from '../config/database.js';
import { buildPaginationQuery, paginationMeta, sanitize, validatePasswordStrength } from '../utils/helpers.js';
import { validateUuidParams } from '../middleware/validateUuid.js';
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

    try {
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
      const total = parseInt(countResult?.count || 0);

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

      return res.json({
        users: safeUsers,
        pagination: paginationMeta(total, safePage, safeLimit),
      });
    } catch (pgError) {
      console.warn('Postgres query failed in GET /api/users, falling back to Supabase REST client:', pgError.message);
      let queryBuilder = supabaseAdmin.from('users').select('*', { count: 'exact' });
      if (role) queryBuilder = queryBuilder.eq('role', role);
      if (status) queryBuilder = queryBuilder.eq('status', status);
      if (search) queryBuilder = queryBuilder.ilike('full_name', `%${search}%`);

      const [usersResult, jaRes, evalsRes] = await Promise.all([
        queryBuilder
          .order('created_at', { ascending: false })
          .range(offset, offset + safeLimit - 1),
        supabaseAdmin.from('jury_assignments').select('id, user_id'),
        supabaseAdmin.from('evaluations').select('id, user_id, status').eq('status', 'submitted'),
      ]);

      const { data: supaUsers, count, error: supaErr } = usersResult;
      if (supaErr) throw supaErr;

      const jaList = jaRes.data || [];
      const evalsList = evalsRes.data || [];

      const safeUsers = (supaUsers || []).map(u => {
        const { auth_id, ...rest } = u;
        const assigned_teams = jaList.filter(ja => ja.user_id === u.id).length;
        const evaluations_completed = evalsList.filter(e => e.user_id === u.id).length;
        return { ...rest, assigned_teams, evaluations_completed };
      });

      return res.json({
        users: safeUsers,
        pagination: paginationMeta(count || safeUsers.length, safePage, safeLimit),
      });
    }
  } catch (error) {
    console.error('List users error:', error);
    res.status(500).json({ error: error.message || 'Failed to list users', code: 'INTERNAL_ERROR' });
  }
});

/**
 * GET /api/users/:id
 */
router.get('/:id', authenticate, requireAdmin, validateUuidParams('id'), async (req, res) => {
  try {
    let user = null;
    try {
      user = await queryOne(
        `SELECT u.*,
          (SELECT COUNT(*) FROM jury_assignments ja WHERE ja.user_id = u.id) as assigned_teams,
          (SELECT COUNT(*) FROM evaluations e WHERE e.user_id = u.id AND e.status = 'submitted') as evaluations_completed
         FROM users u WHERE u.id = $1`,
        [req.params.id]
      );
    } catch (pgErr) {
      console.warn('Postgres query failed in GET /api/users/:id:', pgErr.message);
      const [uRes, jaRes, evalsRes] = await Promise.all([
        supabaseAdmin.from('users').select('*').eq('id', req.params.id).maybeSingle(),
        supabaseAdmin.from('jury_assignments').select('id').eq('user_id', req.params.id),
        supabaseAdmin.from('evaluations').select('id').eq('user_id', req.params.id).eq('status', 'submitted'),
      ]);
      if (uRes.data) {
        user = {
          ...uRes.data,
          assigned_teams: jaRes.data?.length || 0,
          evaluations_completed: evalsRes.data?.length || 0,
        };
      }
    }

    if (!user) {
      return res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' });
    }

    const { auth_id, ...safeUser } = user;
    res.json({ user: safeUser });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: error.message || 'Failed to get user', code: 'INTERNAL_ERROR' });
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

    // Enforce password strength policy
    const pwdValidation = validatePasswordStrength(password);
    if (!pwdValidation.valid) {
      return res.status(400).json({ error: pwdValidation.error, code: 'WEAK_PASSWORD' });
    }

    const normalizedRole = (role || '').toUpperCase();
    if (!['ADMIN', 'JURY'].includes(normalizedRole)) {
      return res.status(400).json({ error: 'Invalid role. Must be ADMIN or JURY', code: 'VALIDATION_ERROR' });
    }

    // Check duplicates
    let existingUser = null;
    try {
      existingUser = await queryOne('SELECT id FROM users WHERE username = $1 OR email = $2', [username, email.toLowerCase()]);
    } catch {
      const { data: supaExist } = await supabaseAdmin
        .from('users')
        .select('id')
        .or(`username.eq.${username},email.eq.${email.toLowerCase()}`)
        .maybeSingle();
      existingUser = supaExist;
    }

    if (existingUser) {
      return res.status(409).json({ error: 'Username or email already exists in system', code: 'DUPLICATE_USER' });
    }

    // Create in Supabase Auth
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: email.toLowerCase(),
      password,
      email_confirm: true,
      user_metadata: {
        username: sanitize(username),
        full_name: sanitize(full_name),
        role: normalizedRole,
        judge_id: judge_id || null,
      },
    });

    if (authError || !authData?.user) {
      return res.status(400).json({
        error: `Auth error: ${authError?.message || 'Failed to create auth user in Supabase'}`,
        code: 'AUTH_ERROR',
      });
    }

    // Create in our users table
    let user = null;
    try {
      user = await queryOne(
        `INSERT INTO users (auth_id, username, email, full_name, role, judge_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, username, email, full_name, role, judge_id, status, created_at`,
        [authData.user.id, sanitize(username), email.toLowerCase(), sanitize(full_name), normalizedRole, judge_id || null]
      );
    } catch (dbInsertErr) {
      console.warn('PostgreSQL insert error, trying Supabase REST client:', dbInsertErr.message);
      const { data: supaInsert, error: supaErr } = await supabaseAdmin
        .from('users')
        .insert({
          auth_id: authData.user.id,
          username: sanitize(username),
          email: email.toLowerCase(),
          full_name: sanitize(full_name),
          role: normalizedRole,
          judge_id: judge_id || null,
        })
        .select('id, username, email, full_name, role, judge_id, status, created_at')
        .single();

      if (supaErr) {
        throw new Error(`Database insert failed: ${supaErr.message}`);
      }
      user = supaInsert;
    }

    if (req.user?.id) {
      try {
        await logAction(req.user.id, 'user.created', 'user', user.id,
          { username: user.username, role: user.role }, getClientIp(req));
      } catch (logErr) {
        console.warn('Audit log error:', logErr.message);
      }
    }

    res.status(201).json({ user });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: error.message || 'Failed to create user', code: 'INTERNAL_ERROR' });
  }
});

/**
 * PUT /api/users/:id
 * Update user
 */
router.put('/:id', authenticate, requireAdmin, validateUuidParams('id'), async (req, res) => {
  try {
    let existing = null;
    try {
      existing = await queryOne('SELECT * FROM users WHERE id = $1', [req.params.id]);
    } catch {
      const { data } = await supabaseAdmin.from('users').select('*').eq('id', req.params.id).maybeSingle();
      existing = data;
    }

    if (!existing) {
      return res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' });
    }

    const { full_name, role, judge_id, status, email, username, password } = req.body;

    // Validate role if provided
    let normalizedRole = undefined;
    if (role !== undefined) {
      normalizedRole = (role || '').toUpperCase();
      if (!['ADMIN', 'JURY'].includes(normalizedRole)) {
        return res.status(400).json({ error: 'Invalid role. Must be ADMIN or JURY', code: 'VALIDATION_ERROR' });
      }
    }

    // Validate status if provided
    if (status !== undefined && !['active', 'inactive'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be active or inactive', code: 'VALIDATION_ERROR' });
    }

    // Validate password strength if provided
    if (password) {
      const pwdValidation = validatePasswordStrength(password);
      if (!pwdValidation.valid) {
        return res.status(400).json({ error: pwdValidation.error, code: 'WEAK_PASSWORD' });
      }
    }

    // Validate email uniqueness if changed
    const targetEmail = email ? email.toLowerCase().trim() : undefined;
    if (targetEmail && targetEmail !== existing.email?.toLowerCase()) {
      let duplicateEmail = null;
      try {
        duplicateEmail = await queryOne('SELECT id FROM users WHERE email = $1 AND id != $2', [targetEmail, req.params.id]);
      } catch {
        const { data } = await supabaseAdmin.from('users').select('id').eq('email', targetEmail).neq('id', req.params.id).maybeSingle();
        duplicateEmail = data;
      }
      if (duplicateEmail) {
        return res.status(409).json({ error: 'Email already in use by another account', code: 'DUPLICATE_EMAIL' });
      }
    }

    // Validate judge_id uniqueness if changed
    const targetJudgeId = judge_id !== undefined ? (judge_id ? judge_id.trim() : null) : undefined;
    if (targetJudgeId && targetJudgeId !== existing.judge_id) {
      let duplicateJudge = null;
      try {
        duplicateJudge = await queryOne('SELECT id FROM users WHERE judge_id = $1 AND id != $2', [targetJudgeId, req.params.id]);
      } catch {
        const { data } = await supabaseAdmin.from('users').select('id').eq('judge_id', targetJudgeId).neq('id', req.params.id).maybeSingle();
        duplicateJudge = data;
      }
      if (duplicateJudge) {
        return res.status(409).json({ error: 'Jury ID already assigned to another user', code: 'DUPLICATE_JURY_ID' });
      }
    }

    // Determine target username: if judge_id updated and username not specified, sync username if it previously matched judge_id
    let targetUsername = username ? username.trim() : undefined;
    if (!targetUsername && targetJudgeId && existing.username === existing.judge_id) {
      targetUsername = targetJudgeId;
    }

    if (targetUsername && targetUsername !== existing.username) {
      let duplicateUser = null;
      try {
        duplicateUser = await queryOne('SELECT id FROM users WHERE username = $1 AND id != $2', [targetUsername, req.params.id]);
      } catch {
        const { data } = await supabaseAdmin.from('users').select('id').eq('username', targetUsername).neq('id', req.params.id).maybeSingle();
        duplicateUser = data;
      }
      if (duplicateUser) {
        return res.status(409).json({ error: 'Username already in use by another account', code: 'DUPLICATE_USERNAME' });
      }
    }

    // Sync with Supabase Auth if auth_id exists
    if (existing.auth_id) {
      try {
        const supabaseUpdates = {};
        if (targetEmail && targetEmail !== existing.email) {
          supabaseUpdates.email = targetEmail;
          supabaseUpdates.email_confirm = true;
        }
        if (password) {
          supabaseUpdates.password = password;
        }

        const metadataUpdates = {};
        if (full_name !== undefined) metadataUpdates.full_name = sanitize(full_name.trim());
        if (targetJudgeId !== undefined) metadataUpdates.judge_id = targetJudgeId;
        if (normalizedRole !== undefined) metadataUpdates.role = normalizedRole;
        if (targetUsername !== undefined) metadataUpdates.username = sanitize(targetUsername);

        if (Object.keys(metadataUpdates).length > 0) {
          supabaseUpdates.user_metadata = metadataUpdates;
        }

        if (Object.keys(supabaseUpdates).length > 0) {
          const { error: supaAuthErr } = await supabaseAdmin.auth.admin.updateUserById(existing.auth_id, supabaseUpdates);
          if (supaAuthErr) {
            console.warn('Supabase Auth update warning:', supaAuthErr.message);
          }
        }
      } catch (authErr) {
        console.warn('Failed to update Supabase Auth user:', authErr.message);
      }
    }

    let user = null;
    const finalFullName = full_name !== undefined ? sanitize(full_name.trim()) : null;
    const finalRole = normalizedRole || null;
    const finalJudgeId = targetJudgeId !== undefined ? targetJudgeId : null;
    const finalStatus = status || null;
    const finalEmail = targetEmail || null;
    const finalUsername = targetUsername ? sanitize(targetUsername) : null;

    try {
      user = await queryOne(
        `UPDATE users SET
          full_name = COALESCE($1, full_name),
          role = COALESCE($2, role),
          judge_id = CASE WHEN $3::text IS NOT NULL THEN $3 ELSE judge_id END,
          status = COALESCE($4, status),
          email = COALESCE($5, email),
          username = COALESCE($6, username),
          updated_at = NOW()
         WHERE id = $7
         RETURNING id, username, email, full_name, role, judge_id, status, created_at, updated_at`,
        [finalFullName, finalRole, finalJudgeId, finalStatus, finalEmail, finalUsername, req.params.id]
      );
    } catch (pgErr) {
      console.warn('PostgreSQL update error, trying Supabase REST client:', pgErr.message);
      const updateFields = { updated_at: new Date().toISOString() };
      if (full_name !== undefined) updateFields.full_name = sanitize(full_name.trim());
      if (normalizedRole !== undefined) updateFields.role = normalizedRole;
      if (targetJudgeId !== undefined) updateFields.judge_id = targetJudgeId;
      if (status !== undefined) updateFields.status = status;
      if (targetEmail !== undefined) updateFields.email = targetEmail;
      if (targetUsername !== undefined) updateFields.username = sanitize(targetUsername);

      const { data, error: supaErr } = await supabaseAdmin
        .from('users')
        .update(updateFields)
        .eq('id', req.params.id)
        .select('id, username, email, full_name, role, judge_id, status, created_at, updated_at')
        .single();

      if (supaErr) throw new Error(supaErr.message);
      user = data;
    }

    try {
      await logAction(req.user.id, 'user.updated', 'user', user.id,
        {
          before: { full_name: existing.full_name, role: existing.role, status: existing.status, judge_id: existing.judge_id, email: existing.email },
          after: { full_name: user.full_name, role: user.role, status: user.status, judge_id: user.judge_id, email: user.email, password_changed: !!password }
        },
        getClientIp(req));
    } catch (logErr) {
      console.warn('Audit log error:', logErr.message);
    }

    res.json({ user });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: error.message || 'Failed to update user', code: 'INTERNAL_ERROR' });
  }
});

/**
 * DELETE /api/users/:id
 * Permanently delete user from DB and Supabase Auth
 */
router.delete('/:id', authenticate, requireAdmin, validateUuidParams('id'), async (req, res) => {
  try {
    let user = null;
    try {
      user = await queryOne('SELECT * FROM users WHERE id = $1', [req.params.id]);
    } catch {
      const { data } = await supabaseAdmin.from('users').select('*').eq('id', req.params.id).maybeSingle();
      user = data;
    }

    if (!user) {
      return res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' });
    }

    // Prevent deleting yourself
    if (user.id === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account', code: 'SELF_DELETE' });
    }

    // Prevent deleting admin accounts
    if (user.role === 'ADMIN') {
      return res.status(400).json({ error: 'Cannot delete admin accounts', code: 'ADMIN_DELETE' });
    }

    // Remove jury assignments for this user
    try {
      await query('DELETE FROM jury_assignments WHERE user_id = $1', [req.params.id]);
    } catch {
      await supabaseAdmin.from('jury_assignments').delete().eq('user_id', req.params.id);
    }

    // Permanently delete from users table
    try {
      await query('DELETE FROM users WHERE id = $1', [req.params.id]);
    } catch {
      const { error: supaErr } = await supabaseAdmin.from('users').delete().eq('id', req.params.id);
      if (supaErr) throw new Error(supaErr.message);
    }

    // Delete from Supabase Auth
    if (user.auth_id) {
      try {
        await supabaseAdmin.auth.admin.deleteUser(user.auth_id);
      } catch (e) {
        console.warn('Failed to delete Supabase auth user:', e.message);
      }
    }

    try {
      await logAction(req.user.id, 'user.deleted', 'user', req.params.id,
        { username: user.username, full_name: user.full_name, judge_id: user.judge_id },
        getClientIp(req));
    } catch (logErr) {
      console.warn('Audit log error:', logErr.message);
    }

    res.json({ message: 'User deleted permanently' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: error.message || 'Failed to delete user', code: 'INTERNAL_ERROR' });
  }
});

export default router;


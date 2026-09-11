import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { syncUser, getUserById } from '../services/authService.js';
import { logAction, getClientIp } from '../services/auditService.js';
import { queryOne } from '../config/database.js';
import supabaseAdmin from '../config/supabase.js';

const router = Router();

/**
 * POST /api/auth/resolve-identifier
 * Public endpoint to resolve a Jury ID, username, or partial email to the canonical login email
 */
router.post('/resolve-identifier', async (req, res) => {
  try {
    const { identifier } = req.body;
    if (!identifier || typeof identifier !== 'string') {
      return res.status(400).json({ error: 'Identifier is required', code: 'VALIDATION_ERROR' });
    }

    const clean = identifier.trim();
    const cleanAlphaNum = clean.toLowerCase().replace(/[^a-z0-9]/g, '');

    // 1. Try matching users table in PostgreSQL
    let user = null;
    try {
      user = await queryOne(
        `SELECT id, email, judge_id, username, role, status FROM users
         WHERE (
           LOWER(judge_id) = LOWER($1)
           OR LOWER(username) = LOWER($1)
           OR LOWER(email) = LOWER($1)
           OR REPLACE(REPLACE(LOWER(judge_id), '_', ''), '-', '') = LOWER($2)
           OR REPLACE(REPLACE(LOWER(username), '_', ''), '-', '') = LOWER($2)
           OR LOWER(email) LIKE $3
         )
         ORDER BY (
           CASE
             WHEN LOWER(judge_id) = LOWER($1) THEN 1
             WHEN LOWER(username) = LOWER($1) THEN 2
             WHEN LOWER(email) = LOWER($1) THEN 3
             ELSE 4
           END
         )
         LIMIT 1`,
        [clean, cleanAlphaNum, `${cleanAlphaNum}%`]
      );
    } catch (pgErr) {
      console.warn('Postgres query failed in resolve-identifier, falling back to Supabase REST:', pgErr.message);
      const { data } = await supabaseAdmin
        .from('users')
        .select('id, email, judge_id, username, role, status')
        .or(`judge_id.ilike.${clean},username.ilike.${clean},email.ilike.${clean}`)
        .limit(1)
        .maybeSingle();
      user = data;
    }

    if (user && user.email) {
      if (user.status === 'inactive') {
        return res.status(403).json({
          error: 'Your jury account has been marked inactive. Please contact the administrator.',
          code: 'ACCOUNT_INACTIVE',
          status: 'inactive',
        });
      }
      return res.json({
        email: user.email,
        role: user.role,
        judge_id: user.judge_id,
        username: user.username,
        status: user.status,
      });
    }

    // 2. Also check Supabase Auth users directly if not found in DB
    try {
      const { data: { users: supaUsers } } = await supabaseAdmin.auth.admin.listUsers({ perPage: 500 });
      const matched = (supaUsers || []).find(u => {
        const meta = u.user_metadata || {};
        return (
          u.email?.toLowerCase() === clean.toLowerCase() ||
          meta.judge_id?.toLowerCase() === clean.toLowerCase() ||
          meta.username?.toLowerCase() === clean.toLowerCase() ||
          (cleanAlphaNum && u.email?.toLowerCase().startsWith(cleanAlphaNum))
        );
      });

      if (matched && matched.email) {
        return res.json({
          email: matched.email,
          role: matched.user_metadata?.role || 'JURY',
          judge_id: matched.user_metadata?.judge_id,
        });
      }
    } catch (supaErr) {
      console.warn('Supabase listUsers failed in resolve-identifier:', supaErr.message);
    }

    // 3. Fallback: generate default candidate email format
    return res.json({
      email: `${cleanAlphaNum}@sih.gov.in`,
    });
  } catch (error) {
    console.error('Resolve identifier error:', error);
    res.status(500).json({ error: 'Failed to resolve identifier', code: 'INTERNAL_ERROR' });
  }
});

/**
 * POST /api/auth/sync
 * Sync Supabase auth user with our users table after frontend login
 */
router.post('/sync', authenticate, async (req, res) => {
  try {
    const user = await syncUser(req.user.authId, req.user.email);

    if (!user) {
      return res.status(404).json({
        error: 'User account not found in system. Please contact admin.',
        code: 'USER_NOT_FOUND',
      });
    }

    await logAction(user.id, 'user.login', 'user', user.id, null, getClientIp(req));

    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        fullName: user.full_name,
        role: user.role,
        judgeId: user.judge_id,
        status: user.status,
        lastLoginAt: user.last_login_at,
      },
    });
  } catch (error) {
    console.error('Auth sync error:', error);
    res.status(500).json({ error: 'Failed to sync user', code: 'SYNC_ERROR' });
  }
});

/**
 * GET /api/auth/me
 * Get current user profile
 */
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await getUserById(req.user.id);

    if (!user) {
      return res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' });
    }

    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        fullName: user.full_name,
        role: user.role,
        judgeId: user.judge_id,
        status: user.status,
        lastLoginAt: user.last_login_at,
        createdAt: user.created_at,
      },
    });
  } catch (error) {
    console.error('Auth me error:', error);
    res.status(500).json({ error: 'Failed to get user profile', code: 'INTERNAL_ERROR' });
  }
});

export default router;

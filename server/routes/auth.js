import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { syncUser, getUserById } from '../services/authService.js';
import { logAction, getClientIp } from '../services/auditService.js';

const router = Router();

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

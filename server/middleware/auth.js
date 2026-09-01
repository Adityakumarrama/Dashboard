import supabaseAdmin from '../config/supabase.js';
import { queryOne } from '../config/database.js';
import { UnauthorizedError } from '../utils/errors.js';

/**
 * Authentication middleware
 * Verifies JWT token from Supabase and attaches user data to req
 */
export async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing or invalid authorization header');
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
      throw new UnauthorizedError('No token provided');
    }

    // Verify token with Supabase
    const { data: { user: authUser }, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !authUser) {
      throw new UnauthorizedError('Invalid or expired token');
    }

    // Look up user in our users table
    const dbUser = await queryOne(
      'SELECT id, auth_id, username, email, full_name, role, judge_id, status FROM users WHERE auth_id = $1',
      [authUser.id]
    );

    if (!dbUser) {
      throw new UnauthorizedError('User account not found. Please contact admin.');
    }

    if (dbUser.status !== 'active') {
      throw new UnauthorizedError('Your account has been deactivated');
    }

    // Attach user info to request
    req.user = {
      id: dbUser.id,
      authId: dbUser.auth_id,
      username: dbUser.username,
      email: dbUser.email,
      fullName: dbUser.full_name,
      role: dbUser.role,
      judgeId: dbUser.judge_id,
    };

    next();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return res.status(401).json({ error: error.message, code: error.code });
    }
    console.error('Auth middleware error:', error);
    return res.status(401).json({ error: 'Authentication failed', code: 'AUTH_FAILED' });
  }
}

/**
 * Optional auth - doesn't fail if no token, but attaches user if present
 */
export async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authenticate(req, res, next);
    }
    next();
  } catch {
    next();
  }
}

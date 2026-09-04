import supabaseAdmin from '../config/supabase.js';
import { queryOne, query } from '../config/database.js';
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

    let dbUser = null;

    // 1. Try finding user via PostgreSQL
    try {
      dbUser = await queryOne(
        'SELECT id, auth_id, username, email, full_name, role, judge_id, status FROM users WHERE auth_id = $1',
        [authUser.id]
      );

      if (!dbUser) {
        const emailPrefix = authUser.email ? authUser.email.split('@')[0] : '';
        dbUser = await queryOne(
          `SELECT id, auth_id, username, email, full_name, role, judge_id, status FROM users 
           WHERE email = $1 
              OR username = $1 
              OR email ILIKE $2 
              OR username ILIKE $2 
              OR LOWER(email) = LOWER($1) 
              OR LOWER(username) = LOWER($3)`,
          [authUser.email, `${emailPrefix}%`, emailPrefix]
        );
        if (dbUser) {
          try {
            await query('UPDATE users SET auth_id = $1 WHERE id = $2', [authUser.id, dbUser.id]);
            dbUser.auth_id = authUser.id;
          } catch (updateErr) {
            console.warn('Could not update user auth_id:', updateErr.message);
          }
        }
      }
    } catch (pgErr) {
      console.warn('PostgreSQL auth lookup error, attempting Supabase REST fallback:', pgErr.message);
    }

    // 2. Fallback via Supabase REST API (HTTPS)
    if (!dbUser) {
      try {
        const { data: supaUser } = await supabaseAdmin
          .from('users')
          .select('id, auth_id, username, email, full_name, role, judge_id, status')
          .or(`auth_id.eq.${authUser.id},email.eq.${authUser.email}`)
          .maybeSingle();

        if (supaUser) {
          dbUser = supaUser;
        }
      } catch (supaErr) {
        console.warn('Supabase REST user lookup failed:', supaErr.message);
      }
    }

    // 3. Fallback to Supabase Auth metadata for valid authenticated sessions
    if (!dbUser && authUser) {
      const metaRole = authUser.user_metadata?.role ||
        (authUser.email?.toLowerCase().includes('admin') ? 'ADMIN' : 'JURY');
      dbUser = {
        id: authUser.id,
        auth_id: authUser.id,
        username: authUser.user_metadata?.username || authUser.email?.split('@')[0],
        email: authUser.email,
        full_name: authUser.user_metadata?.full_name || 'User',
        role: metaRole.toUpperCase(),
        judge_id: authUser.user_metadata?.judge_id || null,
        status: 'active',
      };
    }

    if (!dbUser) {
      throw new UnauthorizedError('User account not found. Please contact admin.');
    }

    if (dbUser.status !== 'active') {
      throw new UnauthorizedError('Your account has been deactivated');
    }

    // Attach user info to request
    req.user = {
      id: dbUser.id,
      authId: dbUser.auth_id || authUser.id,
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
    return res.status(401).json({ error: error.message || 'Authentication failed', code: 'AUTH_FAILED' });
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

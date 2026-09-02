import { queryOne, query } from '../config/database.js';
import supabaseAdmin from '../config/supabase.js';

/**
 * Sync a Supabase auth user with our users table
 * Called after frontend login to ensure user exists in our DB
 */
export async function syncUser(authId, email) {
  // 1. Check if user already exists by auth_id
  let user = await queryOne(
    'SELECT id, auth_id, username, email, full_name, role, judge_id, status, last_login_at FROM users WHERE auth_id = $1',
    [authId]
  );

  if (user) {
    await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
    user.last_login_at = new Date().toISOString();
    return user;
  }

  // 2. Check if user exists by email or username (and link auth_id)
  user = await queryOne(
    'SELECT id, auth_id, username, email, full_name, role, judge_id, status, last_login_at FROM users WHERE email = $1 OR username = $1 OR email ILIKE $2',
    [email, `${email.split('@')[0]}%`]
  );

  if (user) {
    await query('UPDATE users SET auth_id = $1, last_login_at = NOW() WHERE id = $2', [authId, user.id]);
    user.auth_id = authId;
    user.last_login_at = new Date().toISOString();
    return user;
  }

  return null;
}

/**
 * Create a user in both Supabase Auth and our users table
 */
export async function createUser({ email, password, username, fullName, role, judgeId }) {
  // Create in Supabase Auth
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (authError) {
    throw new Error(`Supabase auth error: ${authError.message}`);
  }

  // Create in our users table
  const result = await queryOne(
    `INSERT INTO users (auth_id, username, email, full_name, role, judge_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [authData.user.id, username, email, fullName, role, judgeId || null]
  );

  return result;
}

/**
 * Get user by their database ID
 */
export async function getUserById(id) {
  return queryOne(
    `SELECT id, auth_id, username, email, full_name, role, judge_id, status, last_login_at, created_at, updated_at
     FROM users WHERE id = $1`,
    [id]
  );
}

/**
 * Get user by auth ID
 */
export async function getUserByAuthId(authId) {
  return queryOne(
    `SELECT id, auth_id, username, email, full_name, role, judge_id, status, last_login_at, created_at, updated_at
     FROM users WHERE auth_id = $1`,
    [authId]
  );
}

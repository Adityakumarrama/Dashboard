import { queryOne, query } from '../config/database.js';
import supabaseAdmin from '../config/supabase.js';

/**
 * Sync a Supabase auth user with our users table
 * Called after frontend login to ensure user exists in our DB
 */
export async function syncUser(authId, email) {
  // Check if user already exists
  let user = await queryOne(
    'SELECT id, auth_id, username, email, full_name, role, judge_id, status, last_login_at FROM users WHERE auth_id = $1',
    [authId]
  );

  if (user) {
    // Update last login
    await query('UPDATE users SET last_login_at = NOW() WHERE auth_id = $1', [authId]);
    user.last_login_at = new Date().toISOString();
    return user;
  }

  // User doesn't exist in our table yet — this shouldn't normally happen
  // because users should be created by admin first. Return null.
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

import dotenv from 'dotenv';
import pg from 'pg';
import supabaseAdmin from '../config/supabase.js';

dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function findOrCreateAuthUser(email, password) {
  const { data: { users }, error: listError } = await supabaseAdmin.auth.admin.listUsers();
  if (listError) {
    throw new Error(`Failed to list users: ${listError.message}`);
  }

  const existing = users.find(u => u.email?.toLowerCase() === email.toLowerCase());
  if (existing) {
    await supabaseAdmin.auth.admin.updateUserById(existing.id, { password, email_confirm: true });
    return existing.id;
  }

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error) {
    throw new Error(`Failed to create auth user ${email}: ${error.message}`);
  }

  return data.user.id;
}

async function seed() {
  console.log('\n🌱 Setting up Single Admin user...\n');
  const client = await pool.connect();

  try {
    await client.query(
      `INSERT INTO users (auth_id, username, email, full_name, role, status)
       VALUES ($1, $2, $3, 'SIH Administrator', 'ADMIN', 'active')
       ON CONFLICT (email) DO UPDATE SET
         auth_id = EXCLUDED.auth_id,
         username = EXCLUDED.username,
         role = 'ADMIN',
         status = 'active'`,
      [authId, adminUsername, adminEmail]
    );

    console.log('============================================================');
    console.log('✅ ONLY 1 ADMIN LOGIN CONFIGURED:');
    console.log('============================================================');
    console.log(`   User ID / Email: ${adminUsername} (or ${adminEmail})`);
    console.log(`   Password:        ${adminPass}`);
    console.log('   Stored in DB:    YES (password column in users table)');
    console.log('============================================================\n');

  } catch (err) {
    console.error('\n❌ Seeding failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();

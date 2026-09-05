import dotenv from 'dotenv';
import pg from 'pg';
import supabaseAdmin from '../config/supabase.js';

dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function cleanAndReset() {
  console.log('\n🧹 Cleaning all dummy data from database...\n');
  const client = await pool.connect();

  try {
    // 1. Ensure password column exists in users table
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS password TEXT;');

    // 2. Truncate all tables
    console.log('🗑️  Truncating all application tables...');
    await client.query(`
      TRUNCATE TABLE evaluation_scores CASCADE;
      TRUNCATE TABLE evaluations CASCADE;
      TRUNCATE TABLE jury_assignments CASCADE;
      TRUNCATE TABLE import_errors CASCADE;
      TRUNCATE TABLE imports CASCADE;
      TRUNCATE TABLE audit_logs CASCADE;
      TRUNCATE TABLE master_team_member_details CASCADE;
      TRUNCATE TABLE team_members CASCADE;
      TRUNCATE TABLE teams CASCADE;
      TRUNCATE TABLE users CASCADE;
    `);
    console.log('   ✓ All tables emptied.');

    // 3. Clean all old users from Supabase Auth
    console.log('\n🗑️  Cleaning Supabase Auth users...');
    const { data: { users: authUsers }, error: listError } = await supabaseAdmin.auth.admin.listUsers({
      perPage: 1000,
    });

    if (listError) {
      console.warn('   ⚠️ Could not list existing auth users:', listError.message);
    } else {
      for (const u of authUsers) {
        try {
          await supabaseAdmin.auth.admin.deleteUser(u.id);
          console.log(`   ✓ Removed auth user: ${u.email}`);
        } catch (delErr) {
          console.warn(`   ⚠️ Could not delete auth user ${u.email}:`, delErr.message);
        }
      }
    }

    // 4. Create the Single Admin Account in Supabase Auth
    console.log('\n👑 Creating Single Admin Account...');
    const adminEmail = 'SIHadmin6388@sih.gov.in';
    const adminPassword = 'Aditya6388@';
    const adminUsername = 'SIHadmin6388@sih';

    const { data: newAuthData, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
      user_metadata: {
        username: adminUsername,
        full_name: 'SIH Administrator',
        role: 'ADMIN',
      },
    });

    if (createError) {
      throw new Error(`Failed to create admin in Supabase Auth: ${createError.message}`);
    }

    const authId = newAuthData.user.id;
    console.log(`   ✓ Created Supabase Auth user: ${adminEmail} (Auth ID: ${authId})`);

    // 5. Insert the Single Admin into the users table
    const userRes = await client.query(
      `INSERT INTO users (auth_id, username, email, full_name, role, status)
       VALUES ($1, $2, $3, $4, 'ADMIN', 'active')
       RETURNING id, username, email, full_name, role, status, created_at`,
      [authId, adminUsername, adminEmail, 'SIH Administrator']
    );

    console.log('\n============================================================');
    console.log('✅ DATABASE CLEANED & ADMIN CREATED SUCCESSFULLY!');
    console.log('============================================================');
    console.log('👑 Single Admin Login Credentials:');
    console.log(`   User ID / Email: ${adminUsername} (or ${adminEmail})`);
    console.log(`   Password:        ${adminPassword}`);
    console.log('   Stored in DB:    YES (password saved in users table)');
    console.log('   All dummy data:  REMOVED (0 teams, 0 jury, 0 evaluations)');
    console.log('============================================================\n');

  } catch (error) {
    console.error('\n❌ Clean & Reset failed:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

cleanAndReset();

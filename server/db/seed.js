import dotenv from 'dotenv';
import pg from 'pg';
import supabaseAdmin from '../config/supabase.js';

dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function findOrCreateAuthUser(email, password) {
  // Check if user already exists in Supabase
  const { data: { users }, error: listError } = await supabaseAdmin.auth.admin.listUsers();
  if (listError) {
    throw new Error(`Failed to list users: ${listError.message}`);
  }

  const existing = users.find(u => u.email?.toLowerCase() === email.toLowerCase());
  if (existing) {
    // Optionally update password to ensure it matches
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
  console.log('\n🌱 Starting database seeding...\n');
  const client = await pool.connect();

  try {
    // 1. Create Admin Users
    console.log('👤 Creating/syncing Admin accounts...');
    const adminAccounts = [
      { email: 'admin@sih.gov.in', pass: 'Admin@123456', username: 'admin', name: 'System Admin' },
      { email: 'superadmin@sih.gov.in', pass: 'Admin@123456', username: 'superadmin', name: 'Super Admin' },
    ];

    let adminId = null;
    for (const adm of adminAccounts) {
      const authId = await findOrCreateAuthUser(adm.email, adm.pass);
      const res = await client.query(
        `INSERT INTO users (auth_id, username, email, full_name, role, status)
         VALUES ($1, $2, $3, $4, 'ADMIN', 'active')
         ON CONFLICT (email) DO UPDATE SET
           auth_id = EXCLUDED.auth_id,
           role = 'ADMIN',
           status = 'active'
         RETURNING id`,
        [authId, adm.username, adm.email, adm.name]
      );
      if (!adminId) adminId = res.rows[0].id;
      console.log(`   ✓ Admin: ${adm.email} (Password: ${adm.pass})`);
    }

    // 2. Create Jury Users
    console.log('\n⚖️ Creating/syncing Jury accounts...');
    const juryMembers = [
      { email: 'jury1@sih.gov.in', pass: 'Jury@123456', username: 'jury1', name: 'Dr. Aris Thorne', judgeId: 'JRY-001' },
      { email: 'jury2@sih.gov.in', pass: 'Jury@123456', username: 'jury2', name: 'Prof. Meera Nair', judgeId: 'JRY-002' },
      { email: 'jury3@sih.gov.in', pass: 'Jury@123456', username: 'jury3', name: 'Vikramaditya Rao', judgeId: 'JRY-003' },
    ];

    const juryDbIds = [];
    for (const j of juryMembers) {
      const authId = await findOrCreateAuthUser(j.email, j.pass);
      const res = await client.query(
        `INSERT INTO users (auth_id, username, email, full_name, role, judge_id, status)
         VALUES ($1, $2, $3, $4, 'JURY', $5, 'active')
         ON CONFLICT (email) DO UPDATE SET
           auth_id = EXCLUDED.auth_id,
           role = 'JURY',
           judge_id = EXCLUDED.judge_id,
           status = 'active'
         RETURNING id`,
        [authId, j.username, j.email, j.name, j.judgeId]
      );
      juryDbIds.push({ id: res.rows[0].id, name: j.name });
      console.log(`   ✓ Jury: ${j.email} (Password: ${j.pass}) — ${j.name} [${j.judgeId}]`);
    }

    // 3. Create Sample Teams
    console.log('\n👥 Seeding sample SIH teams...');
    const sampleTeams = [
      {
        code: 'SIH2026-001',
        name: 'AgriVision',
        psId: 'PS-1042',
        psTitle: 'AI Based Crop Disease & Health Monitoring',
        org: 'Indian Institute of Technology, Madras',
        cat: 'Software',
        track: 'Agriculture & FoodTech',
        leader: 'Rahul Kumar',
        members: JSON.stringify(['Priya Singh', 'Amit Shah', 'Neha Verma', 'Rohan Das']),
        contact: 'rahul.agrivision@example.com',
      },
      {
        code: 'SIH2026-002',
        name: 'MediConnect AI',
        psId: 'PS-2051',
        psTitle: 'Decentralized Smart Healthcare Platform',
        org: 'BITS Pilani',
        cat: 'Software',
        track: 'Healthcare & Biomedical',
        leader: 'Sita Patel',
        members: JSON.stringify(['Ravi Sharma', 'Meera Joshi', 'Tanmay Roy']),
        contact: 'sita.mediconnect@example.com',
      },
      {
        code: 'SIH2026-003',
        name: 'CyberShield Zero',
        psId: 'PS-3104',
        psTitle: 'Zero Trust Automated Threat Detection Framework',
        org: 'Delhi Technological University',
        cat: 'Software',
        track: 'Cybersecurity & Defence',
        leader: 'Karan Mehra',
        members: JSON.stringify(['Ananya Gupta', 'Siddharth Rao', 'Varun Iyer']),
        contact: 'karan.cybershield@example.com',
      },
      {
        code: 'SIH2026-004',
        name: 'EcoLogistics',
        psId: 'PS-4019',
        psTitle: 'Green Last-Mile Multi-Modal Route Optimization',
        org: 'National Institute of Technology, Trichy',
        cat: 'Software',
        track: 'Clean & Green Tech',
        leader: 'Devika Menon',
        members: JSON.stringify(['Aditya Sen', 'Gaurav Kulkarni', 'Sneha Paul']),
        contact: 'devika.eco@example.com',
      },
      {
        code: 'SIH2026-005',
        name: 'EduSphere VR',
        psId: 'PS-5122',
        psTitle: 'Spatial Interactive Science Lab Simulations for Rural Schools',
        org: 'Vellore Institute of Technology',
        cat: 'Software',
        track: 'Smart Education',
        leader: 'Aarav Nair',
        members: JSON.stringify(['Zoya Khan', 'Rishi Mukherjee', 'Kavya S']),
        contact: 'aarav.edusphere@example.com',
      },
    ];

    const teamDbIds = [];
    for (const t of sampleTeams) {
      const res = await client.query(
        `INSERT INTO teams (
          team_code, team_name, problem_statement_id, problem_statement_title,
          organization, category, track, team_leader, team_members, contact_info
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (team_code) DO UPDATE SET
          team_name = EXCLUDED.team_name,
          problem_statement_id = EXCLUDED.problem_statement_id,
          problem_statement_title = EXCLUDED.problem_statement_title,
          organization = EXCLUDED.organization,
          category = EXCLUDED.category,
          track = EXCLUDED.track,
          team_leader = EXCLUDED.team_leader,
          team_members = EXCLUDED.team_members,
          contact_info = EXCLUDED.contact_info
        RETURNING id, team_code`,
        [t.code, t.name, t.psId, t.psTitle, t.org, t.cat, t.track, t.leader, t.members, t.contact]
      );
      teamDbIds.push(res.rows[0].id);
      console.log(`   ✓ Team: ${t.code} — ${t.name}`);
    }

    // 4. Assign Teams to Jury
    console.log('\n📋 Assigning teams to Jury members...');
    for (const jury of juryDbIds) {
      for (const teamId of teamDbIds) {
        await client.query(
          `INSERT INTO jury_assignments (user_id, team_id, assigned_by)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id, team_id) DO NOTHING`,
          [jury.id, teamId, adminId]
        );
      }
      console.log(`   ✓ Assigned all ${teamDbIds.length} teams to ${jury.name}`);
    }

    console.log('\n============================================================');
    console.log('✅ DATABASE SEEDING COMPLETED SUCCESSFULLY!');
    console.log('============================================================');
    console.log('\n🔐 Credentials to test with:');
    console.log('------------------------------------------------------------');
    console.log('👑 Admin Login:');
    console.log(`   Email:    superadmin@sih.gov.in`);
    console.log(`   Password: Admin@123456\n`);
    console.log('⚖️ Jury Logins:');
    console.log(`   Email:    jury1@sih.gov.in   (Password: Jury@123456)`);
    console.log(`   Email:    jury2@sih.gov.in   (Password: Jury@123456)`);
    console.log(`   Email:    jury3@sih.gov.in   (Password: Jury@123456)`);
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

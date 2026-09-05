import { query } from '../config/database.js';

async function migrateMasterMembers() {
  console.log('🔄 Applying database migration for master_team_member_details...\n');

  const sql = `
    -- 1. Ensure master_team_member_details has SIH evaluation columns (member_number, gender, is_girl_member, created_at, updated_at)
    ALTER TABLE master_team_member_details ADD COLUMN IF NOT EXISTS member_number INTEGER;
    ALTER TABLE master_team_member_details ADD COLUMN IF NOT EXISTS gender TEXT;
    ALTER TABLE master_team_member_details ADD COLUMN IF NOT EXISTS is_girl_member BOOLEAN DEFAULT false;
    ALTER TABLE master_team_member_details ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
    ALTER TABLE master_team_member_details ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

    -- 2. Ensure team_members also has contact, course, academic_year, team_code
    ALTER TABLE team_members ADD COLUMN IF NOT EXISTS team_code TEXT;
    ALTER TABLE team_members ADD COLUMN IF NOT EXISTS contact TEXT;
    ALTER TABLE team_members ADD COLUMN IF NOT EXISTS course TEXT;
    ALTER TABLE team_members ADD COLUMN IF NOT EXISTS academic_year INTEGER;

    -- 3. Verify indexes on master_team_member_details
    CREATE INDEX IF NOT EXISTS idx_team_member_team_id ON master_team_member_details(team_id);
    CREATE INDEX IF NOT EXISTS idx_team_member_team_code ON master_team_member_details(team_code);
    CREATE INDEX IF NOT EXISTS idx_team_member_email ON master_team_member_details(member_email);
    CREATE INDEX IF NOT EXISTS idx_team_member_enrolment ON master_team_member_details(member_enrolment);
    CREATE INDEX IF NOT EXISTS idx_team_member_contact ON master_team_member_details(member_contact);
    CREATE INDEX IF NOT EXISTS idx_team_member_department ON master_team_member_details(member_department);
    CREATE INDEX IF NOT EXISTS idx_team_member_course ON master_team_member_details(member_course);
  `;

  try {
    await query(sql);
    console.log('✅ Migration applied successfully to PostgreSQL!');
    console.log('   - Added SIH fields (member_number, gender, is_girl_member, timestamps) to master_team_member_details');
    console.log('   - Verified all 7 search indexes on master_team_member_details');
    console.log('   - Ensured team_members compatibility');
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }

  process.exit(0);
}

migrateMasterMembers();

import { query } from '../config/database.js';

async function migrateRamaColumns() {
  console.log('Applying database migration for Rama University team registration format...');

  const sql = `
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS department TEXT;
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS course TEXT;
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS leader_phone TEXT;
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS leader_email TEXT;
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS leader_enrollment TEXT;
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS submitter_email TEXT;
    ALTER TABLE teams ADD COLUMN IF NOT EXISTS raw_data JSONB;

    CREATE TABLE IF NOT EXISTS team_members (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        member_number INTEGER,
        name TEXT NOT NULL,
        email TEXT,
        enrollment_number TEXT,
        gender TEXT,
        department TEXT,
        is_girl_member BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON team_members(team_id);
  `;

  try {
    await query(sql);
    console.log('✅ Migration applied successfully to PostgreSQL!');
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }

  process.exit(0);
}

migrateRamaColumns();

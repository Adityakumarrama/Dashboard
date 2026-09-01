import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../config/database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function migrate() {
  console.log('🔄 Running database migration...\n');

  try {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');

    await pool.query(schema);

    console.log('✅ Database migration completed successfully!');
    console.log('   - Tables created/verified');
    console.log('   - Indexes created/verified');
    console.log('   - Triggers created/verified');
    console.log('   - Default settings inserted');
    console.log('   - Default scoring criteria inserted');
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    if (error.detail) console.error('   Detail:', error.detail);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();

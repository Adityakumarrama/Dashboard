import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: process.env.VERCEL ? 3 : 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.error('Unexpected database pool error:', err);
});

// Helper to run a query with parameterized values
export async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV === 'development' && duration > 1000) {
      console.log(`Slow query (${duration}ms):`, text.substring(0, 80));
    }
    return result;
  } catch (error) {
    console.error('Database query error:', { text: text.substring(0, 100), error: error.message });
    throw error;
  }
}

// Helper to get a single row
export async function queryOne(text, params) {
  const result = await query(text, params);
  return result.rows[0] || null;
}

// Helper to get all rows
export async function queryAll(text, params) {
  const result = await query(text, params);
  return result.rows;
}

// Transaction helper
export async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export default pool;

const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || '13.229.124.81',
  user: process.env.DB_USER || 'admin',
  password: process.env.DB_PASSWORD || 'password123',
  database: process.env.DB_NAME || 'fashion_retail',
  port: parseInt(process.env.DB_PORT || '5432')
});

async function test() {
  console.log('Querying PostgreSQL database tables...');
  try {
    const res = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    console.log('Tables:', res.rows.map(r => r.table_name));
    
    // Check if users table exists
    const hasUsers = res.rows.some(r => r.table_name === 'users');
    if (hasUsers) {
      console.log('\nQuerying columns in users table...');
      const cols = await pool.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'users'
      `);
      console.log('Users columns:', cols.rows.map(c => `${c.column_name} (${c.data_type})`));
      
      const sample = await pool.query('SELECT id, username, role, store_id FROM users LIMIT 5');
      console.log('Users sample:', sample.rows);
    }
  } catch (err) {
    console.error('Database query error:', err.message);
  } finally {
    await pool.end();
  }
}

test().catch(console.error);

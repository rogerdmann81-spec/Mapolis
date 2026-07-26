const { Client } = require('pg');

async function auditSchema() {
  let dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return;
  
  const url = new URL(dbUrl);
  let pwd = decodeURIComponent(url.password);
  if (pwd.startsWith('[') && pwd.endsWith(']')) {
    pwd = pwd.substring(1, pwd.length - 1);
  }
  url.password = encodeURIComponent(pwd);
  url.port = '6543';
  
  const client = new Client({
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("Connected successfully to pooler!");
    
    // Get all tables
    const tablesRes = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE';
    `);

    const tables = tablesRes.rows.map(r => r.table_name);
    console.log(`Found ${tables.length} tables in public schema.\n`);

    for (const table of tables) {
      console.log(`--- Table: ${table} ---`);
      
      const colsRes = await client.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position;
      `, [table]);
      console.table(colsRes.rows);
      
      const policiesRes = await client.query(`
        SELECT policyname, permissive, roles, cmd
        FROM pg_policies
        WHERE schemaname = 'public' AND tablename = $1;
      `, [table]);
      
      if (policiesRes.rows.length > 0) {
        console.log(`Policies: ${policiesRes.rows.map(p => p.policyname).join(', ')}`);
      } else {
        console.log(`No RLS policies for ${table}.`);
      }
      console.log('');
    }

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await client.end();
  }
}
auditSchema();

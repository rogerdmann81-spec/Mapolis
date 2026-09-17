const { Client } = require('pg');
async function run() {
  const url = new URL(process.env.DATABASE_URL);
  let pwd = decodeURIComponent(url.password);
  if (pwd.startsWith('[') && pwd.endsWith(']')) pwd = pwd.substring(1, pwd.length - 1);
  url.password = encodeURIComponent(pwd);
  url.port = '6543';
  const client = new Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });
  await client.connect();
  const count1 = await client.query('SELECT count(*) FROM profiles');
  console.log('Profiles count:', count1.rows[0].count);
  const res = await client.query('SELECT auth_uid, handle FROM profiles LIMIT 5');
  console.table(res.rows);

  const count2 = await client.query('SELECT count(*) FROM auth.users');
  console.log('Auth Users count:', count2.rows[0].count);
  const res2 = await client.query('SELECT id, email FROM auth.users LIMIT 5');
  console.table(res2.rows);
  await client.end();
}
run();

const { Client } = require('pg');

async function auditSchema() {
  let dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return;
  
  const url = new URL(dbUrl);
  // keep password as is, only URI encode special chars
  let pwd = decodeURIComponent(url.password);
  url.password = encodeURIComponent(pwd);
  
  console.log('Connecting with URI encoded password...');

  const client = new Client({
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log("Connected successfully!");
  } catch(e) {
    console.error(e);
  }
  await client.end();
}
auditSchema();

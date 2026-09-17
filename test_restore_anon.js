async function test() {
  const url = process.env.SUPABASE_URL.replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
  const key = process.env.SUPABASE_ANON_KEY;
  // 1. Sign up anonymously to get an auth token
  const authRes = await fetch(url + '/auth/v1/signup', {
    method: 'POST',
    headers: { 'apikey': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test_anon_' + Date.now() + '@example.com', password: 'password123' })
  });
  const auth = await authRes.json();
  if(!auth.access_token) { console.error('Auth failed', auth); return; }

  // 2. Call restore_profile
  const res = await fetch(url + '/rest/v1/rpc/restore_profile', {
    method: 'POST',
    headers: { 'apikey': key, 'Authorization': 'Bearer ' + auth.access_token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_handle: 'fake', p_password_hash: 'fake' })
  });
  console.log('Status:', res.status, await res.text());
}
test();

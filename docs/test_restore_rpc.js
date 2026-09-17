async function testRestore() {
  const url = process.env.SUPABASE_URL.replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
  const key = process.env.SUPABASE_ANON_KEY;
  // Let's create an anonymous auth token first, or sign in anonymously
  const authRes = await fetch(url + '/auth/v1/signup', {
    method: 'POST',
    headers: { 'apikey': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test_anon_' + Date.now() + '@example.com', password: 'password123' })
  });
  const auth = await authRes.json();
  console.log('auth:', auth.access_token ? 'ok' : auth);

  const res = await fetch(url + '/rest/v1/rpc/restore_profile', {
    method: 'POST',
    headers: {
      'apikey': key,
      'Authorization': 'Bearer ' + auth.access_token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ p_handle: 'none', p_password_hash: 'none' })
  });
  console.log('restore status:', res.status, await res.text());
}
testRestore().catch(console.error);

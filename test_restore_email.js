async function test() {
  const url = process.env.SUPABASE_URL.replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
  const key = process.env.SUPABASE_ANON_KEY;

  // 1. Sign up anonymously
  const authRes = await fetch(url + '/auth/v1/signup', {
    method: 'POST',
    headers: { 'apikey': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test_anon_' + Date.now() + '@example.com', password: 'password123' })
  });
  const auth = await authRes.json();
  
  // 2. Create a profile
  const handle = 'test_handle_' + Date.now();
  const createRes = await fetch(url + '/rest/v1/rpc/create_profile', {
    method: 'POST',
    headers: { 'apikey': key, 'Authorization': 'Bearer ' + auth.access_token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      p_player_id: crypto.randomUUID(),
      p_handle: handle,
      p_password_hash: 'hash123',
      p_parent_email: 'test_restore_by_email@example.com'
    })
  });
  
  // 3. Call restore_profile_by_email
  const res = await fetch(url + '/rest/v1/rpc/restore_profile_by_email', {
    method: 'POST',
    headers: { 'apikey': key, 'Authorization': 'Bearer ' + auth.access_token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_parent_email: 'test_restore_by_email@example.com' })
  });
  console.log('Status:', res.status, await res.text());
}
test();

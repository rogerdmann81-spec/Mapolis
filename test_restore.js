async function run() {
  const url = process.env.SUPABASE_URL.replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
  const key = process.env.SUPABASE_ANON_KEY;
  const h = { 'Content-Type': 'application/json', 'apikey': key };
  // 1. anonymous signup
  let authRes = await fetch(url + '/auth/v1/signup', { method: 'POST', headers: h, body: JSON.stringify({}) });
  let authData = await authRes.json();
  if (!authRes.ok) {
    console.error('Auth error', authData);
    return;
  }
  const token = authData.access_token;
  console.log('Got token', token ? 'yes' : 'no');
  const authedH = { ...h, 'Authorization': 'Bearer ' + token, 'Prefer': 'return=representation' };

  // 2. call restore_profile
  let res = await fetch(url + '/rest/v1/rpc/restore_profile', {
    method: 'POST',
    headers: authedH,
    body: JSON.stringify({ p_handle: 'test', p_password_hash: 'testhash' })
  });
  let text = await res.text();
  console.log('Restore response:', text);
}
run();

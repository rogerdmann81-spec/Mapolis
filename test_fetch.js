const SUPABASE_URL = "https://tbibeuwpollcrlvowcpg.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRiaWJldXdwb2xsY3Jsdm93Y3BnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxODg5MTUsImV4cCI6MjA5MTc2NDkxNX0.2fIzL1Fn0aKLwCfOjOMXXQV-3WtvbwY4YoanJJ-Vys8";

async function test() {
  try {
    const authRes = await fetch(SUPABASE_URL + '/auth/v1/signup', {
      method: 'POST',
      headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test_' + Date.now() + '@example.com', password: 'password123' })
    });
    const auth = await authRes.json();
    console.log("Auth:", authRes.status);
    
    const resp = await fetch(SUPABASE_URL + '/rest/v1/rpc/restore_profile', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + auth.access_token
      },
      body: JSON.stringify({ p_handle: "fake", p_password_hash: "fake" })
    });
    
    const text = await resp.text();
    console.log("Restore response:", resp.status, text);
  } catch (err) {
    console.error("Fetch threw an error:", err);
  }
}
test();

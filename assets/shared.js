// assets/shared.js
// Mapolis shared data layer — loaded by both play/index.html and admin/index.html

// ─── Supabase constants ────────────────────────────────────────────────────

const SUPABASE_URL = 'https://tbibeuwpollcrlvowcpg.supabase.co';
const SUPABASE_KEY = 'sb_publishable_EK5hsEwqwxDABJ8TsiYmLg_LCZZDgUX';

const SYNC_QUEUE_KEY        = 'nsg_syncQueue';
const LEADERBOARD_CACHE_KEY = 'nsg_leaderboard_cache';
const LEADERBOARD_TS_KEY    = 'nsg_leaderboard_ts';

// ─── Supabase helpers ──────────────────────────────────────────────────────

function isSupabaseConfigured() {
  return SUPABASE_URL !== 'https://your-project.supabase.co'
      && SUPABASE_KEY !== 'your-anon-key-here';
}

function supabaseHeaders() {
  return {
    'Content-Type':  'application/json',
    'apikey':        SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Prefer':        'resolution=merge-duplicates'
  };
}

// ─── Auth session storage ──────────────────────────────────────────────────

const AUTH_SESSION_KEY = 'mapolis_auth_session';

function _getSession() {
  try {
    const raw = localStorage.getItem(AUTH_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function _saveSession(session) {
  try { localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session)); }
  catch (e) { console.warn('[auth] Failed to save session:', e); }
}

function _clearSession() {
  localStorage.removeItem(AUTH_SESSION_KEY);
}

// Headers using the live access token when available, falls back to anon key.
function authedHeaders() {
  const session = _getSession();
  const bearer  = (session && session.access_token) ? session.access_token : SUPABASE_KEY;
  return {
    'Content-Type':  'application/json',
    'apikey':        SUPABASE_KEY,
    'Authorization': 'Bearer ' + bearer
  };
}

// ─── Auth functions (Step 5.1) ─────────────────────────────────────────────

// Sign in anonymously (students). Returns auth.uid() string or throws.
async function signInAnonymous() {
  if (!isSupabaseConfigured()) throw new Error('Supabase not configured');

  const existing = _getSession();
  if (existing && existing.user && existing.user.id) return existing.user.id;

  const resp = await fetch(SUPABASE_URL + '/auth/v1/signup', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY },
    body:    JSON.stringify({})
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error('[signInAnonymous] ' + (err.message || resp.status));
  }

  const session = await resp.json();
  _saveSession(session);
  return session.user.id;
}

// Sign in with email + password (educators and admins). Returns auth.uid() or throws.
async function signInWithEmail(email, password) {
  if (!isSupabaseConfigured()) throw new Error('Supabase not configured');

  const resp = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY },
    body:    JSON.stringify({ email, password })
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error('[signInWithEmail] ' + (err.message || resp.status));
  }

  const session = await resp.json();
  _saveSession(session);
  return session.user.id;
}

// Sign out. Clears local session regardless of network result.
async function signOut() {
  const session = _getSession();
  if (session && session.access_token && isSupabaseConfigured()) {
    try {
      await fetch(SUPABASE_URL + '/auth/v1/logout', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'apikey':        SUPABASE_KEY,
          'Authorization': 'Bearer ' + session.access_token
        }
      });
    } catch (e) {
      console.warn('[signOut] Network error, session cleared locally:', e);
    }
  }
  _clearSession();
}

// Returns { id, authUid, isAdmin } for the current session, or null if not signed in.
async function getCurrentUser() {
  const session = _getSession();
  if (!session || !session.user || !session.user.id) return null;

  const authUid = session.user.id;
  if (!isSupabaseConfigured()) return { id: null, authUid, isAdmin: false };

  try {
    const url = SUPABASE_URL
      + '/rest/v1/profiles?auth_uid=eq.' + encodeURIComponent(authUid)
      + '&select=id,is_admin&limit=1';

    const resp = await fetch(url, { headers: authedHeaders() });
    if (!resp.ok) return { id: null, authUid, isAdmin: false };

    const rows = await resp.json();
    if (!rows.length) return { id: null, authUid, isAdmin: false };

    return {
      id:      rows[0].id,
      authUid,
      isAdmin: rows[0].is_admin === true
    };
  } catch (e) {
    console.warn('[getCurrentUser] Lookup failed:', e);
    return { id: null, authUid, isAdmin: false };
  }
}

// ─── syncStore ─────────────────────────────────────────────────────────────

const syncStore = {

  save(key, data) {
    try {
      localStorage.setItem('nsg_' + key, JSON.stringify(data));
    } catch (e) {
      console.warn('[syncStore] localStorage write failed:', e);
    }
    if (key.startsWith('profile_') && isSupabaseConfigured()) {
      const entry = syncStore._buildProfileRow(data);
      syncStore._enqueue({ table: 'profiles', payload: entry });
      syncStore.processQueue();
    }
  },

  load(key) {
    try {
      const raw = localStorage.getItem('nsg_' + key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.warn('[syncStore] localStorage read failed:', e);
      return null;
    }
  },

  async fetchLeaderboard() {
    if (navigator.onLine && isSupabaseConfigured()) {
      try {
        const url = SUPABASE_URL
          + '/rest/v1/profiles?select=handle,country,stats&order=stats->cr.desc.nullslast&limit=100';
        const resp = await fetch(url, { headers: authedHeaders() });
        if (resp.ok) {
          const rows = await resp.json();
          localStorage.setItem(LEADERBOARD_CACHE_KEY, JSON.stringify(rows));
          localStorage.setItem(LEADERBOARD_TS_KEY, Date.now().toString());
          return rows;
        }
      } catch (e) {
        console.warn('[syncStore] Leaderboard fetch failed, using cache:', e);
      }
    }
    try {
      const cached = localStorage.getItem(LEADERBOARD_CACHE_KEY);
      return cached ? JSON.parse(cached) : [];
    } catch (e) {
      return [];
    }
  },

  async processQueue() {
    if (!navigator.onLine || !isSupabaseConfigured()) return;
    const queue = syncStore._getQueue();
    if (!queue.length) return;
    const remaining = [];
    for (const item of queue) {
      try {
        const url  = SUPABASE_URL + '/rest/v1/' + item.table;
        const resp = await fetch(url, {
          method:  'POST',
          headers: authedHeaders(),
          body:    JSON.stringify(item.payload)
        });
        if (!resp.ok) {
          console.warn('[syncStore] Sync failed for', item.table, resp.status);
          remaining.push(item);
        }
      } catch (e) {
        remaining.push(item);
      }
    }
    syncStore._saveQueue(remaining);
  },

  _buildProfileRow(p) {
    return {
      player_id:  p.id,
      handle:     p.handle    || null,
      country:    p.country   || null,
      birth_year: p.birthYear || null,
      stats:      p.stats     || {},
      updated_at: new Date().toISOString()
    };
  },

  _getQueue() {
    try {
      const raw = localStorage.getItem(SYNC_QUEUE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  },

  _saveQueue(queue) {
    try {
      localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
    } catch (e) { console.warn('[syncStore] Queue save failed:', e); }
  },

  _enqueue(item) {
    const queue    = syncStore._getQueue();
    const existing = queue.findIndex(
      q => q.table === item.table &&
           q.payload && item.payload &&
           q.payload.player_id === item.payload.player_id
    );
    if (existing >= 0) {
      queue[existing] = item;
    } else {
      queue.push(item);
    }
    syncStore._saveQueue(queue);
  }

};

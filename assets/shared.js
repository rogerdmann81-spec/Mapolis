// assets/shared.js
// Mapolis shared data layer — loaded by both play/index.html and admin/index.html

// ─── Supabase constants ────────────────────────────────────────────────────

function _sanitizeSupabaseUrl(url) {
  if (!url || typeof url !== 'string') return 'https://tbibeuwpollcrlvowcpg.supabase.co';
  return url.trim().replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
}

const SUPABASE_URL = _sanitizeSupabaseUrl((typeof window !== 'undefined' && window.ENV && window.ENV.SUPABASE_URL) || 'https://tbibeuwpollcrlvowcpg.supabase.co');
const SUPABASE_KEY = (typeof window !== 'undefined' && window.ENV && window.ENV.SUPABASE_ANON_KEY) || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRiaWJldXdwb2xsY3Jsdm93Y3BnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxODg5MTUsImV4cCI6MjA5MTc2NDkxNX0.2fIzL1Fn0aKLwCfOjOMXXQV-3WtvbwY4YoanJJ-Vys8';

if (typeof window !== 'undefined') {
  window.SUPABASE_URL = SUPABASE_URL;
  window.SUPABASE_KEY = SUPABASE_KEY;
}

const SYNC_QUEUE_KEY = 'nsg_syncQueue';
const LEADERBOARD_CACHE_KEY = 'nsg_leaderboard_cache';
const LEADERBOARD_TS_KEY = 'nsg_leaderboard_ts';

// ─── Supabase helpers ──────────────────────────────────────────────────────

function isSupabaseConfigured() {
  return SUPABASE_URL !== 'https://your-project.supabase.co'
    && SUPABASE_KEY !== 'your-anon-key-here';
}

function supabaseHeaders() {
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Prefer': 'resolution=merge-duplicates'
  };
}

let _supabaseClient = null;
function getSupabase() {
  if (!_supabaseClient && typeof window !== 'undefined' && window.supabase) {
    _supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  }
  return _supabaseClient;
}

// ─── Auth session storage ──────────────────────────────────────────────────

const AUTH_SESSION_KEY = 'mapolis_auth_session';
let _memorySession = null;

function _getSession() {
  try {
    const raw = localStorage.getItem(AUTH_SESSION_KEY);
    return raw ? JSON.parse(raw) : _memorySession;
  } catch (e) { return _memorySession; }
}

function _saveSession(session) {
  _memorySession = session;
  try { localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session)); }
  catch (e) { console.warn('[auth] Failed to save session to localStorage, using memory:', e); }
}

function _clearSession() {
  _memorySession = null;
  try { localStorage.removeItem(AUTH_SESSION_KEY); } catch (e) {}
}

// Headers using the live access token when available, falls back to anon key.
function authedHeaders() {
  const session = _getSession();
  const bearer = (session && session.access_token) ? session.access_token : SUPABASE_KEY;
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + bearer
  };
}

// ─── Auth functions (Step 5.1 + 5.2.1) ─────────────────────────────────────

// Sign in anonymously (students). Returns auth.uid() string or throws.
// Reuses the stored session if its access token is still valid; otherwise
// attempts a refresh using the stored refresh_token; otherwise mints a new
// anonymous session.
async function signInAnonymous() {
  if (!isSupabaseConfigured()) throw new Error('Supabase not configured');

  const existing = _getSession();
  if (existing && existing.user && existing.user.id) {
    const nowSec = Math.floor(Date.now() / 1000);
    const buffer = 60; // refresh if within 60s of expiry
    if (existing.expires_at && existing.expires_at > nowSec + buffer) {
      return existing.user.id; // token still valid
    }
    if (existing.refresh_token) {
      try {
        const rr = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=refresh_token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY },
          body: JSON.stringify({ refresh_token: existing.refresh_token })
        });
        if (rr.ok) {
          const refreshed = await rr.json();
          _saveSession(refreshed);
          return refreshed.user.id;
        }
        console.warn('[signInAnonymous] refresh rejected (' + rr.status + '), creating new anonymous session');
      } catch (e) {
        console.warn('[signInAnonymous] refresh threw, creating new anonymous session:', e);
      }
    }
    _clearSession(); // stale session unusable — fall through to fresh signup
  }

  const resp = await fetch(SUPABASE_URL + '/auth/v1/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY },
    body: JSON.stringify({})
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error('[signInAnonymous] ' + (err.message || resp.status));
  }

  const session = await resp.json();
  _saveSession(session);
  return session.user.id;
}

// Ensures an active session exists (valid token or anonymous session).
// Returns the access_token or null.
async function ensureAuthSession() {
  if (!isSupabaseConfigured()) return null;
  const sess = _getSession();
  const nowSec = Math.floor(Date.now() / 1000);
  if (sess && sess.access_token && sess.expires_at && sess.expires_at > nowSec + 30) {
    return sess.access_token;
  }
  try {
    await signInAnonymous();
    const fresh = _getSession();
    return (fresh && fresh.access_token) || null;
  } catch (e) {
    console.warn('[ensureAuthSession] error establishing session:', e);
    return null;
  }
}

// Sign in with email + password (educators and admins). Returns auth.uid() or throws.
async function signInWithEmail(email, password) {
  if (!isSupabaseConfigured()) throw new Error('Supabase not configured');

  const resp = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY },
    body: JSON.stringify({ email, password })
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
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': 'Bearer ' + session.access_token
        }
      });
    } catch (e) {
      console.warn('[signOut] Network error, session cleared locally:', e);
    }
  }
  _clearSession();
}

// Generates an RFC 4122 v4 UUID. Prefers crypto.randomUUID() (all modern
// browsers, secure context). Falls back to Math.random-based shim only if
// crypto.randomUUID is unavailable.
function mapolisUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// Step 5.2.1 — persist a newly created profile to Supabase via the
// create_profile RPC. SECURITY DEFINER function reads auth_uid from
// auth.uid(), so we don't pass it. Returns the new player_id on success,
// throws on failure (e.g. handle_taken, network error, not_authenticated).
async function createProfile(opts) {
  if (!isSupabaseConfigured()) throw new Error('Supabase not configured');
  if (!opts || !opts.playerId || !opts.handle) {
    throw new Error('[createProfile] missing required fields');
  }

  const resp = await fetch(SUPABASE_URL + '/rest/v1/rpc/create_profile', {
    method: 'POST',
    headers: authedHeaders(),
    body: JSON.stringify({
      p_player_id: opts.playerId,
      p_handle: opts.handle,
      p_birth_year: opts.birthYear || null,
      p_country: opts.country || null,
      p_parent_email: opts.parentEmail || null,
      p_password_hash: opts.passwordHash || null,
      p_consent_age: opts.consentAge || null
    })
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error('[createProfile] ' + (err.message || err.code || resp.status));
  }

  return await resp.json(); // returns the player_id UUID
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
      id: rows[0].id,
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

  _mapRowToProfile(row, authUid) {
    return {
      id: row.player_id,
      handle: row.handle || '',
      birthYear: row.birth_year || null,
      country: row.country || '',
      stats: row.stats || { cr: 0, totalAnswered: 0, totalCorrect: 0 },
      badges: row.badges || [],
      accessories: row.accessories || [],
      avatar: { face: row.avatar_face || '🧑', selections: row.avatar_selections || null, svg: row.avatar_svg || null },
      unlockedAvatar: row.unlocked_avatar || null,
      linkCode: row.link_code || null,
      passwordHash: row.password_hash || null,
      parentEmail: row.parent_email || null,
      auth_uid: authUid,
      frozen: row.frozen === true,
      isAdmin: row.is_admin === true,
      createdAt: row.created_at || new Date().toISOString(),
      updatedAt: row.updated_at || row.created_at || new Date().toISOString()
    };
  },

  async fetchProfiles(authUid, localProfileIds = []) {
    if (!navigator.onLine || !isSupabaseConfigured()) return null;
    try {
      let query = '';
      const validIds = Array.isArray(localProfileIds) ? localProfileIds.filter(Boolean) : [];
      if (authUid && validIds.length > 0) {
        query = '?or=(auth_uid.eq.' + encodeURIComponent(authUid) + ',player_id.in.(' + validIds.map(encodeURIComponent).join(',') + '))';
      } else if (authUid) {
        query = '?auth_uid=eq.' + encodeURIComponent(authUid);
      } else if (validIds.length > 0) {
        query = '?player_id=in.(' + validIds.map(encodeURIComponent).join(',') + ')';
      } else {
        return null;
      }
      const url = SUPABASE_URL + '/rest/v1/profiles' + query;
      const resp = await fetch(url, { headers: authedHeaders() });
      if (resp.ok) {
        const rows = await resp.json();
        return rows.map(r => this._mapRowToProfile(r, authUid || r.auth_uid));
      }
      console.warn('[syncStore] fetchProfiles failed:', resp.status);
    } catch (e) {
      console.warn('[syncStore] fetchProfiles error:', e);
    }
    return null;
  },

  async fetchProfileById(playerId) {
    if (!navigator.onLine || !isSupabaseConfigured() || !playerId) return null;
    try {
      const url = SUPABASE_URL + '/rest/v1/profiles?player_id=eq.' + encodeURIComponent(playerId);
      const resp = await fetch(url, { headers: authedHeaders() });
      if (resp.ok) {
        const rows = await resp.json();
        if (rows && rows.length > 0) {
          const authUid = (typeof _getSession === 'function' && _getSession() && _getSession().user) ? _getSession().user.id : rows[0].auth_uid;
          return this._mapRowToProfile(rows[0], authUid);
        }
      }
      console.warn('[syncStore] fetchProfileById failed:', resp.status);
    } catch (e) {
      console.warn('[syncStore] fetchProfileById error:', e);
    }
    return null;
  },

  syncProfile(profile) {
    if (!profile || !profile.id) return;
    const entry = this._buildProfileRow(profile);
    this._enqueue({ table: 'profiles', payload: entry });
    this.processQueue();
  },

  syncClassroom(classroom) {
    this._enqueue({ table: 'classrooms', payload: classroom });
    this.processQueue();
  },

  syncClassroomMember(member) {
    this._enqueue({ table: 'classroom_members', payload: member });
    this.processQueue();
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
        const url = SUPABASE_URL + '/rest/v1/' + item.table + (item.table === 'profiles' ? '?on_conflict=player_id' : '');
        const hdrs = authedHeaders();
        if (item.table === 'profiles') {
          hdrs['Prefer'] = 'resolution=merge-duplicates';
        }
        const resp = await fetch(url, {
          method: 'POST',
          headers: hdrs,
          body: JSON.stringify(item.payload)
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
      player_id: p.id,
      auth_uid: p.auth_uid || (typeof _getSession === 'function' && _getSession() && _getSession().user ? _getSession().user.id : null),
      handle: p.handle || null,
      country: p.country || null,
      birth_year: p.birthYear || null,
      stats: p.stats || {},
      badges: p.badges || [],
      accessories: p.accessories || [],
      avatar_face: p.avatar && p.avatar.face ? p.avatar.face : null,
      avatar_svg: p.avatar && p.avatar.svg ? p.avatar.svg : null,
      avatar_selections: p.avatar && p.avatar.selections ? p.avatar.selections : null,
      unlocked_avatar: p.unlockedAvatar || null,
      link_code: p.linkCode || null,
      password_hash: p.passwordHash || null,
      parent_email: p.parentEmail || null,
      updated_at: new Date().toISOString()
    };
  },

  _getQueue() {
    try {
      const raw = localStorage.getItem(SYNC_QUEUE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  },
  _saveQueue(q) {
    try {
      localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(q));
    } catch (e) { console.warn('[syncStore] Queue save failed:', e); }
  },
  _enqueue(item) {
    const queue = syncStore._getQueue();
    // Dedup: if updating the same profile, replace it.
    if (item.table === 'profiles') {
      const existing = queue.findIndex(q => q.table === 'profiles' && q.payload.player_id === item.payload.player_id);
      if (existing >= 0) {
        queue[existing] = item;
        syncStore._saveQueue(queue);
        return;
      }
    }
    queue.push(item);
    syncStore._saveQueue(queue);
  }
};


// ─── Profile Merge Engine ──────────────────────────────────────────────────
// Implements session-tracked delta merging for progress/stars and latest-timestamp
// precedence for cosmetics, preventing lost achievements across devices.
function mergeProfiles(local, remote) {
  if (!local && !remote) return null;
  if (!local) return remote;
  if (!remote) return local;

  const result = { ...remote, ...local };

  // 1. Resolve cosmetics by updatedAt timestamp (newest equipped look wins)
  const localTs = local.updatedAt ? new Date(local.updatedAt).getTime() : 0;
  const remoteTs = remote.updatedAt ? new Date(remote.updatedAt).getTime() : 0;
  if (remoteTs > localTs) {
    result.avatar = remote.avatar || local.avatar;
    result.handle = remote.handle || local.handle;
    result.country = remote.country || local.country;
    result.birthYear = remote.birthYear || local.birthYear;
  } else {
    result.avatar = local.avatar || remote.avatar;
    result.handle = local.handle || remote.handle;
    result.country = local.country || remote.country;
    result.birthYear = local.birthYear || remote.birthYear;
  }
  result.updatedAt = new Date(Math.max(localTs, remoteTs, Date.now())).toISOString();

  // 2. Badges: Strict Set Union (an earned badge is NEVER lost)
  const badgeSet = new Set([...(local.badges || []), ...(remote.badges || [])]);
  result.badges = Array.from(badgeSet);

  // 3. Accessories: Strict Set Union
  const accSet = new Set([...(local.accessories || []), ...(remote.accessories || [])]);
  result.accessories = Array.from(accSet);

  // 4. Store Unlocks (unlockedAvatar types & packs): Object Union
  const lTypes = (local.unlockedAvatar && local.unlockedAvatar.types) || {};
  const rTypes = (remote.unlockedAvatar && remote.unlockedAvatar.types) || {};
  const lPacks = (local.unlockedAvatar && local.unlockedAvatar.packs) || {};
  const rPacks = (remote.unlockedAvatar && remote.unlockedAvatar.packs) || {};
  result.unlockedAvatar = {
    types: { ...rTypes, ...lTypes },
    packs: { ...rPacks, ...lPacks }
  };

  // 5. Stats Reconciliation
  const lStats = local.stats || {};
  const rStats = remote.stats || {};
  const mergedStats = { ...rStats, ...lStats };

  // A. Mastered cards/territories: Union
  mergedStats.mastered = { ...(rStats.mastered || {}), ...(lStats.mastered || {}) };

  // B. Day History (Heatmap): Deduplicated date set union, sorted
  const daySet = new Set([...(lStats.dayHistory || []), ...(rStats.dayHistory || [])]);
  mergedStats.dayHistory = Array.from(daySet).sort();

  // C. High water marks for single-best records
  mergedStats.bestStreak = Math.max(lStats.bestStreak || 0, rStats.bestStreak || 0);

  // D. H2H stats merge
  const lH2H = lStats.h2h || {};
  const rH2H = rStats.h2h || {};
  mergedStats.h2h = {
    ...rH2H,
    ...lH2H,
    rating: (remoteTs > localTs ? (rH2H.rating ?? lH2H.rating) : (lH2H.rating ?? rH2H.rating)) ?? 1200,
    matches: Math.max(lH2H.matches || 0, rH2H.matches || 0),
    wins: Math.max(lH2H.wins || 0, rH2H.wins || 0),
    losses: Math.max(lH2H.losses || 0, rH2H.losses || 0),
    ties: Math.max(lH2H.ties || 0, rH2H.ties || 0),
    bestStreak: Math.max(lH2H.bestStreak || 0, rH2H.bestStreak || 0),
    currentStreak: remoteTs > localTs ? (rH2H.currentStreak || 0) : (lH2H.currentStreak || 0)
  };

  // E. Session-tracked Stars (cr) & Play Counts
  const lSessions = lStats.processedSessions || {};
  const rSessions = rStats.processedSessions || {};
  const mergedSessions = { ...rSessions, ...lSessions };

  // Calculate base stars from the profile with more baseline or higher timestamp
  let baseCR = remoteTs > localTs ? (rStats.cr || 0) : (lStats.cr || 0);
  let baseAnswered = remoteTs > localTs ? (rStats.totalAnswered || 0) : (lStats.totalAnswered || 0);
  let baseCorrect = remoteTs > localTs ? (rStats.totalCorrect || 0) : (lStats.totalCorrect || 0);
  let baseGames = remoteTs > localTs ? (rStats.gamesPlayed || 0) : (lStats.gamesPlayed || 0);

  // Add any unapplied sessions from the other side
  if (remoteTs > localTs) {
    // Remote is baseline, apply local sessions that remote didn't have
    for (const [sessId, sess] of Object.entries(lSessions)) {
      if (!rSessions[sessId]) {
        baseCR += (sess.crGain || 0);
        baseAnswered += (sess.answered || 0);
        baseCorrect += (sess.correct || 0);
        baseGames += (sess.gamesPlayed || 0);
      }
    }
  } else {
    // Local is baseline, apply remote sessions that local didn't have
    for (const [sessId, sess] of Object.entries(rSessions)) {
      if (!lSessions[sessId]) {
        baseCR += (sess.crGain || 0);
        baseAnswered += (sess.answered || 0);
        baseCorrect += (sess.correct || 0);
        baseGames += (sess.gamesPlayed || 0);
      }
    }
  }

  // Safety floor: Stars can never drop below the high-water mark of either profile
  mergedStats.cr = Math.max(baseCR, lStats.cr || 0, rStats.cr || 0);
  mergedStats.totalAnswered = Math.max(baseAnswered, lStats.totalAnswered || 0, rStats.totalAnswered || 0);
  mergedStats.totalCorrect = Math.max(baseCorrect, lStats.totalCorrect || 0, rStats.totalCorrect || 0);
  mergedStats.gamesPlayed = Math.max(baseGames, lStats.gamesPlayed || 0, rStats.gamesPlayed || 0);

  // Prune processed sessions to last 100 to prevent unbounded storage
  const sessionEntries = Object.entries(mergedSessions);
  if (sessionEntries.length > 100) {
    sessionEntries.sort((a, b) => (a[1].ts || '').localeCompare(b[1].ts || ''));
    const pruned = {};
    for (const [k, v] of sessionEntries.slice(-100)) {
      pruned[k] = v;
    }
    mergedStats.processedSessions = pruned;
  } else {
    mergedStats.processedSessions = mergedSessions;
  }

  result.stats = mergedStats;
  return result;
}

// ─── Solo Game Round Submission & Ledger Cache ──────────────────────────────
const PENDING_ROUNDS_KEY = 'mapolis_pending_rounds';

function getPendingRounds() {
  try {
    const raw = localStorage.getItem(PENDING_ROUNDS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function cachePendingRound(roundData) {
  if (!roundData || !roundData.session || !roundData.session.id) return;
  const pending = getPendingRounds();
  if (!pending.some(r => r.session && r.session.id === roundData.session.id)) {
    pending.push(roundData);
    try {
      localStorage.setItem(PENDING_ROUNDS_KEY, JSON.stringify(pending));
    } catch (e) {
      console.warn('[cachePendingRound] localStorage write failed:', e);
    }
  }
}

function clearPendingRound(sessionId) {
  if (!sessionId) return;
  const pending = getPendingRounds().filter(r => r.session && r.session.id !== sessionId);
  try {
    localStorage.setItem(PENDING_ROUNDS_KEY, JSON.stringify(pending));
  } catch (e) {
    console.warn('[clearPendingRound] localStorage write failed:', e);
  }
}

async function submitRound(roundData) {
  if (!roundData || !roundData.session) return { success: false, error: 'No round data' };

  if (typeof window !== 'undefined' && window.location && window.location.search && window.location.search.indexOf('debug=1') !== -1) {
    console.log('[submitRound] Submitting round payload:', roundData);
  }

  if (!navigator.onLine || !isSupabaseConfigured()) {
    cachePendingRound(roundData);
    return { success: false, offline: true };
  }

  try {
    const url = SUPABASE_URL + '/rest/v1/rpc/submit_round';
    const resp = await fetch(url, {
      method: 'POST',
      headers: authedHeaders(),
      body: JSON.stringify({ payload: roundData })
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      console.warn('[submitRound] RPC failed with status ' + resp.status + ':', err);
      cachePendingRound(roundData);
      return { success: false, error: err };
    }

    const data = await resp.json().catch(() => null);
    clearPendingRound(roundData.session.id);
    // Flush any older queued rounds since connectivity is confirmed
    flushPendingRounds().catch(() => {});
    return { success: true, sessionId: data };
  } catch (err) {
    console.warn('[submitRound] Network error during submission, caching:', err);
    cachePendingRound(roundData);
    return { success: false, error: err };
  }
}

async function flushPendingRounds() {
  const pending = getPendingRounds();
  if (!pending.length || !navigator.onLine || !isSupabaseConfigured()) return;

  for (const round of pending) {
    try {
      const url = SUPABASE_URL + '/rest/v1/rpc/submit_round';
      const resp = await fetch(url, {
        method: 'POST',
        headers: authedHeaders(),
        body: JSON.stringify({ payload: round })
      });
      if (resp.ok) {
        clearPendingRound(round.session.id);
      } else {
        console.warn('[flushPendingRounds] Round retry returned ' + resp.status + ', halting flush');
        break;
      }
    } catch (e) {
      console.warn('[flushPendingRounds] Round retry failed network check, halting flush');
      break;
    }
  }
}

if (typeof window !== 'undefined') {
  window.syncStore = syncStore;
  window.mapolisUUID = mapolisUUID;
  window.mergeProfiles = mergeProfiles;
  window.submitRound = submitRound;
  window.flushPendingRounds = flushPendingRounds;
  window.getPendingRounds = getPendingRounds;
  window.ensureAuthSession = ensureAuthSession;
  window.isSupabaseConfigured = isSupabaseConfigured;
  window.authedHeaders = authedHeaders;
  window.signInAnonymous = signInAnonymous;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { syncStore, mapolisUUID, mergeProfiles, submitRound, flushPendingRounds, getPendingRounds, ensureAuthSession };
}

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
      avatar: { face: row.avatar_face || '🧑', selections: row.avatar_selections || null, svg: row.avatar_svg || null },
      unlockedAvatar: row.unlocked_avatar || null,
      linkCode: row.link_code || null,
      passwordHash: row.password_hash || null,
      parentEmail: row.parent_email || null,
      auth_uid: authUid,
      frozen: row.frozen === true,
      isAdmin: row.is_admin === true,
      createdAt: row.created_at || new Date().toISOString()
    };
  },

  async fetchProfiles(authUid) {
    if (!navigator.onLine || !isSupabaseConfigured() || !authUid) return null;
    try {
      const url = SUPABASE_URL + '/rest/v1/profiles?auth_uid=eq.' + encodeURIComponent(authUid);
      const resp = await fetch(url, { headers: authedHeaders() });
      if (resp.ok) {
        const rows = await resp.json();
        return rows.map(r => this._mapRowToProfile(r, authUid));
      }
      console.warn('[syncStore] fetchProfiles failed:', resp.status);
    } catch (e) {
      console.warn('[syncStore] fetchProfiles error:', e);
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
        const url = SUPABASE_URL + '/rest/v1/' + item.table;
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
      handle: p.handle || null,
      country: p.country || null,
      birth_year: p.birthYear || null,
      stats: p.stats || {},
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

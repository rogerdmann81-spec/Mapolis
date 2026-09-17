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

/**
 * Mapolis Pre-Beta6 Feature Module
 * - Compliance-Safe Friends, Exact Handle/Code Search, Clickable Leaderboard Player Cards,
 *   Instant 6-Character Private H2H Rooms & Direct Challenges (Friendly vs Ranked)
 * - Always-Unlocked World Atlas & Country Genesis Cards (200 countries/territories)
 *   with live D3 TopoJSON country silhouettes
 */
(function (root) {
  'use strict';

  // ── Pure, Unit-Testable Helpers ──────────────────────────────────────────

  const ORIGIN_META = {
    continuity:     { icon: '🏺', label: 'Historic Continuity' },
    unification:    { icon: '🤝', label: 'National Unification' },
    dissolution:    { icon: '🏛️', label: 'Imperial Dissolution' },
    decolonization: { icon: '🕊️', label: 'Decolonization' },
    partition:      { icon: '🧭', label: 'Post-Colonial Partition' },
    treaty:         { icon: '📜', label: 'Treaty & Borders' },
    federation:     { icon: '🗺️', label: 'Federation & Independence' }
  };

  const CONTINENT_META = [
    { id: 'all',           label: 'All' },
    { id: 'europe',        label: 'Europe' },
    { id: 'africa',        label: 'Africa' },
    { id: 'asia',          label: 'Asia' },
    { id: 'north-america', label: 'N. America' },
    { id: 'south-america', label: 'S. America' },
    { id: 'oceania',       label: 'Oceania' }
  ];

  const CONTINENT_LABELS = {
    europe: 'Europe',
    africa: 'Africa',
    asia: 'Asia',
    'north-america': 'North America',
    'south-america': 'South America',
    oceania: 'Oceania'
  };

  function normalizeFriendQuery(raw) {
    const cleaned = String(raw || '').trim();
    if (!cleaned) return { ok: false, query: '', kind: 'empty' };
    // Strip leading @ if entered
    const stripped = cleaned.startsWith('@') ? cleaned.slice(1).trim() : cleaned;
    // Block SQL wildcard characters on client too (server already uses strict equality)
    if (stripped.includes('%') || stripped.includes('*')) {
      return { ok: false, query: '', kind: 'wildcard_disallowed' };
    }
    if (stripped.length < 2 || stripped.length > 40) {
      return { ok: false, query: stripped, kind: 'length_invalid' };
    }
    const alnum = stripped.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (alnum.length === 7 && alnum.startsWith('MAP')) {
      return { ok: true, query: 'MAP-' + alnum.slice(3), kind: 'friend_code' };
    }
    if (/^MAP-[A-Z0-9]{4,6}$/i.test(stripped)) {
      return { ok: true, query: stripped.toUpperCase(), kind: 'friend_code' };
    }
    return { ok: true, query: stripped, kind: 'handle' };
  }

  function normalizeRoomCodeInput(raw) {
    return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  }

  function formatRoomCodeDisplay(code) {
    const clean = normalizeRoomCodeInput(code);
    if (clean.length === 6) return clean.slice(0, 3) + '-' + clean.slice(3);
    return clean;
  }

  function _getCardsArray(dataset) {
    if (!dataset || !dataset.cards) return [];
    return Array.isArray(dataset.cards) ? dataset.cards : Object.values(dataset.cards);
  }

  function resolveGenesisCard(dataset, idOrName) {
    if (!dataset || !dataset.cards || idOrName === null || idOrName === undefined) return null;
    const raw = String(idOrName).trim();
    if (!raw) return null;

    const allCards = _getCardsArray(dataset);
    const byId = new Map();
    for (let i = 0; i < allCards.length; i++) {
      if (allCards[i] && allCards[i].id) byId.set(String(allCards[i].id).toLowerCase(), allCards[i]);
    }

    const lower = raw.toLowerCase();
    // 1. Direct id lookup
    if (byId.has(lower)) return byId.get(lower);

    // 2. Alias lookup (e.g. turkey_eu -> turkey)
    if (dataset.aliases && dataset.aliases[lower]) {
      const target = String(dataset.aliases[lower]).toLowerCase();
      if (byId.has(target)) return byId.get(target);
    }

    // 3. Prefixed mistake ID cleanup (e.g. country_france, flag_japan, capital_brazil)
    const strippedPrefix = lower.replace(/^(country|capital|flag)_/, '');
    if (byId.has(strippedPrefix)) return byId.get(strippedPrefix);
    if (dataset.aliases && dataset.aliases[strippedPrefix]) {
      const target2 = String(dataset.aliases[strippedPrefix]).toLowerCase();
      if (byId.has(target2)) return byId.get(target2);
    }

    // 4. Numeric ISO-3166-1 ID match
    if (/^\d+$/.test(raw)) {
      const num = parseInt(raw, 10);
      const byNum = allCards.find(c => Number(c.numId) === num);
      if (byNum) return byNum;
    }

    // 5. Exact country name or capital match (case-insensitive)
    const normSpace = strippedPrefix.replace(/_/g, ' ');
    const exact = allCards.find(c =>
      (c.name && c.name.toLowerCase() === lower) ||
      (c.name && c.name.toLowerCase() === normSpace) ||
      (c.capital && c.capital.toLowerCase() === lower) ||
      (c.capital && c.capital.toLowerCase() === normSpace)
    );
    if (exact) return exact;

    return null;
  }

  function filterGenesisCards(cardsList, filters) {
    const list = Array.isArray(cardsList) ? cardsList : Object.values(cardsList || {});
    const f = filters || {};
    const cont = f.continent || 'all';
    const origin = f.originType || 'all';
    const q = String(f.search || '').trim().toLowerCase();

    return list.filter(c => {
      if (!c) return false;
      if (cont !== 'all' && c.continent !== cont) return false;
      if (origin !== 'all' && c.originType !== origin) return false;
      if (q) {
        const hay = ((c.name || '') + ' ' + (c.capital || '') + ' ' + (c.modernYear || '') + ' ' + (c.originLabel || '') + ' ' + (c.id || '')).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }

  // Export pure helpers immediately for Node unit tests
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      ORIGIN_META,
      CONTINENT_META,
      CONTINENT_LABELS,
      normalizeFriendQuery,
      normalizeRoomCodeInput,
      formatRoomCodeDisplay,
      resolveGenesisCard,
      filterGenesisCards
    };
  }

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  // ── Shared Browser Utilities ─────────────────────────────────────────────

  function esc(str) {
    if (typeof window.escHtml === 'function') return window.escHtml(String(str == null ? '' : str));
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeAva(svg) {
    if (typeof window._safeAvaSvg === 'function') return window._safeAvaSvg(svg);
    if (typeof window.sanitizeAvatarSvgUrl === 'function') return window.sanitizeAvatarSvgUrl(svg);
    return null;
  }

  function avatarMarkup(svgUrl, face, sizePx) {
    const s = sizePx || 40;
    const safe = safeAva(svgUrl);
    if (safe) {
      return '<div style="width:' + s + 'px;height:' + s + 'px;border-radius:50%;overflow:hidden;background:#1a2748;flex-shrink:0;border:1px solid rgba(91,143,255,.28);">' +
        '<img src="' + esc(safe) + '" alt="" style="width:100%;height:100%;object-fit:cover;display:block;">' +
        '</div>';
    }
    return '<div style="width:' + s + 'px;height:' + s + 'px;border-radius:50%;background:#1a2748;flex-shrink:0;border:1px solid rgba(91,143,255,.28);display:flex;align-items:center;justify-content:center;font-size:' + Math.round(s * 0.52) + 'px;">' +
      esc(face || '🧑') +
      '</div>';
  }

  function toast(msg, ms) {
    if (typeof window.showToast === 'function') {
      window.showToast(msg, ms || 2200);
    }
  }

  function copyText(text, label) {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        toast((label || 'Copied') + ': ' + text, 1800);
      }).catch(function () {
        toast(text, 2200);
      });
    } else {
      toast(text, 2200);
    }
  }

  function getActiveProfile() {
    return window.activeProfile || null;
  }

  function getPlayerTier(profile) {
    try {
      var grade = (profile && typeof window.estimateGrade === 'function') ? window.estimateGrade(profile) : 6;
      grade = Math.max(1, Math.min(13, Math.floor(grade)));
      if (typeof window.getTierCeiling === 'function') return window.getTierCeiling(grade, 'medium');
      return grade;
    } catch (_) {
      return 6;
    }
  }

  function buildCandidateFriendDeck(tier) {
    try {
      if (typeof window.buildH2HDeck === 'function') {
        return window.buildH2HDeck({ continent: 'globe' }, { continent: 'globe' }, tier || 6, 'room_' + Date.now());
      }
    } catch (_) {}
    return null;
  }

  // ── Direct Match Launch Bridge into Existing H2H Pipeline ────────────────

  function launchDirectH2HMatch(matchData) {
    stopRoomPoll();
    closeOverlayModal('mapolis-challenge-wait-modal');
    closeOverlayModal('mapolis-player-card-modal');
    closeOverlayModal('mapolis-h2h-picker-modal');
    dismissChallengeBanner();

    if (typeof window.launchFriendH2HMatch === 'function') {
      window.launchFriendH2HMatch(matchData);
      return;
    }
    toast('Match ready! Opening setup…', 1500);
  }

  // ── Generic Clean Modal Helper ───────────────────────────────────────────

  function closeOverlayModal(id) {
    var el = document.getElementById(id);
    if (el) el.remove();
  }

  function createOverlayModal(id, innerHtml, options) {
    closeOverlayModal(id);
    var opts = options || {};
    var maxW = opts.maxWidth || '420px';
    var overlay = document.createElement('div');
    overlay.id = id;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:9500',
      'background:rgba(4,9,26,0.82)', 'backdrop-filter:blur(6px)',
      'display:flex', 'align-items:center', 'justify-content:center',
      'padding:16px', 'overflow-y:auto'
    ].join(';');

    var sheet = document.createElement('div');
    sheet.style.cssText = [
      'width:100%', 'max-width:' + maxW,
      'max-height:90vh', 'overflow-y:auto',
      'background:#0e1738', 'border:1px solid rgba(91,143,255,0.28)',
      'border-radius:18px', 'padding:20px',
      'box-shadow:0 20px 50px rgba(0,0,0,0.6)',
      'color:#eef2ff', 'position:relative'
    ].join(';');
    sheet.innerHTML = innerHtml;
    overlay.appendChild(sheet);

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay && opts.backdropClose !== false) {
        if (typeof opts.onClose === 'function') opts.onClose();
        overlay.remove();
      }
    });

    document.body.appendChild(overlay);
    return { overlay: overlay, sheet: sheet };
  }

  // ── 1. H2H Mode Picker (Quick Match vs Play a Friend) ────────────────────

  function openH2HModePicker() {
    var html = '' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">' +
      '  <div>' +
      '    <h3 style="font-family:\'Fredoka One\',sans-serif;font-size:20px;margin:0;color:#fff;">Head to Head</h3>' +
      '    <div style="font-size:12px;color:var(--dim);margin-top:2px;">Choose how you want to play</div>' +
      '  </div>' +
      '  <button id="h2h-picker-close" aria-label="Close" style="background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);color:#cbd5e1;width:32px;height:32px;border-radius:10px;cursor:pointer;font-size:16px;">✕</button>' +
      '</div>' +
      '<div style="display:flex;flex-direction:column;gap:10px;">' +
      '  <button id="h2h-pick-quick" style="text-align:left;padding:15px 16px;background:rgba(59,110,248,.16);border:1px solid rgba(91,143,255,.45);border-radius:14px;cursor:pointer;color:#fff;display:flex;align-items:center;gap:14px;">' +
      '    <div style="font-size:26px;line-height:1;">⚔️</div>' +
      '    <div style="flex:1;">' +
      '      <div style="font-weight:800;font-size:15px;color:#fff;">Quick Match · Ranked</div>' +
      '      <div style="font-size:12px;color:#a5b4fc;margin-top:2px;line-height:1.35;">Match with a player near your ELO rating worldwide.</div>' +
      '    </div>' +
      '    <div style="color:#93c5fd;font-weight:800;">→</div>' +
      '  </button>' +
      '  <button id="h2h-pick-friend" style="text-align:left;padding:15px 16px;background:rgba(34,197,94,.12);border:1px solid rgba(74,222,128,.38);border-radius:14px;cursor:pointer;color:#fff;display:flex;align-items:center;gap:14px;">' +
      '    <div style="font-size:26px;line-height:1;">🤝</div>' +
      '    <div style="flex:1;">' +
      '      <div style="font-weight:800;font-size:15px;color:#fff;">Play a Friend</div>' +
      '      <div style="font-size:12px;color:#bbf7d0;margin-top:2px;line-height:1.35;">6-character Room Code, Friend List, or exact handle · Friendly or Ranked.</div>' +
      '    </div>' +
      '    <div style="color:#86efac;font-weight:800;">→</div>' +
      '  </button>' +
      '</div>';

    var m = createOverlayModal('mapolis-h2h-picker-modal', html, { maxWidth: '400px' });
    m.sheet.querySelector('#h2h-picker-close').addEventListener('click', function () { m.overlay.remove(); });
    m.sheet.querySelector('#h2h-pick-quick').addEventListener('click', function () {
      m.overlay.remove();
      if (typeof window.startH2HQueue === 'function') window.startH2HQueue();
    });
    m.sheet.querySelector('#h2h-pick-friend').addEventListener('click', function () {
      m.overlay.remove();
      if (typeof window.go === 'function') window.go('s-friends');
    });
  }

  // ── 2. Friends & Private Rooms Screen (#s-friends) ───────────────────────

  var _friendState = {
    loading: false,
    friendCode: null,
    allowRequests: true,
    friends: [],
    incoming: [],
    outgoing: [],
    blocked: [],
    roomRanked: false,
    activeRoom: null, // { room_id, room_code, is_ranked, expires_at, targetHandle }
    lookupResult: null,
    lookupMsg: '',
    joinMsg: '',
    showBlocked: false
  };

  var _roomPollTimer = null;
  var _roomTickTimer = null;

  function stopRoomPoll() {
    if (_roomPollTimer) { clearInterval(_roomPollTimer); _roomPollTimer = null; }
    if (_roomTickTimer) { clearInterval(_roomTickTimer); _roomTickTimer = null; }
  }

  function startRoomPolling(roomId, onStatusChange) {
    stopRoomPoll();
    var profile = getActiveProfile();
    if (!profile || !profile.id || !window.friendStore) return;

    _roomPollTimer = setInterval(async function () {
      if (!_friendState.activeRoom || _friendState.activeRoom.room_id !== roomId) {
        stopRoomPoll();
        return;
      }
      var res = await window.friendStore.pollRoom(profile.id, roomId);
      if (!res) return;
      if (res.status === 'matched') {
        _friendState.activeRoom = null;
        stopRoomPoll();
        launchDirectH2HMatch(res);
      } else if (res.status === 'declined' || res.status === 'expired' || res.status === 'cancelled') {
        _friendState.activeRoom = null;
        stopRoomPoll();
        if (typeof onStatusChange === 'function') onStatusChange(res.status);
        if (res.status === 'declined') toast('Challenge was declined', 2400);
        else if (res.status === 'expired') toast('Room code expired', 2400);
        if (window.currentScreen === 's-friends') renderFriendsScreen(false);
      }
    }, 2000);

    _roomTickTimer = setInterval(function () {
      var cdEl = document.getElementById('fr-room-countdown') || document.getElementById('chal-wait-countdown');
      if (!cdEl || !_friendState.activeRoom || !_friendState.activeRoom.expires_at) return;
      var rem = Math.max(0, Math.floor((new Date(_friendState.activeRoom.expires_at).getTime() - Date.now()) / 1000));
      var m = Math.floor(rem / 60);
      var s = rem % 60;
      cdEl.textContent = m + ':' + (s < 10 ? '0' : '') + s;
      if (rem <= 0) {
        _friendState.activeRoom = null;
        stopRoomPoll();
        closeOverlayModal('mapolis-challenge-wait-modal');
        if (window.currentScreen === 's-friends') renderFriendsScreen(false);
      }
    }, 1000);
  }

  async function refreshFriendsData() {
    var profile = getActiveProfile();
    if (!profile || !profile.id || !window.friendStore) return;
    _friendState.loading = true;
    var res = await window.friendStore.listFriends(profile.id);
    _friendState.loading = false;
    if (res && !res.offline && !res.error) {
      _friendState.friendCode = res.friend_code || _friendState.friendCode || profile.friend_code || '';
      if (res.friend_code && profile) profile.friend_code = res.friend_code;
      _friendState.allowRequests = (typeof res.allow_friend_requests === 'boolean') ? res.allow_friend_requests : true;
      _friendState.friends = Array.isArray(res.friends) ? res.friends : [];
      _friendState.incoming = Array.isArray(res.incoming) ? res.incoming : [];
      _friendState.outgoing = Array.isArray(res.outgoing) ? res.outgoing : [];
      _friendState.blocked = Array.isArray(res.blocked) ? res.blocked : [];
    } else if (!_friendState.friendCode && profile && profile.friend_code) {
      _friendState.friendCode = profile.friend_code;
    }
  }

  async function renderFriendsScreen(shouldFetch) {
    var rootEl = document.getElementById('friends-root');
    if (!rootEl) return;
    var profile = getActiveProfile();
    if (!profile) {
      rootEl.innerHTML = '<div style="padding:40px 20px;text-align:center;color:var(--dim);">Select a profile first to play with friends.</div>';
      return;
    }

    if (shouldFetch !== false && window.friendStore) {
      // Paint immediately with cached/initial state, then update once fetched
      paintFriendsDOM(rootEl, profile);
      await refreshFriendsData();
      if (window.currentScreen === 's-friends') {
        paintFriendsDOM(rootEl, profile);
      }
      return;
    }
    paintFriendsDOM(rootEl, profile);
  }

  function paintFriendsDOM(rootEl, profile) {
    var st = _friendState;
    var offline = (typeof navigator !== 'undefined' && navigator.onLine === false) ||
      (typeof window.isSupabaseConfigured === 'function' && !window.isSupabaseConfigured());

    var html = '<div style="max-width:520px;margin:0 auto;padding:14px 16px 36px;color:#eef2ff;">';

    // Top bar
    html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">' +
      '<button id="btn-friends-back" style="background:none;border:none;color:var(--dim);font-size:13px;font-weight:700;padding:6px 0;cursor:pointer;">← Back</button>' +
      '<div style="font-size:11px;color:var(--dim);">Zero chat · Mutual opt-in</div>' +
      '</div>';

    html += '<div style="text-align:center;margin-bottom:16px;">' +
      '<h2 style="font-family:\'Fredoka One\',sans-serif;font-size:24px;color:#fff;margin:0;">Play with Friends</h2>' +
      '<div style="font-size:12px;color:var(--dim);margin-top:3px;">Private Room Codes, Friend Codes, or exact handle lookup</div>' +
      '</div>';

    if (offline) {
      html += '<div style="background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.35);border-radius:12px;padding:12px 14px;font-size:12px;color:#fde68a;margin-bottom:14px;">' +
        '📡 Connect to the internet to create Private Rooms or link Friends. Solo play and World Atlas work offline.' +
        '</div>';
    }

    // Card 1: Instant Private H2H Room
    html += '<div style="background:var(--bg-panel);border:1px solid var(--border);border-radius:16px;padding:16px;margin-bottom:12px;">';
    html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;">' +
      '<div style="font-weight:800;font-size:14px;color:#fff;">Instant Private Room</div>' +
      '<div style="font-size:11px;color:var(--dim);">5-min code</div>' +
      '</div>';

    // Ranked / Friendly segmented toggle
    html += '<div style="display:flex;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:3px;gap:4px;margin-bottom:10px;">' +
      '<button id="fr-mode-friendly" style="flex:1;padding:7px 8px;border-radius:8px;border:none;font-size:12px;font-weight:700;cursor:pointer;background:' + (!st.roomRanked ? '#22c55e' : 'transparent') + ';color:' + (!st.roomRanked ? '#04120a' : 'var(--dim)') + ';">🤝 Friendly (Unranked)</button>' +
      '<button id="fr-mode-ranked" style="flex:1;padding:7px 8px;border-radius:8px;border:none;font-size:12px;font-weight:700;cursor:pointer;background:' + (st.roomRanked ? 'var(--blue)' : 'transparent') + ';color:' + (st.roomRanked ? '#fff' : 'var(--dim)') + ';">⚔️ Ranked (ELO)</button>' +
      '</div>';

    if (st.roomRanked) {
      html += '<div style="font-size:11px;color:#93c5fd;margin-bottom:10px;line-height:1.35;">ELO updates apply for up to 3 ranked matches per day between the same two players.</div>';
    }

    if (st.activeRoom && !st.activeRoom.targetHandle) {
      var remSec = Math.max(0, Math.floor((new Date(st.activeRoom.expires_at).getTime() - Date.now()) / 1000));
      var remText = Math.floor(remSec / 60) + ':' + (remSec % 60 < 10 ? '0' : '') + (remSec % 60);
      html += '<div style="background:rgba(59,110,248,.14);border:1px solid rgba(91,143,255,.4);border-radius:12px;padding:14px;text-align:center;margin-bottom:10px;">' +
        '<div style="font-size:11px;color:#a5b4fc;text-transform:uppercase;letter-spacing:.1em;">Share this Room Code · ' + (st.activeRoom.is_ranked ? 'Ranked' : 'Friendly') + '</div>' +
        '<div style="font-family:\'Space Mono\',monospace;font-size:28px;font-weight:700;letter-spacing:.14em;color:#fff;margin:6px 0;font-variant-numeric:tabular-nums;">' + esc(formatRoomCodeDisplay(st.activeRoom.room_code)) + '</div>' +
        '<div style="font-size:11px;color:var(--dim);margin-bottom:10px;">Waiting for opponent… expires in <span id="fr-room-countdown" style="font-family:\'Space Mono\',monospace;color:#fff;">' + remText + '</span></div>' +
        '<div style="display:flex;gap:8px;justify-content:center;">' +
        '  <button id="fr-copy-room" style="padding:8px 14px;border-radius:10px;border:1px solid rgba(91,143,255,.5);background:rgba(59,110,248,.22);color:#fff;font-size:12px;font-weight:700;cursor:pointer;">Copy Code</button>' +
        '  <button id="fr-cancel-room" style="padding:8px 14px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:transparent;color:var(--dim);font-size:12px;font-weight:700;cursor:pointer;">Cancel</button>' +
        '</div>' +
        '</div>';
    } else {
      html += '<button id="fr-create-room" ' + (offline ? 'disabled' : '') + ' style="width:100%;padding:11px;border-radius:12px;border:none;background:var(--yellow);color:#111;font-family:\'Fredoka One\',sans-serif;font-size:15px;cursor:pointer;margin-bottom:12px;' + (offline ? 'opacity:.5;cursor:not-allowed;' : '') + '">Create Private Room</button>';
    }

    // Join room input
    html += '<div style="display:flex;gap:8px;">' +
      '<input id="fr-join-input" type="text" maxlength="7" autocomplete="off" spellcheck="false" placeholder="Room code (e.g. K7M-2P9)" style="flex:1;min-width:0;padding:10px 12px;border-radius:10px;border:1px solid var(--border);background:var(--bg-deep);color:#fff;font-family:\'Space Mono\',monospace;font-size:13px;text-transform:uppercase;letter-spacing:.06em;">' +
      '<button id="fr-join-btn" ' + (offline ? 'disabled' : '') + ' style="padding:10px 16px;border-radius:10px;border:1px solid rgba(91,143,255,.5);background:rgba(59,110,248,.22);color:#fff;font-size:13px;font-weight:800;cursor:pointer;flex-shrink:0;">Join</button>' +
      '</div>';
    if (st.joinMsg) {
      html += '<div style="font-size:11px;color:#fca5a5;margin-top:6px;">' + esc(st.joinMsg) + '</div>';
    }
    html += '</div>';

    // Card 2: Exact Handle or Friend Code Lookup
    html += '<div style="background:var(--bg-panel);border:1px solid var(--border);border-radius:16px;padding:16px;margin-bottom:12px;">';
    html += '<div style="font-weight:800;font-size:14px;color:#fff;margin-bottom:3px;">Find a Friend</div>' +
      '<div style="font-size:11px;color:var(--dim);margin-bottom:10px;">Exact username or Friend Code only (no public browsing)</div>';

    html += '<div style="display:flex;gap:8px;">' +
      '<input id="fr-lookup-input" type="text" maxlength="32" autocomplete="off" spellcheck="false" placeholder="Exact handle or MAP-XXXX" style="flex:1;padding:10px 12px;border-radius:10px;border:1px solid var(--border);background:var(--bg-deep);color:#fff;font-size:13px;">' +
      '<button id="fr-lookup-btn" ' + (offline ? 'disabled' : '') + ' style="padding:10px 16px;border-radius:10px;border:1px solid rgba(91,143,255,.5);background:rgba(59,110,248,.22);color:#fff;font-size:13px;font-weight:800;cursor:pointer;">Search</button>' +
      '</div>';

    if (st.lookupMsg) {
      html += '<div style="font-size:12px;color:#fde68a;margin-top:8px;">' + esc(st.lookupMsg) + '</div>';
    }
    if (st.lookupResult && st.lookupResult.player) {
      var lp = st.lookupResult.player;
      var lrel = st.lookupResult.relation_status || 'none';
      html += '<div style="margin-top:10px;padding:12px;background:var(--bg-deep);border:1px solid rgba(91,143,255,.32);border-radius:12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">' +
        avatarMarkup(lp.avatar_svg, lp.avatar_face, 40) +
        '<div style="flex:1;min-width:130px;">' +
        '  <div style="font-weight:800;font-size:14px;color:#fff;">' + esc(lp.handle) + (lp.country ? ' <span style="font-size:11px;color:var(--dim);font-weight:600;">' + esc(lp.country) + '</span>' : '') + '</div>' +
        '  <div style="font-size:11px;color:var(--dim);font-family:\'Space Mono\',monospace;">ELO ' + (lp.rating || 1200) + ' · ' + (lp.wins || 0) + 'W-' + (lp.losses || 0) + 'L</div>' +
        '</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
        (lrel === 'friends'
          ? '<span style="font-size:11px;color:#86efac;font-weight:700;padding:6px 8px;">Friends ✓</span>'
          : lrel === 'pending_sent'
            ? '<span style="font-size:11px;color:#fde68a;font-weight:700;padding:6px 8px;">Pending…</span>'
            : lrel === 'blocked_by_you'
              ? '<button class="fr-act-unblock" data-pid="' + esc(lp.player_id) + '" style="padding:6px 10px;border-radius:8px;border:1px solid var(--border);background:transparent;color:#cbd5e1;font-size:11px;font-weight:700;cursor:pointer;">Unblock</button>'
              : '<button id="fr-lookup-add" data-pid="' + esc(lp.player_id) + '" style="padding:6px 12px;border-radius:8px;border:none;background:#22c55e;color:#04120a;font-size:12px;font-weight:800;cursor:pointer;">' + (lrel === 'pending_received' ? 'Accept Friend' : 'Add Friend') + '</button>') +
        (lrel !== 'blocked_by_you'
          ? '<button id="fr-lookup-challenge" data-pid="' + esc(lp.player_id) + '" data-handle="' + esc(lp.handle) + '" style="padding:6px 12px;border-radius:8px;border:1px solid rgba(91,143,255,.5);background:rgba(59,110,248,.22);color:#fff;font-size:12px;font-weight:700;cursor:pointer;">Challenge</button>'
          : '') +
        '</div>' +
        '</div>';
    }
    html += '</div>';

    // Card 3: My Friend Code & Privacy
    var displayCode = st.friendCode || (profile && profile.friend_code) || '';
    html += '<div style="background:var(--bg-panel);border:1px solid var(--border);border-radius:16px;padding:16px;margin-bottom:12px;">';
    html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">' +
      '<div>' +
      '  <div style="font-size:11px;color:var(--dim);text-transform:uppercase;letter-spacing:.08em;">Your Friend Code</div>' +
      '  <div style="font-family:\'Space Mono\',monospace;font-size:20px;font-weight:700;color:#fff;letter-spacing:.08em;margin-top:2px;">' + esc(displayCode || 'MAP-····') + '</div>' +
      (!displayCode ? '  <div style="font-size:11px;color:var(--dim);margin-top:2px;">Play or sync online to activate your personal Friend Code.</div>' : '') +
      '</div>' +
      '<div style="display:flex;gap:6px;">' +
      '  <button id="fr-copy-code" ' + (!displayCode ? 'disabled' : '') + ' style="padding:7px 12px;border-radius:9px;border:1px solid rgba(91,143,255,.45);background:rgba(59,110,248,.18);color:#fff;font-size:12px;font-weight:700;cursor:pointer;' + (!displayCode ? 'opacity:.45;cursor:not-allowed;' : '') + '">Copy</button>' +
      '  <button id="fr-rotate-code" ' + (offline ? 'disabled' : '') + ' style="padding:7px 10px;border-radius:9px;border:1px solid var(--border);background:transparent;color:var(--dim);font-size:12px;font-weight:700;cursor:pointer;" title="Generate a fresh code">Reset</button>' +
      '</div>' +
      '</div>';

    html += '<div style="margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,.07);display:flex;align-items:center;justify-content:space-between;gap:12px;">' +
      '<div>' +
      '  <div style="font-size:12px;font-weight:700;color:#fff;">Allow Friend Requests &amp; Challenges</div>' +
      '  <div style="font-size:11px;color:var(--dim);margin-top:2px;">When off, hides you from handle search &amp; leaderboard challenges. Room Codes still work.</div>' +
      '</div>' +
      '<button id="fr-toggle-privacy" role="switch" aria-checked="' + (st.allowRequests ? 'true' : 'false') + '" style="flex-shrink:0;width:44px;height:24px;border-radius:999px;border:1px solid ' + (st.allowRequests ? '#22c55e' : 'var(--border)') + ';background:' + (st.allowRequests ? '#22c55e' : 'rgba(255,255,255,.1)') + ';position:relative;cursor:pointer;transition:background .15s;">' +
      '  <span style="position:absolute;top:2px;left:' + (st.allowRequests ? '22px' : '2px') + ';width:18px;height:18px;border-radius:50%;background:#fff;transition:left .15s;"></span>' +
      '</button>' +
      '</div>';
    html += '</div>';

    // Card 4: Pending Incoming Friend Requests
    if (st.incoming.length > 0) {
      html += '<div style="background:var(--bg-panel);border:1px solid rgba(250,204,21,.35);border-radius:16px;padding:14px 16px;margin-bottom:12px;">' +
        '<div style="font-weight:800;font-size:13px;color:#fde047;margin-bottom:8px;">Incoming Friend Requests (' + st.incoming.length + ')</div>';
      st.incoming.forEach(function (req) {
        html += '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid rgba(255,255,255,.06);">' +
          avatarMarkup(req.avatar_svg, req.avatar_face, 36) +
          '<div style="flex:1;min-width:0;">' +
          '  <div style="font-weight:700;font-size:13px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(req.handle) + '</div>' +
          '  <div style="font-size:11px;color:var(--dim);">ELO ' + (req.rating || 1200) + '</div>' +
          '</div>' +
          '<button class="fr-req-accept" data-pid="' + esc(req.player_id) + '" style="padding:6px 10px;border-radius:8px;border:none;background:#22c55e;color:#04120a;font-size:11px;font-weight:800;cursor:pointer;">Accept</button>' +
          '<button class="fr-req-decline" data-pid="' + esc(req.player_id) + '" style="padding:6px 10px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--dim);font-size:11px;font-weight:700;cursor:pointer;">Decline</button>' +
          '</div>';
      });
      html += '</div>';
    }

    // Card 5: Friends List
    html += '<div style="background:var(--bg-panel);border:1px solid var(--border);border-radius:16px;padding:14px 16px;margin-bottom:12px;">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">' +
      '  <div style="font-weight:800;font-size:14px;color:#fff;">Friends (' + st.friends.length + ')</div>' +
      '  <button id="fr-refresh" style="background:none;border:none;color:var(--blue-lt);font-size:11px;font-weight:700;cursor:pointer;">Refresh</button>' +
      '</div>';

    if (st.friends.length === 0) {
      html += '<div style="text-align:center;padding:18px 8px;color:var(--dim);font-size:12px;line-height:1.45;">' +
        'No linked friends yet. Share your Friend Code, search an exact handle above, or tap any player on the Leaderboard.' +
        '</div>';
    } else {
      st.friends.forEach(function (f) {
        html += '<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid rgba(255,255,255,.06);">' +
          avatarMarkup(f.avatar_svg, f.avatar_face, 38) +
          '<div style="flex:1;min-width:0;">' +
          '  <div style="font-weight:700;font-size:13px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(f.handle) + (f.country ? ' <span style="font-size:10px;color:var(--dim);">' + esc(f.country) + '</span>' : '') + '</div>' +
          '  <div style="font-size:11px;color:var(--dim);font-family:\'Space Mono\',monospace;">ELO ' + (f.rating || 1200) + ' · ' + (f.wins || 0) + 'W-' + (f.losses || 0) + 'L</div>' +
          '</div>' +
          '<button class="fr-friend-challenge" data-pid="' + esc(f.player_id) + '" data-handle="' + esc(f.handle) + '" style="padding:6px 11px;border-radius:8px;border:1px solid rgba(91,143,255,.5);background:rgba(59,110,248,.22);color:#fff;font-size:11px;font-weight:800;cursor:pointer;">Challenge</button>' +
          '<button class="fr-friend-more" data-pid="' + esc(f.player_id) + '" data-handle="' + esc(f.handle) + '" title="Manage friend" style="padding:6px 8px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--dim);font-size:11px;cursor:pointer;">•••</button>' +
          '</div>';
      });
    }

    if (st.outgoing.length > 0) {
      html += '<div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,.08);">' +
        '<div style="font-size:11px;color:var(--dim);font-weight:700;margin-bottom:6px;">Sent Requests (' + st.outgoing.length + ')</div>';
      st.outgoing.forEach(function (out) {
        html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;font-size:12px;">' +
          '<span style="color:#cbd5e1;">' + esc(out.handle) + '</span>' +
          '<button class="fr-req-cancel" data-pid="' + esc(out.player_id) + '" style="background:none;border:none;color:var(--dim);font-size:11px;cursor:pointer;">Cancel</button>' +
          '</div>';
      });
      html += '</div>';
    }
    html += '</div>';

    // Blocked list toggle
    if (st.blocked.length > 0) {
      html += '<div style="text-align:center;">' +
        '<button id="fr-toggle-blocked" style="background:none;border:none;color:var(--dim);font-size:11px;cursor:pointer;text-decoration:underline;">' +
        (st.showBlocked ? 'Hide' : 'Manage') + ' blocked players (' + st.blocked.length + ')' +
        '</button>';
      if (st.showBlocked) {
        html += '<div style="margin-top:8px;background:var(--bg-panel);border:1px solid var(--border);border-radius:12px;padding:10px 14px;text-align:left;">';
        st.blocked.forEach(function (b) {
          html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;font-size:12px;">' +
            '<span>' + esc(b.handle) + '</span>' +
            '<button class="fr-act-unblock" data-pid="' + esc(b.player_id) + '" style="padding:4px 9px;border-radius:7px;border:1px solid var(--border);background:transparent;color:#cbd5e1;font-size:11px;cursor:pointer;">Unblock</button>' +
            '</div>';
        });
        html += '</div>';
      }
      html += '</div>';
    }

    html += '</div>';
    rootEl.innerHTML = html;

    // Wire events
    var backBtn = rootEl.querySelector('#btn-friends-back');
    if (backBtn) backBtn.addEventListener('click', function () {
      if (typeof window.go === 'function') window.go('s-setup');
    });

    var btnFriendly = rootEl.querySelector('#fr-mode-friendly');
    var btnRanked = rootEl.querySelector('#fr-mode-ranked');
    if (btnFriendly) btnFriendly.addEventListener('click', function () { st.roomRanked = false; paintFriendsDOM(rootEl, profile); });
    if (btnRanked) btnRanked.addEventListener('click', function () { st.roomRanked = true; paintFriendsDOM(rootEl, profile); });

    var createRoomBtn = rootEl.querySelector('#fr-create-room');
    if (createRoomBtn) createRoomBtn.addEventListener('click', async function () {
      createRoomBtn.disabled = true;
      var tier = getPlayerTier(profile);
      var deck = buildCandidateFriendDeck(tier);
      var res = await window.friendStore.createRoom(profile.id, st.roomRanked, tier, deck, null);
      if (res && res.ok) {
        st.activeRoom = {
          room_id: res.room_id,
          room_code: res.room_code,
          is_ranked: res.is_ranked,
          expires_at: res.expires_at,
          targetHandle: null
        };
        paintFriendsDOM(rootEl, profile);
        startRoomPolling(res.room_id);
      } else {
        toast('Could not create room right now', 2000);
        paintFriendsDOM(rootEl, profile);
      }
    });

    var copyRoomBtn = rootEl.querySelector('#fr-copy-room');
    if (copyRoomBtn && st.activeRoom) {
      copyRoomBtn.addEventListener('click', function () {
        copyText(formatRoomCodeDisplay(st.activeRoom.room_code), 'Room Code copied');
      });
    }

    var cancelRoomBtn = rootEl.querySelector('#fr-cancel-room');
    if (cancelRoomBtn && st.activeRoom) {
      cancelRoomBtn.addEventListener('click', async function () {
        var rid = st.activeRoom.room_id;
        st.activeRoom = null;
        stopRoomPoll();
        await window.friendStore.cancelRoom(profile.id, rid);
        paintFriendsDOM(rootEl, profile);
      });
    }

    var joinBtn = rootEl.querySelector('#fr-join-btn');
    var joinInput = rootEl.querySelector('#fr-join-input');
    async function doJoinRoom() {
      var code = normalizeRoomCodeInput(joinInput ? joinInput.value : '');
      if (code.length !== 6) {
        st.joinMsg = 'Enter a 6-character room code.';
        paintFriendsDOM(rootEl, profile);
        return;
      }
      st.joinMsg = '';
      if (joinBtn) joinBtn.disabled = true;
      var tier = getPlayerTier(profile);
      var deck = buildCandidateFriendDeck(tier);
      var res = await window.friendStore.joinRoom(profile.id, code, tier, deck);
      if (res && res.status === 'matched') {
        launchDirectH2HMatch(res);
      } else {
        var errMap = {
          not_found: 'Room code not found. Double-check the 6 characters.',
          room_expired: 'That room code has expired.',
          room_closed: 'That room is already full or closed.',
          cannot_join_own_room: 'You cannot join your own room.',
          private_invite_only: 'That room is a direct challenge for another player.',
          unavailable: 'Unable to join this room.'
        };
        st.joinMsg = errMap[(res && res.error) || ''] || 'Could not join room.';
        paintFriendsDOM(rootEl, profile);
      }
    }
    if (joinBtn) joinBtn.addEventListener('click', doJoinRoom);
    if (joinInput) joinInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') doJoinRoom(); });

    var lookupBtn = rootEl.querySelector('#fr-lookup-btn');
    var lookupInput = rootEl.querySelector('#fr-lookup-input');
    async function doLookup() {
      var norm = normalizeFriendQuery(lookupInput ? lookupInput.value : '');
      if (!norm.ok) {
        st.lookupResult = null;
        st.lookupMsg = norm.kind === 'wildcard_disallowed'
          ? 'Enter an exact username or Friend Code (wildcards are not allowed).'
          : 'Enter an exact username (2+ characters) or MAP-XXXX Friend Code.';
        paintFriendsDOM(rootEl, profile);
        return;
      }
      st.lookupMsg = 'Searching…';
      st.lookupResult = null;
      paintFriendsDOM(rootEl, profile);
      var res = await window.friendStore.lookupPlayer(profile.id, norm.query);
      if (res && res.found && res.player) {
        st.lookupResult = res;
        st.lookupMsg = '';
      } else {
        st.lookupResult = null;
        var rMap = {
          self: 'That is your own profile!',
          not_accepting: 'That player is currently not accepting friend requests or challenges.',
          not_found: 'No player matched that exact username or Friend Code.'
        };
        st.lookupMsg = rMap[(res && res.reason) || ''] || 'Player not found.';
      }
      paintFriendsDOM(rootEl, profile);
    }
    if (lookupBtn) lookupBtn.addEventListener('click', doLookup);
    if (lookupInput) lookupInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') doLookup(); });

    var lookupAddBtn = rootEl.querySelector('#fr-lookup-add');
    if (lookupAddBtn) lookupAddBtn.addEventListener('click', async function () {
      var pid = lookupAddBtn.getAttribute('data-pid');
      var r = await window.friendStore.requestFriend(profile.id, pid);
      if (r && r.ok) {
        toast(r.status === 'accepted' ? 'You are now friends!' : 'Friend request sent!', 2000);
        st.lookupResult.relation_status = r.status === 'accepted' ? 'friends' : 'pending_sent';
        await refreshFriendsData();
        paintFriendsDOM(rootEl, profile);
      } else {
        toast('Could not send request', 1800);
      }
    });

    var lookupChalBtn = rootEl.querySelector('#fr-lookup-challenge');
    if (lookupChalBtn) lookupChalBtn.addEventListener('click', function () {
      var pid = lookupChalBtn.getAttribute('data-pid');
      var handle = lookupChalBtn.getAttribute('data-handle');
      sendDirectChallenge(pid, handle, st.roomRanked);
    });

    var copyCodeBtn = rootEl.querySelector('#fr-copy-code');
    if (copyCodeBtn) copyCodeBtn.addEventListener('click', function () {
      if (st.friendCode) copyText(st.friendCode, 'Friend Code copied');
    });

    var rotateBtn = rootEl.querySelector('#fr-rotate-code');
    if (rotateBtn) rotateBtn.addEventListener('click', async function () {
      var res = await window.friendStore.rotateCode(profile.id);
      if (res && res.friend_code) {
        st.friendCode = res.friend_code;
        toast('New Friend Code: ' + res.friend_code, 2000);
        paintFriendsDOM(rootEl, profile);
      }
    });

    var privBtn = rootEl.querySelector('#fr-toggle-privacy');
    if (privBtn) privBtn.addEventListener('click', async function () {
      var nextVal = !st.allowRequests;
      st.allowRequests = nextVal;
      paintFriendsDOM(rootEl, profile);
      await window.friendStore.setPrivacy(profile.id, nextVal);
      toast(nextVal ? 'Friend requests & challenges enabled' : 'Requests paused (Room Codes still work)', 2200);
    });

    var refreshBtn = rootEl.querySelector('#fr-refresh');
    if (refreshBtn) refreshBtn.addEventListener('click', function () { renderFriendsScreen(true); });

    rootEl.querySelectorAll('.fr-req-accept').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        await window.friendStore.respondFriend(profile.id, btn.getAttribute('data-pid'), 'accept');
        toast('Friend added!', 1800);
        renderFriendsScreen(true);
      });
    });

    rootEl.querySelectorAll('.fr-req-decline, .fr-req-cancel').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        await window.friendStore.respondFriend(profile.id, btn.getAttribute('data-pid'), 'decline');
        renderFriendsScreen(true);
      });
    });

    rootEl.querySelectorAll('.fr-friend-challenge').forEach(function (btn) {
      btn.addEventListener('click', function () {
        sendDirectChallenge(btn.getAttribute('data-pid'), btn.getAttribute('data-handle'), st.roomRanked);
      });
    });

    rootEl.querySelectorAll('.fr-friend-more').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openManageFriendModal(btn.getAttribute('data-pid'), btn.getAttribute('data-handle'));
      });
    });

    rootEl.querySelectorAll('.fr-act-unblock').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        await window.friendStore.respondFriend(profile.id, btn.getAttribute('data-pid'), 'unblock');
        toast('Player unblocked', 1800);
        renderFriendsScreen(true);
      });
    });

    var toggleBlocked = rootEl.querySelector('#fr-toggle-blocked');
    if (toggleBlocked) toggleBlocked.addEventListener('click', function () {
      st.showBlocked = !st.showBlocked;
      paintFriendsDOM(rootEl, profile);
    });
  }

  function openManageFriendModal(targetId, handle) {
    var profile = getActiveProfile();
    if (!profile) return;
    var html = '<h3 style="font-family:\'Fredoka One\',sans-serif;font-size:18px;margin:0 0 6px;color:#fff;">' + esc(handle) + '</h3>' +
      '<div style="font-size:12px;color:var(--dim);margin-bottom:14px;">Manage connection</div>' +
      '<div style="display:flex;flex-direction:column;gap:8px;">' +
      '  <button id="mf-chal-friendly" style="padding:10px;border-radius:10px;border:1px solid rgba(74,222,128,.45);background:rgba(34,197,94,.16);color:#bbf7d0;font-weight:700;cursor:pointer;">🤝 Challenge · Friendly (Unranked)</button>' +
      '  <button id="mf-chal-ranked" style="padding:10px;border-radius:10px;border:1px solid rgba(91,143,255,.45);background:rgba(59,110,248,.18);color:#bfdbfe;font-weight:700;cursor:pointer;">⚔️ Challenge · Ranked (ELO)</button>' +
      '  <button id="mf-remove" style="padding:10px;border-radius:10px;border:1px solid var(--border);background:transparent;color:#e2e8f0;font-weight:700;cursor:pointer;">Remove Friend</button>' +
      '  <button id="mf-block" style="padding:10px;border-radius:10px;border:1px solid rgba(248,113,113,.35);background:rgba(248,113,113,.1);color:#fca5a5;font-weight:700;cursor:pointer;">Block Player</button>' +
      '</div>';
    var m = createOverlayModal('mapolis-manage-friend-modal', html, { maxWidth: '340px' });
    m.sheet.querySelector('#mf-chal-friendly').addEventListener('click', function () { m.overlay.remove(); sendDirectChallenge(targetId, handle, false); });
    m.sheet.querySelector('#mf-chal-ranked').addEventListener('click', function () { m.overlay.remove(); sendDirectChallenge(targetId, handle, true); });
    m.sheet.querySelector('#mf-remove').addEventListener('click', async function () {
      m.overlay.remove();
      await window.friendStore.respondFriend(profile.id, targetId, 'remove');
      toast('Friend removed', 1800);
      renderFriendsScreen(true);
    });
    m.sheet.querySelector('#mf-block').addEventListener('click', async function () {
      m.overlay.remove();
      await window.friendStore.respondFriend(profile.id, targetId, 'block');
      toast('Player blocked', 1800);
      renderFriendsScreen(true);
    });
  }

  async function sendDirectChallenge(targetId, targetHandle, isRanked) {
    var profile = getActiveProfile();
    if (!profile || !profile.id || !window.friendStore) {
      toast('Sign in to send challenges', 1800);
      return;
    }
    var tier = getPlayerTier(profile);
    var deck = buildCandidateFriendDeck(tier);
    var res = await window.friendStore.createRoom(profile.id, !!isRanked, tier, deck, targetId);
    if (!res || !res.ok) {
      var msg = (res && res.error === 'not_accepting')
        ? targetHandle + ' is not currently accepting challenges.'
        : 'Could not send challenge right now.';
      toast(msg, 2400);
      return;
    }

    _friendState.activeRoom = {
      room_id: res.room_id,
      room_code: res.room_code,
      is_ranked: res.is_ranked,
      expires_at: res.expires_at,
      targetHandle: targetHandle
    };

    var waitHtml = '' +
      '<div style="text-align:center;">' +
      '  <div style="font-size:28px;margin-bottom:6px;">⚔️</div>' +
      '  <h3 style="font-family:\'Fredoka One\',sans-serif;font-size:20px;color:#fff;margin:0;">Challenge Sent!</h3>' +
      '  <div style="font-size:13px;color:#cbd5e1;margin-top:6px;">Waiting for <strong>' + esc(targetHandle) + '</strong> to accept…</div>' +
      '  <div style="font-size:12px;color:' + (isRanked ? '#93c5fd' : '#86efac') + ';margin-top:4px;font-weight:700;">' + (isRanked ? 'Ranked (ELO)' : 'Friendly (Unranked)') + '</div>' +
      '  <div style="margin:14px 0;padding:10px;background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:10px;">' +
      '    <div style="font-size:10px;color:var(--dim);text-transform:uppercase;letter-spacing:.08em;">Backup Room Code</div>' +
      '    <div style="font-family:\'Space Mono\',monospace;font-size:18px;font-weight:700;color:#fff;letter-spacing:.12em;margin-top:2px;">' + esc(formatRoomCodeDisplay(res.room_code)) + '</div>' +
      '    <div style="font-size:11px;color:var(--dim);margin-top:4px;">Expires in <span id="chal-wait-countdown" style="font-family:\'Space Mono\',monospace;color:#fff;">5:00</span></div>' +
      '  </div>' +
      '  <button id="chal-wait-cancel" style="padding:9px 20px;border-radius:10px;border:1px solid var(--border);background:transparent;color:#cbd5e1;font-size:13px;font-weight:700;cursor:pointer;">Cancel Challenge</button>' +
      '</div>';

    var m = createOverlayModal('mapolis-challenge-wait-modal', waitHtml, {
      maxWidth: '360px',
      backdropClose: false
    });

    m.sheet.querySelector('#chal-wait-cancel').addEventListener('click', async function () {
      var rid = res.room_id;
      _friendState.activeRoom = null;
      stopRoomPoll();
      m.overlay.remove();
      await window.friendStore.cancelRoom(profile.id, rid);
      toast('Challenge cancelled', 1600);
    });

    startRoomPolling(res.room_id, function () {
      m.overlay.remove();
    });
  }

  // ── 3. Clickable Leaderboard Public Player Card Modal ────────────────────

  function openPublicPlayerCard(row) {
    if (!row) return;
    var profile = getActiveProfile();
    var targetId = row.id || row.player_id;
    if (!targetId) return;
    if (profile && (targetId === profile.id || targetId === profile.player_id)) return;

    var chosenRanked = false;
    var cardState = {
      loaded: false,
      relation: 'none',
      canInteract: true,
      player: {
        player_id: targetId,
        handle: row.handle || 'Explorer',
        country: row.country || '',
        avatar_svg: row.avatar_svg || null,
        avatar_face: row.avatar_face || '🧑',
        rating: row.h2hRating || row.rating || 1200,
        wins: row.h2hWins || row.wins || 0,
        losses: row.losses || 0,
        ties: row.ties || 0,
        matches: row.h2hMatches || row.matches || 0,
        totalStars: row.totalStars || 0
      }
    };

    var isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(targetId));

    function renderCardInner() {
      var p = cardState.player;
      var rel = cardState.relation;
      var html = '' +
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">' +
        '  <div style="display:flex;align-items:center;gap:12px;">' +
        avatarMarkup(p.avatar_svg, p.avatar_face, 54) +
        '    <div>' +
        '      <h3 style="font-family:\'Fredoka One\',sans-serif;font-size:20px;color:#fff;margin:0;line-height:1.15;">' + esc(p.handle) + '</h3>' +
        '      <div style="font-size:12px;color:var(--dim);margin-top:3px;">' + (p.country ? esc(p.country) + ' · ' : '') + 'Public Explorer Card</div>' +
        '    </div>' +
        '  </div>' +
        '  <button id="pc-close" aria-label="Close" style="background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);color:#cbd5e1;width:30px;height:30px;border-radius:9px;cursor:pointer;font-size:15px;">✕</button>' +
        '</div>' +

        // Minimal public stats strip (unboxed numerals, zero PII)
        '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:14px 0;padding:10px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:12px;text-align:center;">' +
        '  <div><div style="font-size:10px;color:var(--dim);text-transform:uppercase;letter-spacing:.08em;">H2H Rating</div><div style="font-family:\'Space Mono\',monospace;font-size:16px;font-weight:700;color:#68d391;margin-top:2px;">' + (p.rating || 1200) + '</div></div>' +
        '  <div><div style="font-size:10px;color:var(--dim);text-transform:uppercase;letter-spacing:.08em;">Record</div><div style="font-family:\'Space Mono\',monospace;font-size:14px;font-weight:700;color:#fff;margin-top:4px;">' + (p.wins || 0) + 'W-' + (p.losses || 0) + 'L</div></div>' +
        '  <div><div style="font-size:10px;color:var(--dim);text-transform:uppercase;letter-spacing:.08em;">Matches</div><div style="font-family:\'Space Mono\',monospace;font-size:16px;font-weight:700;color:#e2e8f0;margin-top:2px;">' + (p.matches || 0) + '</div></div>' +
        '</div>';

      if (!profile || !profile.id) {
        html += '<div style="font-size:12px;color:var(--dim);text-align:center;padding:8px 0;">Sign in to challenge players or add friends.</div>';
      } else if (!isUuid) {
        html += '<div style="font-size:12px;color:var(--dim);text-align:center;padding:8px 0;">This is a local-only profile and cannot receive online challenges.</div>';
      } else if (rel === 'blocked_by_you') {
        html += '<div style="text-align:center;padding:8px 0;">' +
          '<div style="font-size:12px;color:#fca5a5;margin-bottom:10px;">You have blocked this player.</div>' +
          '<button id="pc-unblock" style="padding:9px 18px;border-radius:10px;border:1px solid var(--border);background:transparent;color:#fff;font-weight:700;font-size:13px;cursor:pointer;">Unblock</button>' +
          '</div>';
      } else if (!cardState.canInteract && cardState.loaded) {
        html += '<div style="font-size:12px;color:var(--dim);text-align:center;padding:10px 6px;background:rgba(255,255,255,.03);border-radius:10px;">' +
          esc(p.handle) + ' is currently not accepting direct challenges or friend requests.' +
          '</div>';
      } else {
        // Challenge mode picker + Send Challenge button
        html += '<div style="margin-bottom:12px;">' +
          '<div style="font-size:11px;color:var(--dim);font-weight:700;margin-bottom:6px;">Challenge to Head-to-Head</div>' +
          '<div style="display:flex;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:3px;gap:4px;margin-bottom:8px;">' +
          '  <button id="pc-mode-friendly" style="flex:1;padding:7px;border-radius:8px;border:none;font-size:12px;font-weight:700;cursor:pointer;background:' + (!chosenRanked ? '#22c55e' : 'transparent') + ';color:' + (!chosenRanked ? '#04120a' : 'var(--dim)') + ';">🤝 Friendly</button>' +
          '  <button id="pc-mode-ranked" style="flex:1;padding:7px;border-radius:8px;border:none;font-size:12px;font-weight:700;cursor:pointer;background:' + (chosenRanked ? 'var(--blue)' : 'transparent') + ';color:' + (chosenRanked ? '#fff' : 'var(--dim)') + ';">⚔️ Ranked (ELO)</button>' +
          '</div>' +
          '<button id="pc-challenge" style="width:100%;padding:11px;border-radius:12px;border:none;background:var(--yellow);color:#111;font-family:\'Fredoka One\',sans-serif;font-size:15px;cursor:pointer;">Challenge ' + esc(p.handle) + '</button>' +
          '</div>';

        // Secondary row: Friend action + Block
        var friendBtnHtml = '';
        if (rel === 'friends') {
          friendBtnHtml = '<button disabled style="flex:1;padding:9px;border-radius:10px;border:1px solid rgba(74,222,128,.35);background:rgba(34,197,94,.12);color:#86efac;font-size:12px;font-weight:700;">Friends ✓</button>';
        } else if (rel === 'pending_sent') {
          friendBtnHtml = '<button disabled style="flex:1;padding:9px;border-radius:10px;border:1px solid rgba(250,204,21,.35);background:rgba(250,204,21,.1);color:#fde047;font-size:12px;font-weight:700;">Friend Request Sent</button>';
        } else if (rel === 'pending_received') {
          friendBtnHtml = '<button id="pc-friend-act" style="flex:1;padding:9px;border-radius:10px;border:none;background:#22c55e;color:#04120a;font-size:12px;font-weight:800;cursor:pointer;">Accept Friend Request</button>';
        } else {
          friendBtnHtml = '<button id="pc-friend-act" style="flex:1;padding:9px;border-radius:10px;border:1px solid rgba(91,143,255,.45);background:rgba(59,110,248,.16);color:#fff;font-size:12px;font-weight:700;cursor:pointer;">+ Add Friend</button>';
        }

        html += '<div style="display:flex;gap:8px;">' +
          friendBtnHtml +
          '<button id="pc-block" style="padding:9px 12px;border-radius:10px;border:1px solid rgba(248,113,113,.3);background:transparent;color:#fca5a5;font-size:12px;font-weight:700;cursor:pointer;">Block</button>' +
          '</div>';
      }

      return html;
    }

    var m = createOverlayModal('mapolis-player-card-modal', renderCardInner(), { maxWidth: '380px' });

    function bindEvents() {
      var closeBtn = m.sheet.querySelector('#pc-close');
      if (closeBtn) closeBtn.addEventListener('click', function () { m.overlay.remove(); });

      var mf = m.sheet.querySelector('#pc-mode-friendly');
      var mr = m.sheet.querySelector('#pc-mode-ranked');
      if (mf) mf.addEventListener('click', function () { chosenRanked = false; m.sheet.innerHTML = renderCardInner(); bindEvents(); });
      if (mr) mr.addEventListener('click', function () { chosenRanked = true; m.sheet.innerHTML = renderCardInner(); bindEvents(); });

      var chalBtn = m.sheet.querySelector('#pc-challenge');
      if (chalBtn) chalBtn.addEventListener('click', function () {
        m.overlay.remove();
        sendDirectChallenge(cardState.player.player_id, cardState.player.handle, chosenRanked);
      });

      var frBtn = m.sheet.querySelector('#pc-friend-act');
      if (frBtn) frBtn.addEventListener('click', async function () {
        frBtn.disabled = true;
        var res = await window.friendStore.requestFriend(profile.id, cardState.player.player_id);
        if (res && res.ok) {
          cardState.relation = res.status === 'accepted' ? 'friends' : 'pending_sent';
          toast(res.status === 'accepted' ? 'You are now friends!' : 'Friend request sent!', 1800);
          m.sheet.innerHTML = renderCardInner();
          bindEvents();
        } else {
          toast('Could not send friend request', 1800);
          frBtn.disabled = false;
        }
      });

      var blkBtn = m.sheet.querySelector('#pc-block');
      if (blkBtn) blkBtn.addEventListener('click', async function () {
        await window.friendStore.respondFriend(profile.id, cardState.player.player_id, 'block');
        cardState.relation = 'blocked_by_you';
        cardState.canInteract = false;
        toast('Player blocked', 1800);
        m.sheet.innerHTML = renderCardInner();
        bindEvents();
      });

      var unblkBtn = m.sheet.querySelector('#pc-unblock');
      if (unblkBtn) unblkBtn.addEventListener('click', async function () {
        await window.friendStore.respondFriend(profile.id, cardState.player.player_id, 'unblock');
        cardState.relation = 'none';
        cardState.canInteract = true;
        toast('Player unblocked', 1800);
        m.sheet.innerHTML = renderCardInner();
        bindEvents();
      });
    }

    bindEvents();

    // Hydrate live relation & privacy from server
    if (profile && profile.id && isUuid && window.friendStore) {
      window.friendStore.getPlayerCard(profile.id, targetId).then(function (res) {
        if (!document.getElementById('mapolis-player-card-modal')) return;
        cardState.loaded = true;
        if (res && res.found && res.player) {
          cardState.player = Object.assign(cardState.player, res.player);
          cardState.relation = res.relation_status || 'none';
          cardState.canInteract = (typeof res.can_interact === 'boolean') ? res.can_interact : true;
          m.sheet.innerHTML = renderCardInner();
          bindEvents();
        }
      }).catch(function () {});
    }
  }

  // ── 4. Live Incoming Challenge Banner Poller ─────────────────────────────

  var _challengePollTimer = null;
  var _dismissedRoomIds = {};
  var _activeBannerRoomId = null;

  function dismissChallengeBanner() {
    var existing = document.getElementById('mapolis-incoming-challenge-banner');
    if (existing) existing.remove();
    _activeBannerRoomId = null;
  }

  function showIncomingChallengeBanner(ch) {
    if (!ch || !ch.room_id || _dismissedRoomIds[ch.room_id]) return;
    if (_activeBannerRoomId === ch.room_id && document.getElementById('mapolis-incoming-challenge-banner')) return;
    dismissChallengeBanner();
    _activeBannerRoomId = ch.room_id;

    var host = ch.host || {};
    var banner = document.createElement('div');
    banner.id = 'mapolis-incoming-challenge-banner';
    banner.style.cssText = [
      'position:fixed', 'top:12px', 'left:50%', 'transform:translateX(-50%)',
      'z-index:9600', 'width:calc(100% - 24px)', 'max-width:440px',
      'background:#121f4a', 'border:1px solid rgba(91,143,255,0.55)',
      'border-radius:14px', 'padding:12px 14px',
      'box-shadow:0 12px 32px rgba(0,0,0,0.55)',
      'display:flex', 'align-items:center', 'gap:10px', 'color:#fff'
    ].join(';');

    banner.innerHTML = '' +
      avatarMarkup(host.avatar_svg, host.avatar_face, 38) +
      '<div style="flex:1;min-width:0;">' +
      '  <div style="font-weight:800;font-size:13px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">⚔️ ' + esc(host.handle || 'Player') + ' challenged you!</div>' +
      '  <div style="font-size:11px;color:' + (ch.is_ranked ? '#93c5fd' : '#86efac') + ';margin-top:2px;">' + (ch.is_ranked ? 'Ranked (ELO)' : 'Friendly (Unranked)') + ' · ELO ' + (host.rating || 1200) + '</div>' +
      '</div>' +
      '<button id="ch-banner-accept" style="padding:7px 12px;border-radius:9px;border:none;background:#22c55e;color:#04120a;font-size:12px;font-weight:800;cursor:pointer;">Accept</button>' +
      '<button id="ch-banner-decline" style="padding:7px 10px;border-radius:9px;border:1px solid rgba(255,255,255,.18);background:transparent;color:#cbd5e1;font-size:12px;font-weight:700;cursor:pointer;">Decline</button>';

    document.body.appendChild(banner);

    banner.querySelector('#ch-banner-accept').addEventListener('click', async function () {
      var profile = getActiveProfile();
      if (!profile || !profile.id) return;
      banner.querySelector('#ch-banner-accept').disabled = true;
      var tier = getPlayerTier(profile);
      var deck = buildCandidateFriendDeck(tier);
      var res = await window.friendStore.respondChallenge(profile.id, ch.room_id, 'accept', tier, deck);
      dismissChallengeBanner();
      if (res && res.status === 'matched') {
        launchDirectH2HMatch(res);
      } else {
        toast('Challenge expired or cancelled', 2000);
      }
    });

    banner.querySelector('#ch-banner-decline').addEventListener('click', async function () {
      var profile = getActiveProfile();
      _dismissedRoomIds[ch.room_id] = true;
      dismissChallengeBanner();
      if (profile && profile.id) {
        await window.friendStore.respondChallenge(profile.id, ch.room_id, 'decline');
      }
    });
  }

  function startIncomingChallengePoller() {
    if (_challengePollTimer) return;
    var NON_GAME_SCREENS = {
      's-setup': true, 's-profile': true, 's-leaderboard': true,
      's-friends': true, 's-atlas': true, 's-badges': true, 's-store': true
    };
    _challengePollTimer = setInterval(async function () {
      if (document.hidden) return;
      if (!NON_GAME_SCREENS[window.currentScreen]) return;
      var profile = getActiveProfile();
      if (!profile || !profile.id || !window.friendStore) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      var res = await window.friendStore.listIncomingChallenges(profile.id);
      var list = (res && Array.isArray(res.challenges)) ? res.challenges : [];
      var active = list.find(function (c) { return c && c.room_id && !_dismissedRoomIds[c.room_id]; });
      if (active) {
        showIncomingChallengeBanner(active);
      } else if (_activeBannerRoomId) {
        dismissChallengeBanner();
      }
    }, 5000);
  }

  // ── 5. Always-Unlocked World Atlas & Country Genesis Cards ───────────────

  var _genesisCache = null;
  var _genesisPromise = null;
  var _topoCache = null;
  var _atlasState = {
    continent: 'all',
    originType: 'all',
    search: ''
  };

  async function loadGenesisData() {
    if (_genesisCache) return _genesisCache;
    if (_genesisPromise) return _genesisPromise;
    _genesisPromise = fetch('/data/genesis-cards.json')
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        _genesisCache = data;
        return data;
      })
      .catch(function (err) {
        _genesisPromise = null;
        console.warn('[WorldAtlas] Failed to load genesis-cards.json:', err);
        return null;
      });
    return _genesisPromise;
  }

  async function loadTopoFeatures() {
    if (_topoCache) return _topoCache;
    if (window.WORLD_DATA && window.WORLD_DATA.objects && window.WORLD_DATA.objects.countries && window.topojson) {
      _topoCache = window.topojson.feature(window.WORLD_DATA, window.WORLD_DATA.objects.countries).features;
      return _topoCache;
    }
    try {
      var resp = await fetch('/data/countries-50m.json');
      if (!resp.ok) return null;
      var topo = await resp.json();
      if (window.topojson && topo && topo.objects && topo.objects.countries) {
        _topoCache = window.topojson.feature(topo, topo.objects.countries).features;
        return _topoCache;
      }
    } catch (_) {}
    return null;
  }

  function findCountryGeoFeature(features, numId) {
    var n = Number(numId);
    if (n === 383 && window.EURO_KOSOVO_FEATURE) return window.EURO_KOSOVO_FEATURE;
    if (n === 254 && window.SA_FRENCH_GUIANA_FEATURE) return window.SA_FRENCH_GUIANA_FEATURE;
    if (!Array.isArray(features)) return null;
    for (var i = 0; i < features.length; i++) {
      if (Number(features[i].id) === n) return features[i];
    }
    return null;
  }

  function renderSilhouetteSvg(containerEl, feature, numId) {
    if (!containerEl || !window.d3 || !feature) {
      if (containerEl) {
        containerEl.innerHTML = '<div style="font-size:11px;color:var(--dim);">Map silhouette unavailable offline</div>';
      }
      return;
    }
    var w = 260, h = 148;
    // Countries crossing the antimeridian (Fiji, Kiribati, Russia, Samoa, Tonga, Tuvalu, USA, NZ)
    // render cleanly when rotated onto the Pacific or Eastern Hemisphere
    var ANTIMERIDIAN_IDS = { 242: -178, 296: -173, 643: -100, 882: 172, 776: 175, 798: -179, 840: 98, 554: -174 };
    var proj = window.d3.geoNaturalEarth1();
    if (ANTIMERIDIAN_IDS[Number(numId)] !== undefined) {
      proj.rotate([ANTIMERIDIAN_IDS[Number(numId)], 0]);
    }
    try {
      proj.fitExtent([[14, 12], [w - 14, h - 12]], feature);
      var pathGen = window.d3.geoPath().projection(proj);
      var d = pathGen(feature);
      if (!d) throw new Error('empty path');
      containerEl.innerHTML =
        '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" height="148" style="display:block;max-width:260px;margin:0 auto;" aria-hidden="true">' +
        '  <path d="' + d + '" fill="rgba(91,143,255,0.28)" stroke="#93c5fd" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"></path>' +
        '</svg>';
    } catch (_) {
      containerEl.innerHTML = '<div style="font-size:11px;color:var(--dim);">Map silhouette unavailable</div>';
    }
  }

  async function renderAtlasScreen() {
    var rootEl = document.getElementById('atlas-root');
    if (!rootEl) return;

    if (!_genesisCache) {
      rootEl.innerHTML = '<div style="text-align:center;padding:60px 20px;color:var(--dim);font-size:14px;">Loading World Atlas…</div>';
    }
    var data = await loadGenesisData();
    if (!data || !data.cards) {
      rootEl.innerHTML = '<div style="text-align:center;padding:50px 20px;color:var(--dim);">' +
        '<div style="font-size:28px;margin-bottom:8px;">📖</div>' +
        '<div>Could not load the World Atlas right now.</div>' +
        '<button id="atlas-err-back" style="margin-top:14px;padding:9px 18px;border-radius:10px;border:1px solid var(--border);background:var(--bg-panel);color:#fff;cursor:pointer;">← Back</button>' +
        '</div>';
      var eb = rootEl.querySelector('#atlas-err-back');
      if (eb) eb.addEventListener('click', function () { if (typeof window.go === 'function') window.go('s-setup'); });
      return;
    }

    paintAtlasDOM(rootEl, data);
  }

  function paintAtlasDOM(rootEl, data) {
    var allCards = _getCardsArray(data);
    var filtered = filterGenesisCards(allCards, _atlasState);

    var html = '<div style="max-width:760px;margin:0 auto;padding:14px 16px 40px;color:#eef2ff;">';

    // Top row
    html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">' +
      '<button id="btn-atlas-back" style="background:none;border:none;color:var(--dim);font-size:13px;font-weight:700;padding:6px 0;cursor:pointer;">← Back</button>' +
      '<div style="font-family:\'Space Mono\',monospace;font-size:11px;color:var(--dim);">' + filtered.length + ' / ' + allCards.length + ' entries</div>' +
      '</div>';

    // Header
    html += '<div style="margin-bottom:14px;">' +
      '<h2 style="font-family:\'Fredoka One\',sans-serif;font-size:26px;color:#fff;margin:0;">World Atlas</h2>' +
      '<div style="font-size:13px;color:var(--dim);margin-top:3px;">How every modern country and territory on the Mapolis map got its borders.</div>' +
      '</div>';

    // Search + Origin Filter row
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">' +
      '<input id="atlas-search" type="search" value="' + esc(_atlasState.search) + '" placeholder="Search country, capital, or year…" style="flex:1;min-width:180px;padding:10px 12px;border-radius:11px;border:1px solid var(--border);background:var(--bg-panel);color:#fff;font-size:13px;">' +
      '<select id="atlas-origin-filter" aria-label="Filter by border origin" style="padding:10px 12px;border-radius:11px;border:1px solid var(--border);background:var(--bg-panel);color:#e2e8f0;font-size:12px;font-weight:700;cursor:pointer;">' +
      '  <option value="all"' + (_atlasState.originType === 'all' ? ' selected' : '') + '>All Origins</option>';
    Object.keys(ORIGIN_META).forEach(function (key) {
      var meta = ORIGIN_META[key];
      html += '<option value="' + key + '"' + (_atlasState.originType === key ? ' selected' : '') + '>' + meta.icon + ' ' + esc(meta.label) + '</option>';
    });
    html += '</select></div>';

    // Interactive Continent Filter Tabs
    html += '<div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:6px;margin-bottom:12px;scrollbar-width:none;">';
    CONTINENT_META.forEach(function (c) {
      var active = _atlasState.continent === c.id;
      html += '<button class="atlas-cont-tab" data-cont="' + c.id + '" style="flex-shrink:0;padding:7px 12px;border-radius:9px;border:1px solid ' + (active ? 'var(--blue)' : 'var(--border)') + ';background:' + (active ? 'var(--blue)' : 'var(--bg-panel)') + ';color:' + (active ? '#fff' : 'var(--dim)') + ';font-size:12px;font-weight:700;cursor:pointer;">' + esc(c.label) + '</button>';
    });
    html += '</div>';

    // Country Grid (single-elevation cards, unboxed metadata — zero static pill clutter)
    if (filtered.length === 0) {
      html += '<div style="text-align:center;padding:40px 16px;color:var(--dim);font-size:13px;">No countries match that filter.</div>';
    } else {
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px;">';
      filtered.forEach(function (card) {
        var om = ORIGIN_META[card.originType] || { icon: '🗺️', label: 'Modern Borders' };
        var contName = CONTINENT_LABELS[card.continent] || card.continent;
        var originDisplay = card.originLabel || om.label;
        html += '<button class="atlas-card-btn" data-cid="' + esc(card.id) + '" style="text-align:left;background:var(--bg-panel);border:1px solid var(--border);border-radius:14px;padding:13px 14px;cursor:pointer;color:#eef2ff;display:flex;flex-direction:column;gap:5px;transition:border-color .15s,transform .12s;">' +
          '<div style="display:flex;align-items:center;gap:8px;">' +
          '  <span style="font-size:22px;line-height:1;">' + esc(card.flag || '🏳️') + '</span>' +
          '  <span style="font-weight:800;font-size:14px;color:#fff;line-height:1.2;">' + esc(card.name) + '</span>' +
          '</div>' +
          '<div style="font-size:11px;color:var(--dim);">' + esc(contName) + ' · <span style="font-family:\'Space Mono\',monospace;color:#cbd5e1;">' + esc(card.modernYear || '') + '</span></div>' +
          '<div style="font-size:11px;color:#93c5fd;font-weight:700;margin-top:2px;">' + om.icon + ' ' + esc(originDisplay) + '</div>' +
          '</button>';
      });
      html += '</div>';
    }

    html += '</div>';
    rootEl.innerHTML = html;

    var backBtn = rootEl.querySelector('#btn-atlas-back');
    if (backBtn) backBtn.addEventListener('click', function () {
      if (typeof window.goBack === 'function') window.goBack();
      else if (typeof window.go === 'function') window.go('s-setup');
    });

    var searchEl = rootEl.querySelector('#atlas-search');
    if (searchEl) {
      searchEl.addEventListener('input', function () {
        _atlasState.search = searchEl.value;
        var pos = searchEl.selectionStart;
        paintAtlasDOM(rootEl, data);
        var nextInput = rootEl.querySelector('#atlas-search');
        if (nextInput) {
          nextInput.focus();
          try { nextInput.setSelectionRange(pos, pos); } catch (_) {}
        }
      });
    }

    var originSel = rootEl.querySelector('#atlas-origin-filter');
    if (originSel) {
      originSel.addEventListener('change', function () {
        _atlasState.originType = originSel.value;
        paintAtlasDOM(rootEl, data);
      });
    }

    rootEl.querySelectorAll('.atlas-cont-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        _atlasState.continent = tab.getAttribute('data-cont');
        paintAtlasDOM(rootEl, data);
      });
    });

    rootEl.querySelectorAll('.atlas-card-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openGenesisCard(btn.getAttribute('data-cid'));
      });
    });
  }

  async function openGenesisCard(countryIdOrName) {
    var data = await loadGenesisData();
    if (!data) {
      toast('Could not load country story right now', 2000);
      return;
    }
    var card = resolveGenesisCard(data, countryIdOrName);
    if (!card) {
      toast('Origin card not available for that entry', 1800);
      return;
    }

    var om = ORIGIN_META[card.originType] || { icon: '🗺️', label: 'Modern Borders' };
    var contName = CONTINENT_LABELS[card.continent] || card.continent;
    var originDisplay = card.originLabel || om.label;

    var html = '' +
      '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:10px;">' +
      '  <div style="display:flex;align-items:center;gap:10px;">' +
      '    <span style="font-size:34px;line-height:1;">' + esc(card.flag || '🏳️') + '</span>' +
      '    <div>' +
      '      <h3 style="font-family:\'Fredoka One\',sans-serif;font-size:23px;color:#fff;margin:0;line-height:1.15;">' + esc(card.name) + '</h3>' +
      '      <div style="font-size:12px;color:var(--dim);margin-top:3px;">' + esc(contName) + (card.capital ? ' · Capital: ' + esc(card.capital) : '') + ' · Modern Borders: <span style="font-family:\'Space Mono\',monospace;color:#e2e8f0;">' + esc(card.modernYear || '') + '</span></div>' +
      '    </div>' +
      '  </div>' +
      '  <button id="gc-close" aria-label="Close" style="background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);color:#cbd5e1;width:32px;height:32px;border-radius:10px;cursor:pointer;font-size:16px;flex-shrink:0;">✕</button>' +
      '</div>' +

      // Live D3 TopoJSON Silhouette Frame
      '<div id="gc-silhouette" style="background:rgba(6,13,46,0.7);border:1px solid rgba(91,143,255,0.2);border-radius:14px;padding:8px;margin-bottom:14px;min-height:148px;display:flex;align-items:center;justify-content:center;">' +
      '  <div style="font-size:11px;color:var(--dim);">Drawing borders…</div>' +
      '</div>' +

      // Unboxed Origin Category (icon + label, never hue-only)
      '<div style="font-size:12px;font-weight:800;color:#93c5fd;letter-spacing:.03em;margin-bottom:8px;">' +
      om.icon + ' ' + esc(originDisplay) +
      '</div>' +

      // Main 2-3 sentence prose story
      '<p style="font-size:14px;line-height:1.62;color:#e2e8f0;margin:0 0 14px;">' + esc(card.story || '') + '</p>';

    // Hairline-bordered Key Turning Point inset (no thick colored left bar)
    if (card.turningPoint) {
      var tpText = (typeof card.turningPoint === 'string')
        ? card.turningPoint
        : ((card.turningPoint.year ? card.turningPoint.year + ' · ' : '') + (card.turningPoint.title || '') + (card.turningPoint.detail ? ' — ' + card.turningPoint.detail : ''));
      html += '<div style="background:rgba(255,255,255,0.035);border:1px solid rgba(91,143,255,0.22);border-radius:12px;padding:12px 14px;margin-bottom:12px;">' +
        '<div style="font-size:10px;color:var(--dim);text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px;">Key Turning Point</div>' +
        '<div style="font-size:13px;font-weight:800;color:#ffe135;line-height:1.4;">' + esc(tpText) + '</div>' +
        '</div>';
    }

    // Optional calm Contested Borders note
    if (card.contestedNote) {
      html += '<div style="background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:10px 12px;margin-bottom:12px;font-size:12px;line-height:1.5;color:#cbd5e1;">' +
        '<strong style="color:#fde68a;">Border Note:</strong> ' + esc(card.contestedNote) +
        '</div>';
    }

    // Quiet footer link to Lines on a Map (s-solidarity)
    html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.08);font-size:12px;">' +
      '<button id="gc-lines-link" style="background:none;border:none;color:#93c5fd;font-size:12px;font-weight:700;cursor:pointer;padding:0;text-align:left;">Learn why borders matter → Lines on a Map</button>' +
      '<button id="gc-done" style="padding:7px 14px;border-radius:9px;border:1px solid var(--border);background:rgba(255,255,255,.06);color:#fff;font-size:12px;font-weight:700;cursor:pointer;">Done</button>' +
      '</div>';

    var m = createOverlayModal('mapolis-genesis-card-modal', html, { maxWidth: '470px' });

    m.sheet.querySelector('#gc-close').addEventListener('click', function () { m.overlay.remove(); });
    m.sheet.querySelector('#gc-done').addEventListener('click', function () { m.overlay.remove(); });
    m.sheet.querySelector('#gc-lines-link').addEventListener('click', function () {
      m.overlay.remove();
      if (typeof window.go === 'function') window.go('s-solidarity');
    });

    // Draw live D3 TopoJSON silhouette
    var silEl = m.sheet.querySelector('#gc-silhouette');
    var features = await loadTopoFeatures();
    var feat = findCountryGeoFeature(features, card.numId);
    renderSilhouetteSvg(silEl, feat, card.numId);
  }

  // ── Export Browser API ───────────────────────────────────────────────────

  window.MapolisPreBeta6 = {
    ORIGIN_META: ORIGIN_META,
    CONTINENT_META: CONTINENT_META,
    CONTINENT_LABELS: CONTINENT_LABELS,
    normalizeFriendQuery: normalizeFriendQuery,
    normalizeRoomCodeInput: normalizeRoomCodeInput,
    formatRoomCodeDisplay: formatRoomCodeDisplay,
    resolveGenesisCard: resolveGenesisCard,
    filterGenesisCards: filterGenesisCards,
    openH2HModePicker: openH2HModePicker,
    renderFriendsScreen: renderFriendsScreen,
    openPublicPlayerCard: openPublicPlayerCard,
    startIncomingChallengePoller: startIncomingChallengePoller,
    renderAtlasScreen: renderAtlasScreen,
    openGenesisCard: openGenesisCard,
    loadGenesisData: loadGenesisData
  };

  window.openH2HModePicker = openH2HModePicker;
  window.renderFriendsScreen = renderFriendsScreen;
  window.openPublicPlayerCard = openPublicPlayerCard;
  window.renderAtlasScreen = renderAtlasScreen;
  window.openGenesisCard = openGenesisCard;

  // Start lightweight incoming challenge poller after page boot
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(startIncomingChallengePoller, 2500);
  } else {
    window.addEventListener('DOMContentLoaded', function () {
      setTimeout(startIncomingChallengePoller, 2500);
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);

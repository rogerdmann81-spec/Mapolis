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

  // Single-use per-session action token registry for one-tap popup response buttons.
  // Binds each Accept / Decline button to (activeProfileId, senderId, kind, expiry)
  // so duplicate clicks, stale-profile clicks, or cross-request replays are rejected.
  function createActionTokenRegistry(defaultTtlMs) {
    const ttl = (typeof defaultTtlMs === 'number' && defaultTtlMs > 0) ? defaultTtlMs : 5 * 60 * 1000;
    const store = new Map();
    let seq = 0;

    function randomToken() {
      seq += 1;
      if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        const bytes = new Uint8Array(12);
        crypto.getRandomValues(bytes);
        let hex = '';
        for (let i = 0; i < bytes.length; i++) {
          hex += bytes[i].toString(16).padStart(2, '0');
        }
        return 'act_' + hex;
      }
      return 'act_' + Date.now().toString(36) + '_' + seq.toString(36) + '_' + Math.random().toString(36).slice(2, 10);
    }

    function prune(nowMs) {
      const now = typeof nowMs === 'number' ? nowMs : Date.now();
      for (const [k, v] of store.entries()) {
        if (v.used || now > v.expiresAt) store.delete(k);
      }
    }

    function issue(profileId, senderId, kind, nowMs) {
      const now = typeof nowMs === 'number' ? nowMs : Date.now();
      prune(now);
      const token = randomToken();
      store.set(token, {
        profileId: String(profileId || ''),
        senderId: String(senderId || ''),
        kind: String(kind || ''),
        expiresAt: now + ttl,
        used: false
      });
      return token;
    }

    function consume(token, expectedProfileId, expectedSenderId, expectedKind, nowMs) {
      if (!token || typeof token !== 'string') return { ok: false, reason: 'missing_token' };
      const entry = store.get(token);
      if (!entry) return { ok: false, reason: 'invalid_token' };
      if (entry.used) return { ok: false, reason: 'already_used' };
      const now = typeof nowMs === 'number' ? nowMs : Date.now();
      if (now > entry.expiresAt) {
        store.delete(token);
        return { ok: false, reason: 'expired' };
      }
      if (
        entry.profileId !== String(expectedProfileId || '') ||
        entry.senderId !== String(expectedSenderId || '') ||
        entry.kind !== String(expectedKind || '')
      ) {
        return { ok: false, reason: 'mismatch' };
      }
      entry.used = true;
      store.delete(token);
      return { ok: true };
    }

    function clear() {
      store.clear();
    }

    return { issue, consume, clear, size: () => store.size };
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

  const TRIVIA_KIND_META = {
    festival:  { label: 'Festival',  color: '#fcd34d' },
    tradition: { label: 'Tradition', color: '#fdba74' },
    landmark:  { label: 'Landmark',  color: '#93c5fd' },
    culture:   { label: 'Culture',   color: '#c4b5fd' }
  };

  // Declarative Atlas display metadata for all 24 map-data.js language questions (never display raw quiz questions)
  const LANGUAGE_DISPLAY_META = {
    lang_gaelic:     { name: 'Irish Gaelic', note: 'official language' },
    lang_welsh:      { name: 'Welsh', note: 'official language in Wales' },
    lang_icelandic:  { name: 'Icelandic', note: 'national language' },
    lang_maltese:    { name: 'Maltese', note: "Europe's only Semitic national language" },
    lang_hungarian:  { name: 'Hungarian (Magyar)', note: 'official language' },
    lang_finnish:    { name: 'Finnish', note: 'official language' },
    lang_catalan:    { name: 'Catalan', note: 'official in Andorra; co-official in northeastern Spain' },
    lang_basque:     { name: 'Basque (Euskara)', note: 'language isolate of the western Pyrenees' },
    lang_romanian:   { name: 'Romanian', note: 'official language' },
    lang_greek:      { name: 'Greek', note: 'official language' },
    lang_swiss:      { name: 'German, French, Italian, and Romansh', note: 'four official languages' },
    lang_faroese:    { name: 'Faroese', note: 'official in the Faroe Islands' },
    lang_mandarin:   { name: 'Mandarin Chinese', note: 'most widely spoken language' },
    lang_hindi:      { name: 'Hindi', note: 'most widely spoken language' },
    lang_japanese:   { name: 'Japanese', note: 'national language' },
    lang_korean:     { name: 'Korean', note: 'official language' },
    lang_thai:       { name: 'Thai', note: 'official language' },
    lang_vietnamese: { name: 'Vietnamese', note: 'official language' },
    lang_arabic_sa:  { name: 'Arabic', note: 'official language' },
    lang_farsi:      { name: 'Farsi (Persian)', note: 'official language' },
    lang_urdu:       { name: 'Urdu', note: 'national language' },
    lang_tagalog:    { name: 'Tagalog (Filipino)', note: 'national language' },
    lang_bahasa:     { name: 'Bahasa Indonesia', note: 'official language' },
    lang_hebrew:     { name: 'Hebrew', note: 'official language' }
  };

  function buildGameAssetIndex(globalRoot) {
    const g = globalRoot || (typeof window !== 'undefined' ? window : null);
    const idx = {
      river: Object.create(null),
      mountain: Object.create(null),
      peninsula: Object.create(null),
      island: Object.create(null),
      archipelago: Object.create(null),
      waterBody: Object.create(null),
      heritage: Object.create(null),
      city: Object.create(null),
      language: Object.create(null),
      trivia: Object.create(null),
      animal: Object.create(null),
      loadedCount: 0
    };
    if (!g) return idx;

    const continents = [g.EUROPE_DATA, g.AFRICA_DATA, g.ASIA_DATA, g.NA_DATA, g.SA_DATA, g.OC_DATA];
    function addList(bucket, arr) {
      if (!Array.isArray(arr)) return;
      for (let i = 0; i < arr.length; i++) {
        const item = arr[i];
        if (item && item.id) {
          bucket[item.id] = item;
          idx.loadedCount++;
        }
      }
    }
    for (let i = 0; i < continents.length; i++) {
      const cd = continents[i];
      if (!cd) continue;
      addList(idx.river, cd.rivers);
      addList(idx.mountain, cd.mountains);
      addList(idx.peninsula, cd.peninsulas);
      addList(idx.island, cd.islands);
      addList(idx.archipelago, cd.archipelagos);
      addList(idx.waterBody, cd.waterBodies);
      addList(idx.heritage, cd.heritageSites);
      addList(idx.city, cd.cities);
      addList(idx.language, cd.languageQuestions);
      addList(idx.trivia, cd.triviaQuestions);
    }

    if (Array.isArray(g.ANIMAL_PRESERVE)) {
      for (let j = 0; j < g.ANIMAL_PRESERVE.length; j++) {
        const a = g.ANIMAL_PRESERVE[j];
        if (a && a.id) {
          idx.animal[a.id] = a;
          idx.loadedCount++;
        }
      }
    }
    return idx;
  }

  function _cleanFeatureLabel(raw) {
    return String(raw || '').replace(/^\s*(?:Find|Locate)\s+(?:the\s+)?/i, '').trim();
  }

  function resolveCardAssets(card, assetIndex) {
    const idx = assetIndex || buildGameAssetIndex();
    const env = (card && card.environment) || {};
    const cul = (card && card.culture) || {};

    const landByGroup = { mountain: [], peninsula: [], island: [], archipelago: [] };
    const seenLand = Object.create(null);
    (env.landFeatureIds || []).forEach(function (ref) {
      if (!ref || !ref.type || !ref.id) return;
      const bucket = idx[ref.type];
      const item = bucket && bucket[ref.id];
      if (!item) return;
      const display = item.name || _cleanFeatureLabel(item.label) || ref.id;
      const dedupeKey = ref.type + ':' + display.toLowerCase();
      if (seenLand[dedupeKey]) return;
      seenLand[dedupeKey] = true;
      if (landByGroup[ref.type]) landByGroup[ref.type].push({ id: ref.id, type: ref.type, name: display });
    });

    const rivers = [];
    const lakes = [];
    const seasAndStraits = [];
    const seenWater = Object.create(null);
    (env.waterFeatureIds || []).forEach(function (ref) {
      if (!ref || !ref.type || !ref.id) return;
      const bucket = idx[ref.type];
      const item = bucket && bucket[ref.id];
      if (!item) return;
      const display = item.name || _cleanFeatureLabel(item.label) || ref.id;
      const dedupeKey = ref.type + ':' + display.toLowerCase();
      if (seenWater[dedupeKey]) return;
      seenWater[dedupeKey] = true;
      if (ref.type === 'river') {
        rivers.push({ id: ref.id, type: 'river', name: display });
      } else if (/\b(lake|loch|lough|lagoon|laguna|étang|etang|bodensee|balaton|van|urmia|dead sea|aral|issyk|balkhash|baikal|titicaca|maracaibo|turkana|victoria|tanganyika|malawi|chad|nasser|volta|kariba|albert|kivu|edward|tana|eyre|taupo|great lakes|great salt|great bear|great slave|winnipeg|superior|huron|michigan|erie|ontario|nicaragua|chapala|geneva|como|garda|maggiore|ladoga|onega|peipus|vänern|vättern|saimaa|inarii|tonle|qinghai|poyang|dongting|biwa|toba)\b/i.test(display)) {
        lakes.push({ id: ref.id, type: 'waterBody', name: display });
      } else {
        seasAndStraits.push({ id: ref.id, type: 'waterBody', name: display });
      }
    });

    const animals = [];
    (env.animalIds || []).forEach(function (aid) {
      const a = idx.animal[aid];
      if (a) animals.push(a);
    });

    const heritageSites = [];
    (cul.heritageIds || []).forEach(function (hid) {
      const h = idx.heritage[hid];
      if (h) heritageSites.push({ id: hid, name: h.name || _cleanFeatureLabel(h.label) });
    });

    const cities = [];
    (cul.cityIds || []).forEach(function (cid) {
      const c = idx.city[cid];
      if (c) cities.push({ id: cid, name: c.name || _cleanFeatureLabel(c.label) });
    });

    const languages = [];
    (cul.languageIds || []).forEach(function (lid) {
      const l = idx.language[lid];
      if (l) {
        const meta = LANGUAGE_DISPLAY_META[lid];
        if (meta) {
          languages.push({ id: lid, name: meta.name, clue: meta.note || '' });
        } else {
          const fallbackName = String(l.label || '')
            .replace(/^\s*(?:In\s+which\s+country\s+is|Which\s+[^?]*?speaks?|Where\s+is|Find\s+the\s+country\s+where)\s+/i, '')
            .replace(/\s+(?:is\s+the\s+official\s+language\s+of\s+which\s+country|is\s+spoken\s+in\s+which\s+country|widely\s+spoken|an?\s+official\s+language|spoken)\s*\??$/i, '')
            .replace(/\?+$/g, '')
            .trim();
          languages.push({ id: lid, name: fallbackName || lid.replace(/^lang_/, ''), clue: '' });
        }
      }
    });

    const triviaItems = [];
    (cul.triviaItems || []).forEach(function (ti) {
      if (!ti || !ti.id || !ti.fact) return;
      if (idx.loadedCount > 0 && !idx.trivia[ti.id]) return;
      triviaItems.push({
        id: ti.id,
        kind: ti.kind || 'culture',
        fact: ti.fact
      });
    });

    return {
      biomeLabel: env.biomeLabel || '',
      summary: env.summary || '',
      landByGroup: landByGroup,
      hasLand: landByGroup.mountain.length + landByGroup.peninsula.length + landByGroup.island.length + landByGroup.archipelago.length > 0,
      rivers: rivers,
      lakes: lakes,
      seasAndStraits: seasAndStraits,
      hasWater: rivers.length + lakes.length + seasAndStraits.length > 0,
      animals: animals,
      heritageSites: heritageSites,
      cities: cities,
      languages: languages,
      triviaItems: triviaItems
    };
  }

  function filterGenesisCards(cardsList, filters, assetIndex) {
    const list = Array.isArray(cardsList) ? cardsList : Object.values(cardsList || {});
    const f = filters || {};
    const cont = f.continent || 'all';
    const origin = f.originType || 'all';
    const q = String(f.search || '').trim().toLowerCase();
    const idx = assetIndex || (q && typeof window !== 'undefined' ? buildGameAssetIndex(window) : null);

    return list.filter(c => {
      if (!c) return false;
      if (cont !== 'all' && c.continent !== cont) return false;
      if (origin !== 'all' && c.originType !== origin) return false;
      if (q) {
        const parts = [
          c.name || '',
          c.capital || '',
          c.modernYear || '',
          c.originLabel || '',
          c.id || ''
        ];
        if (c.environment) {
          if (c.environment.biomeLabel) parts.push(c.environment.biomeLabel);
          if (c.environment.summary) parts.push(c.environment.summary);
          (c.environment.landFeatureIds || []).forEach(function (ref) {
            if (!ref || !ref.id) return;
            const item = idx && idx[ref.type] && idx[ref.type][ref.id];
            parts.push(item ? (item.name || item.label || ref.id) : ref.id.replace(/_/g, ' '));
          });
          (c.environment.waterFeatureIds || []).forEach(function (ref) {
            if (!ref || !ref.id) return;
            const item = idx && idx[ref.type] && idx[ref.type][ref.id];
            parts.push(item ? (item.name || item.label || ref.id) : ref.id.replace(/_/g, ' '));
          });
          (c.environment.animalIds || []).forEach(function (aid) {
            const a = idx && idx.animal && idx.animal[aid];
            parts.push(a ? a.name : String(aid).replace(/^a_/, '').replace(/_/g, ' '));
          });
        }
        if (c.culture) {
          (c.culture.heritageIds || []).forEach(function (hid) {
            const h = idx && idx.heritage && idx.heritage[hid];
            parts.push(h ? (h.name || h.label || hid) : String(hid).replace(/_/g, ' '));
          });
          (c.culture.cityIds || []).forEach(function (cid) {
            const ci = idx && idx.city && idx.city[cid];
            parts.push(ci ? (ci.name || ci.label || cid) : String(cid).replace(/_/g, ' '));
          });
          (c.culture.languageIds || []).forEach(function (lid) {
            const meta = LANGUAGE_DISPLAY_META[lid];
            const la = idx && idx.language && idx.language[lid];
            if (meta) parts.push(meta.name + ' ' + (meta.note || ''));
            else parts.push(la ? (la.label || lid) : String(lid).replace(/^lang_/, '').replace(/_/g, ' '));
          });
          (c.culture.triviaItems || []).forEach(function (ti) {
            if (ti && ti.fact) parts.push(ti.fact);
          });
        }
        const hay = parts.join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }

  const ATLAS_GLOBE_TARGETS = {
    all:             { rotate: [-15, -20, 0], zoom: 1.0 },
    europe:          { rotate: [-15, -50, 0], zoom: 1.8 },
    africa:          { rotate: [-20, -4,  0], zoom: 1.3 },
    asia:            { rotate: [-88, -32, 0], zoom: 1.25 },
    'north-america': { rotate: [98,  -40, 0], zoom: 1.3 },
    'south-america': { rotate: [60,  16,  0], zoom: 1.4 },
    oceania:         { rotate: [-140, 22, 0], zoom: 1.45 }
  };

  function angularDistanceDeg(a, b) {
    if (!a || !b || a.length < 2 || b.length < 2) return Infinity;
    const rad = Math.PI / 180;
    const lat1 = a[1] * rad;
    const lat2 = b[1] * rad;
    const dLon = (b[0] - a[0]) * rad;
    const cosD = Math.sin(lat1) * Math.sin(lat2) + Math.cos(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return Math.acos(Math.max(-1, Math.min(1, cosD))) / rad;
  }

  function findAtlasCountryAtLonLat(lonLat, features, cardsByNumId, geoContainsFn, geoCentroidFn, geoAreaFn, maxDegFallback) {
    if (!lonLat || !Array.isArray(features) || !cardsByNumId) return null;
    const exactMatches = [];
    if (typeof geoContainsFn === 'function') {
      for (let i = 0; i < features.length; i++) {
        const feat = features[i];
        if (!feat) continue;
        const card = cardsByNumId[Number(feat.id)];
        if (!card) continue;
        try {
          if (geoContainsFn(feat, lonLat)) {
            const area = typeof geoAreaFn === 'function' ? geoAreaFn(feat) : 1;
            exactMatches.push({ feature: feat, card, area });
          }
        } catch (_) {}
      }
    }
    if (exactMatches.length > 0) {
      exactMatches.sort((a, b) => a.area - b.area);
      return exactMatches[0];
    }

    // Proximity fallback for small island nations & microstates
    const threshold = typeof maxDegFallback === 'number' ? maxDegFallback : 2.6;
    if (typeof geoCentroidFn === 'function' && threshold > 0) {
      let best = null;
      let bestDist = threshold;
      for (let i = 0; i < features.length; i++) {
        const feat = features[i];
        if (!feat) continue;
        const card = cardsByNumId[Number(feat.id)];
        if (!card) continue;
        try {
          const c = feat._atlasCentroid || (feat._atlasCentroid = geoCentroidFn(feat));
          if (!c || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
          const dist = angularDistanceDeg(lonLat, c);
          if (dist < bestDist) {
            bestDist = dist;
            best = { feature: feat, card, area: 0 };
          }
        } catch (_) {}
      }
      return best;
    }
    return null;
  }

  function flagEmojiToIso2(flag) {
    if (!flag) return null;
    const cps = Array.from(String(flag))
      .map(ch => ch.codePointAt(0))
      .filter(cp => cp >= 0x1F1E6 && cp <= 0x1F1FF);
    if (cps.length !== 2) return null;
    return String.fromCharCode(cps[0] - 0x1F1E6 + 97, cps[1] - 0x1F1E6 + 97);
  }

  // Export pure helpers immediately for Node unit tests
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      ORIGIN_META,
      CONTINENT_META,
      CONTINENT_LABELS,
      TRIVIA_KIND_META,
      LANGUAGE_DISPLAY_META,
      ATLAS_GLOBE_TARGETS,
      normalizeFriendQuery,
      normalizeRoomCodeInput,
      formatRoomCodeDisplay,
      createActionTokenRegistry,
      buildGameAssetIndex,
      resolveCardAssets,
      resolveGenesisCard,
      filterGenesisCards,
      angularDistanceDeg,
      findAtlasCountryAtLonLat,
      flagEmojiToIso2
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

  function getCurrentScreenId() {
    if (window.currentScreen) return window.currentScreen;
    if (typeof document !== 'undefined') {
      var activeEl = document.querySelector('.screen.active');
      if (activeEl && activeEl.id) return activeEl.id;
    }
    return null;
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
    dismissFriendRequestBanner();

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
      '      <div style="font-size:12px;color:#bbf7d0;margin-top:2px;line-height:1.35;">Search by exact username or challenge someone on your Friend List · Friendly or Ranked.</div>' +
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

  // ── 2. Friends & Direct Challenges Screen (#s-friends) ───────────────────

  var _friendState = {
    loading: false,
    allowRequests: true,
    friends: [],
    incoming: [],
    outgoing: [],
    blocked: [],
    roomRanked: false,
    activeRoom: null, // { room_id, is_ranked, expires_at, targetHandle }
    lookupResult: null,
    lookupMsg: '',
    showBlocked: false
  };

  var _roomPollTimer = null;
  var _roomTickTimer = null;
  var _popupTokens = createActionTokenRegistry(5 * 60 * 1000);

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
        else if (res.status === 'expired') toast('Challenge expired', 2400);
        if (getCurrentScreenId() === 's-friends') renderFriendsScreen(false);
      }
    }, 2000);

    _roomTickTimer = setInterval(function () {
      var cdEl = document.getElementById('chal-wait-countdown');
      if (!cdEl || !_friendState.activeRoom || !_friendState.activeRoom.expires_at) return;
      var rem = Math.max(0, Math.floor((new Date(_friendState.activeRoom.expires_at).getTime() - Date.now()) / 1000));
      var m = Math.floor(rem / 60);
      var s = rem % 60;
      cdEl.textContent = m + ':' + (s < 10 ? '0' : '') + s;
      if (rem <= 0) {
        _friendState.activeRoom = null;
        stopRoomPoll();
        closeOverlayModal('mapolis-challenge-wait-modal');
        if (getCurrentScreenId() === 's-friends') renderFriendsScreen(false);
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
      _friendState.allowRequests = (typeof res.allow_friend_requests === 'boolean') ? res.allow_friend_requests : true;
      profile.allowFriendRequests = _friendState.allowRequests;
      _friendState.friends = Array.isArray(res.friends) ? res.friends : [];
      _friendState.incoming = Array.isArray(res.incoming) ? res.incoming : [];
      _friendState.outgoing = Array.isArray(res.outgoing) ? res.outgoing : [];
      _friendState.blocked = Array.isArray(res.blocked) ? res.blocked : [];
      updateFriendsNavBadge(_friendState.incoming.length);
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

    if (window.MapolisCompliance && !window.MapolisCompliance.isCloudSyncAllowed(profile)) {
      var syncStatus = window.MapolisCompliance.getCloudSyncStatus(profile);
      var meta = window.MapolisCompliance.getConsentBadgeMeta(syncStatus);
      rootEl.innerHTML =
        '<div style="max-width:480px;margin:0 auto;padding:18px 16px 36px;color:#eef2ff;text-align:center;">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">' +
            '<button id="btn-friends-back" style="background:none;border:none;color:var(--dim);font-size:13px;font-weight:700;padding:6px 0;cursor:pointer;">← Back</button>' +
            '<div style="font-size:11px;color:' + meta.color + ';font-weight:700;">' + meta.icon + ' ' + meta.shortLabel + '</div>' +
          '</div>' +
          '<div style="background:rgba(15,23,42,0.85);border:1px solid ' + meta.borderColor + ';border-radius:18px;padding:24px 20px;">' +
            '<div style="font-size:36px;margin-bottom:10px;">' + meta.icon + '</div>' +
            '<h2 style="font-family:\'Fredoka One\',sans-serif;font-size:22px;color:#fff;margin:0 0 8px;">Friends Requires Parent Approval</h2>' +
            '<p style="font-size:13px;color:#cbd5e1;line-height:1.55;margin:0 0 18px;">' +
              (syncStatus === 'pending_consent'
                ? 'Your parent approval link has been sent. Once a parent or guardian clicks Approve within 72 hours, Friends and Head-to-Head will unlock automatically.'
                : 'Your profile is currently in Local-Only Mode so zero data leaves this device. Ask a parent or guardian to link and verify their email to unlock Friends, Cloud Sync, and Head-to-Head play.') +
            '</p>' +
            '<div style="display:flex;flex-direction:column;gap:10px;">' +
              '<button id="btn-friends-parent-consent" style="width:100%;background:var(--yellow,#ffd700);color:#111;font-family:\'Fredoka One\',sans-serif;font-size:14px;border:none;border-radius:999px;padding:11px 16px;cursor:pointer;">' +
                (syncStatus === 'pending_consent' ? '🔄 Check Approval or Resend Link' : '🛡️ Ask Parent to Enable Cloud Sync') +
              '</button>' +
              '<button id="btn-friends-back-solo" style="width:100%;background:var(--bg-panel);color:var(--text);font-weight:700;font-size:13px;border:1px solid var(--border);border-radius:999px;padding:10px 16px;cursor:pointer;">Keep Playing Solo Locally</button>' +
            '</div>' +
          '</div>' +
        '</div>';
      var b1 = rootEl.querySelector('#btn-friends-back');
      var b2 = rootEl.querySelector('#btn-friends-back-solo');
      var b3 = rootEl.querySelector('#btn-friends-parent-consent');
      if (b1) b1.addEventListener('click', function () { if (typeof window.goBack === 'function') window.goBack(); });
      if (b2) b2.addEventListener('click', function () { if (typeof window.go === 'function') window.go('s-setup'); });
      if (b3) b3.addEventListener('click', function () {
        if (syncStatus === 'pending_consent' && typeof window.checkParentConsentStatusForProfile === 'function') {
          window.checkParentConsentStatusForProfile(profile, true);
        } else if (typeof window.openRecoveryEmailModal === 'function') {
          window.openRecoveryEmailModal(profile);
        }
      });
      return;
    }

    // Inline incoming requests are visible on #s-friends, so avoid overlapping with top popup
    dismissFriendRequestBanner();

    if (shouldFetch !== false && window.friendStore) {
      paintFriendsDOM(rootEl, profile);
      await refreshFriendsData();
      if (getCurrentScreenId() === 's-friends') {
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
      '<div style="font-size:12px;color:var(--dim);margin-top:3px;">Search by exact username to add friends or send a live Head-to-Head challenge</div>' +
      '</div>';

    if (offline) {
      html += '<div style="background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.35);border-radius:12px;padding:12px 14px;font-size:12px;color:#fde68a;margin-bottom:14px;">' +
        '📡 Connect to the internet to find friends or send live challenges. Solo play and World Atlas work offline.' +
        '</div>';
    }

    // Card 1: Find a Player by Exact Username + Challenge Mode
    html += '<div style="background:var(--bg-panel);border:1px solid var(--border);border-radius:16px;padding:16px;margin-bottom:12px;">';
    html += '<div style="font-weight:800;font-size:14px;color:#fff;margin-bottom:3px;">Find a Player</div>' +
      '<div style="font-size:11px;color:var(--dim);margin-bottom:10px;">Search by exact profile username (no public browsing)</div>';

    html += '<div style="display:flex;gap:8px;margin-bottom:12px;">' +
      '<input id="fr-lookup-input" type="text" maxlength="32" autocomplete="off" spellcheck="false" aria-label="Exact profile username" placeholder="Enter exact username…" style="flex:1;min-width:0;padding:10px 12px;border-radius:10px;border:1px solid var(--border);background:var(--bg-deep);color:#fff;font-size:13px;">' +
      '<button id="fr-lookup-btn" ' + (offline ? 'disabled' : '') + ' style="padding:10px 16px;border-radius:10px;border:none;background:var(--yellow);color:#111;font-family:\'Fredoka One\',sans-serif;font-size:14px;cursor:pointer;flex-shrink:0;' + (offline ? 'opacity:.5;cursor:not-allowed;' : '') + '">Search</button>' +
      '</div>';

    if (st.lookupMsg) {
      html += '<div style="font-size:12px;color:#fde68a;margin-bottom:10px;">' + esc(st.lookupMsg) + '</div>';
    }
    if (st.lookupResult && st.lookupResult.player) {
      var lp = st.lookupResult.player;
      var lrel = st.lookupResult.relation_status || 'none';
      html += '<div style="margin-bottom:12px;padding:12px;background:var(--bg-deep);border:1px solid rgba(91,143,255,.32);border-radius:12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">' +
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

    // Challenge match mode selector (applies to all Challenge buttons below)
    html += '<div style="padding-top:10px;border-top:1px solid rgba(255,255,255,.07);">' +
      '<div style="font-size:11px;color:var(--dim);font-weight:700;margin-bottom:6px;">Challenge Mode</div>' +
      '<div style="display:flex;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:3px;gap:4px;">' +
      '  <button id="fr-mode-friendly" style="flex:1;padding:7px 8px;border-radius:8px;border:none;font-size:12px;font-weight:700;cursor:pointer;background:' + (!st.roomRanked ? '#22c55e' : 'transparent') + ';color:' + (!st.roomRanked ? '#04120a' : 'var(--dim)') + ';">🤝 Friendly (Unranked)</button>' +
      '  <button id="fr-mode-ranked" style="flex:1;padding:7px 8px;border-radius:8px;border:none;font-size:12px;font-weight:700;cursor:pointer;background:' + (st.roomRanked ? 'var(--blue)' : 'transparent') + ';color:' + (st.roomRanked ? '#fff' : 'var(--dim)') + ';">⚔️ Ranked (ELO)</button>' +
      '</div>';
    if (st.roomRanked) {
      html += '<div style="font-size:11px;color:#93c5fd;margin-top:8px;line-height:1.35;">ELO updates apply for up to 3 ranked matches per day between the same two players.</div>';
    }
    html += '</div>';
    html += '</div>';

    // Card 2: Pending Incoming Friend Requests (with single-use tokenized buttons)
    if (st.incoming.length > 0) {
      html += '<div style="background:var(--bg-panel);border:1px solid rgba(74,222,128,.4);border-radius:16px;padding:14px 16px;margin-bottom:12px;">' +
        '<div style="font-weight:800;font-size:13px;color:#86efac;margin-bottom:8px;">Incoming Friend Requests (' + st.incoming.length + ')</div>';
      st.incoming.forEach(function (req) {
        var acceptTok = _popupTokens.issue(profile.id, req.player_id, 'friend_request');
        var declineTok = _popupTokens.issue(profile.id, req.player_id, 'friend_request');
        html += '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid rgba(255,255,255,.06);">' +
          avatarMarkup(req.avatar_svg, req.avatar_face, 36) +
          '<div style="flex:1;min-width:0;">' +
          '  <div style="font-weight:700;font-size:13px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(req.handle) + '</div>' +
          '  <div style="font-size:11px;color:var(--dim);">ELO ' + (req.rating || 1200) + '</div>' +
          '</div>' +
          '<button class="fr-req-accept" data-pid="' + esc(req.player_id) + '" data-handle="' + esc(req.handle) + '" data-action-token="' + esc(acceptTok) + '" style="padding:6px 10px;border-radius:8px;border:none;background:#22c55e;color:#04120a;font-size:11px;font-weight:800;cursor:pointer;">Accept</button>' +
          '<button class="fr-req-decline" data-pid="' + esc(req.player_id) + '" data-action-token="' + esc(declineTok) + '" style="padding:6px 10px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--dim);font-size:11px;font-weight:700;cursor:pointer;">Decline</button>' +
          '</div>';
      });
      html += '</div>';
    }

    // Card 3: Friends List
    html += '<div style="background:var(--bg-panel);border:1px solid var(--border);border-radius:16px;padding:14px 16px;margin-bottom:12px;">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">' +
      '  <div style="font-weight:800;font-size:14px;color:#fff;">Friends (' + st.friends.length + ')</div>' +
      '  <button id="fr-refresh" style="background:none;border:none;color:var(--blue-lt);font-size:11px;font-weight:700;cursor:pointer;">Refresh</button>' +
      '</div>';

    if (st.friends.length === 0) {
      html += '<div style="text-align:center;padding:18px 8px;color:var(--dim);font-size:12px;line-height:1.45;">' +
        'No friends yet. Search an exact username above or tap any player on the Leaderboard.' +
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
          '<button class="fr-friend-more" data-pid="' + esc(f.player_id) + '" data-handle="' + esc(f.handle) + '" aria-label="Manage ' + esc(f.handle) + '" title="Manage friend" style="padding:6px 8px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--dim);font-size:11px;cursor:pointer;">•••</button>' +
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

    // Card 4: Privacy Settings (no Friend Code clutter)
    html += '<div style="background:var(--bg-panel);border:1px solid var(--border);border-radius:16px;padding:14px 16px;margin-bottom:12px;">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">' +
      '  <div>' +
      '    <div style="font-size:13px;font-weight:700;color:#fff;">Allow Friend Requests &amp; Challenges</div>' +
      '    <div style="font-size:11px;color:var(--dim);margin-top:2px;">When off, hides you from username search, leaderboard challenges, and incoming popups.</div>' +
      '  </div>' +
      '  <button id="fr-toggle-privacy" role="switch" aria-label="Allow Friend Requests and Challenges" aria-checked="' + (st.allowRequests ? 'true' : 'false') + '" style="flex-shrink:0;width:44px;height:24px;border-radius:999px;border:1px solid ' + (st.allowRequests ? '#22c55e' : 'var(--border)') + ';background:' + (st.allowRequests ? '#22c55e' : 'rgba(255,255,255,.1)') + ';position:relative;cursor:pointer;transition:background .15s;">' +
      '    <span style="position:absolute;top:2px;left:' + (st.allowRequests ? '22px' : '2px') + ';width:18px;height:18px;border-radius:50%;background:#fff;transition:left .15s;"></span>' +
      '  </button>' +
      '</div>' +
      '</div>';

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

    var lookupBtn = rootEl.querySelector('#fr-lookup-btn');
    var lookupInput = rootEl.querySelector('#fr-lookup-input');
    async function doLookup() {
      var norm = normalizeFriendQuery(lookupInput ? lookupInput.value : '');
      if (!norm.ok) {
        st.lookupResult = null;
        st.lookupMsg = norm.kind === 'wildcard_disallowed'
          ? 'Enter an exact username (wildcards are not allowed).'
          : 'Enter an exact username (at least 2 characters).';
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
          not_found: 'No player matched that exact username.'
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
      lookupAddBtn.disabled = true;
      var r = await window.friendStore.requestFriend(profile.id, pid);
      if (r && r.ok) {
        toast(r.status === 'accepted' ? 'You are now friends!' : 'Friend request sent!', 2000);
        st.lookupResult.relation_status = r.status === 'accepted' ? 'friends' : 'pending_sent';
        await refreshFriendsData();
        paintFriendsDOM(rootEl, profile);
      } else {
        lookupAddBtn.disabled = false;
        toast('Could not send request', 1800);
      }
    });

    var lookupChalBtn = rootEl.querySelector('#fr-lookup-challenge');
    if (lookupChalBtn) lookupChalBtn.addEventListener('click', function () {
      var pid = lookupChalBtn.getAttribute('data-pid');
      var handle = lookupChalBtn.getAttribute('data-handle');
      sendDirectChallenge(pid, handle, st.roomRanked);
    });

    var privBtn = rootEl.querySelector('#fr-toggle-privacy');
    if (privBtn) privBtn.addEventListener('click', async function () {
      var nextVal = !st.allowRequests;
      st.allowRequests = nextVal;
      profile.allowFriendRequests = nextVal;
      if (!nextVal) dismissAllSocialBanners();
      paintFriendsDOM(rootEl, profile);
      await window.friendStore.setPrivacy(profile.id, nextVal);
      toast(nextVal ? 'Friend requests & challenges enabled' : 'Friend requests & challenges paused', 2200);
    });

    var refreshBtn = rootEl.querySelector('#fr-refresh');
    if (refreshBtn) refreshBtn.addEventListener('click', function () { renderFriendsScreen(true); });

    rootEl.querySelectorAll('.fr-req-accept').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var pid = btn.getAttribute('data-pid');
        var handle = btn.getAttribute('data-handle') || 'Player';
        var tok = btn.getAttribute('data-action-token');
        var active = getActiveProfile();
        if (!active || !_popupTokens.consume(tok, active.id, pid, 'friend_request').ok) return;
        btn.disabled = true;
        await window.friendStore.respondFriend(active.id, pid, 'accept');
        toast('You and ' + handle + ' are now friends!', 2000);
        renderFriendsScreen(true);
      });
    });

    rootEl.querySelectorAll('.fr-req-decline').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var pid = btn.getAttribute('data-pid');
        var tok = btn.getAttribute('data-action-token');
        var active = getActiveProfile();
        if (!active || !_popupTokens.consume(tok, active.id, pid, 'friend_request').ok) return;
        btn.disabled = true;
        await window.friendStore.respondFriend(active.id, pid, 'decline');
        renderFriendsScreen(true);
      });
    });

    rootEl.querySelectorAll('.fr-req-cancel').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        btn.disabled = true;
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
    if (window.MapolisCompliance && !window.MapolisCompliance.isCloudSyncAllowed(profile)) {
      toast('Parent approval is required to send challenges.', 2400);
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
      '  <div style="margin:14px 0;padding:10px 12px;background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:10px;font-size:12px;color:var(--dim);">' +
      '    Live invite pops up on their screen · Expires in <span id="chal-wait-countdown" style="font-family:\'Space Mono\',monospace;color:#fff;font-weight:700;">5:00</span>' +
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
      } else if (window.MapolisCompliance && !window.MapolisCompliance.isCloudSyncAllowed(profile)) {
        html += '<div style="font-size:12px;color:var(--dim);text-align:center;padding:8px 0;">Parent approval is required before adding friends or sending challenges.</div>';
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

  // ── 4. Age-Gated Live Challenge & Friend Request Popup Poller ────────────

  var _challengePollTimer = null;
  var _pollTickCount = 0;
  var _lastPolledProfileId = null;
  var _dismissedRoomIds = {};
  var _dismissedFriendReqIds = {};
  var _activeBannerRoomId = null;
  var _activeFriendBannerSenderId = null;

  function canShowSocialPopupForProfile(profile) {
    if (!profile || !profile.id) return false;
    if (window.MapolisCompliance && typeof window.MapolisCompliance.canReceiveSocialPopups === 'function') {
      return window.MapolisCompliance.canReceiveSocialPopups(profile);
    }
    if (window.MapolisCompliance && typeof window.MapolisCompliance.isCloudSyncAllowed === 'function') {
      return window.MapolisCompliance.isCloudSyncAllowed(profile);
    }
    return false;
  }

  function updateFriendsNavBadge(pendingCount) {
    var btn = document.getElementById('btn-profile-friends');
    if (!btn) return;
    var n = Number(pendingCount) || 0;
    btn.textContent = n > 0 ? ('🤝 Friends (' + n + ')') : '🤝 Friends';
  }

  function dismissChallengeBanner() {
    var existing = document.getElementById('mapolis-incoming-challenge-banner');
    if (existing) existing.remove();
    _activeBannerRoomId = null;
  }

  function dismissFriendRequestBanner() {
    var existing = document.getElementById('mapolis-incoming-friend-banner');
    if (existing) existing.remove();
    _activeFriendBannerSenderId = null;
  }

  function dismissAllSocialBanners() {
    dismissChallengeBanner();
    dismissFriendRequestBanner();
  }

  function showIncomingChallengeBanner(ch) {
    var profile = getActiveProfile();
    if (!canShowSocialPopupForProfile(profile)) {
      dismissAllSocialBanners();
      return;
    }
    if (!ch || !ch.room_id || _dismissedRoomIds[ch.room_id]) return;
    if (_activeBannerRoomId === ch.room_id && document.getElementById('mapolis-incoming-challenge-banner')) return;
    dismissAllSocialBanners();
    _activeBannerRoomId = ch.room_id;

    var host = ch.host || {};
    var acceptTok = _popupTokens.issue(profile.id, ch.room_id, 'challenge');
    var declineTok = _popupTokens.issue(profile.id, ch.room_id, 'challenge');

    var banner = document.createElement('div');
    banner.id = 'mapolis-incoming-challenge-banner';
    banner.setAttribute('role', 'status');
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
      '<button id="ch-banner-accept" data-action-token="' + esc(acceptTok) + '" style="padding:7px 12px;border-radius:9px;border:none;background:#22c55e;color:#04120a;font-size:12px;font-weight:800;cursor:pointer;">Accept</button>' +
      '<button id="ch-banner-decline" data-action-token="' + esc(declineTok) + '" style="padding:7px 10px;border-radius:9px;border:1px solid rgba(255,255,255,.18);background:transparent;color:#cbd5e1;font-size:12px;font-weight:700;cursor:pointer;">Decline</button>';

    document.body.appendChild(banner);

    var accBtn = banner.querySelector('#ch-banner-accept');
    var decBtn = banner.querySelector('#ch-banner-decline');

    accBtn.addEventListener('click', async function () {
      var active = getActiveProfile();
      if (!canShowSocialPopupForProfile(active)) { dismissAllSocialBanners(); return; }
      if (!_popupTokens.consume(accBtn.getAttribute('data-action-token'), active.id, ch.room_id, 'challenge').ok) return;
      accBtn.disabled = true;
      decBtn.disabled = true;
      var tier = getPlayerTier(active);
      var deck = buildCandidateFriendDeck(tier);
      var res = await window.friendStore.respondChallenge(active.id, ch.room_id, 'accept', tier, deck);
      dismissChallengeBanner();
      if (res && res.status === 'matched') {
        launchDirectH2HMatch(res);
      } else {
        toast('Challenge expired or cancelled', 2000);
      }
    });

    decBtn.addEventListener('click', async function () {
      var active = getActiveProfile();
      if (!active || !_popupTokens.consume(decBtn.getAttribute('data-action-token'), active.id, ch.room_id, 'challenge').ok) return;
      accBtn.disabled = true;
      decBtn.disabled = true;
      _dismissedRoomIds[ch.room_id] = true;
      dismissChallengeBanner();
      await window.friendStore.respondChallenge(active.id, ch.room_id, 'decline');
    });
  }

  function showIncomingFriendRequestBanner(req) {
    var profile = getActiveProfile();
    if (!canShowSocialPopupForProfile(profile)) {
      dismissAllSocialBanners();
      return;
    }
    if (!req || !req.player_id || _dismissedFriendReqIds[req.player_id]) return;
    // Never cover an active live H2H challenge banner
    if (_activeBannerRoomId && document.getElementById('mapolis-incoming-challenge-banner')) return;
    if (_activeFriendBannerSenderId === req.player_id && document.getElementById('mapolis-incoming-friend-banner')) return;

    dismissFriendRequestBanner();
    _activeFriendBannerSenderId = req.player_id;

    var acceptTok = _popupTokens.issue(profile.id, req.player_id, 'friend_request');
    var declineTok = _popupTokens.issue(profile.id, req.player_id, 'friend_request');

    var banner = document.createElement('div');
    banner.id = 'mapolis-incoming-friend-banner';
    banner.setAttribute('role', 'status');
    banner.style.cssText = [
      'position:fixed', 'top:12px', 'left:50%', 'transform:translateX(-50%)',
      'z-index:9590', 'width:calc(100% - 24px)', 'max-width:480px',
      'background:#0f2438', 'border:1px solid rgba(74,222,128,0.55)',
      'border-radius:14px', 'padding:12px 14px',
      'box-shadow:0 12px 32px rgba(0,0,0,0.55)',
      'display:flex', 'align-items:center', 'gap:10px', 'color:#fff'
    ].join(';');

    banner.innerHTML = '' +
      avatarMarkup(req.avatar_svg, req.avatar_face, 38) +
      '<div style="flex:1;min-width:0;">' +
      '  <div style="font-weight:800;font-size:13px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">🤝 ' + esc(req.handle || 'Player') + '</div>' +
      '  <div style="font-size:11px;color:#86efac;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Friend request · ELO ' + (req.rating || 1200) + '</div>' +
      '</div>' +
      '<button id="fr-banner-accept" data-action-token="' + esc(acceptTok) + '" aria-label="Accept friend request from ' + esc(req.handle || 'Player') + '" style="padding:7px 12px;border-radius:9px;border:none;background:#22c55e;color:#04120a;font-size:12px;font-weight:800;cursor:pointer;flex-shrink:0;">Accept</button>' +
      '<button id="fr-banner-decline" data-action-token="' + esc(declineTok) + '" aria-label="Decline friend request from ' + esc(req.handle || 'Player') + '" style="padding:7px 10px;border-radius:9px;border:1px solid rgba(255,255,255,.18);background:transparent;color:#cbd5e1;font-size:12px;font-weight:700;cursor:pointer;flex-shrink:0;">Decline</button>' +
      '<button id="fr-banner-later" aria-label="Dismiss friend request popup for now" title="Decide later in Friends" style="background:none;border:none;color:#94a3b8;font-size:14px;padding:4px;cursor:pointer;line-height:1;flex-shrink:0;">✕</button>';

    document.body.appendChild(banner);

    var accBtn = banner.querySelector('#fr-banner-accept');
    var decBtn = banner.querySelector('#fr-banner-decline');
    var laterBtn = banner.querySelector('#fr-banner-later');

    accBtn.addEventListener('click', async function () {
      var active = getActiveProfile();
      if (!canShowSocialPopupForProfile(active)) { dismissAllSocialBanners(); return; }
      if (!_popupTokens.consume(accBtn.getAttribute('data-action-token'), active.id, req.player_id, 'friend_request').ok) return;
      accBtn.disabled = true;
      decBtn.disabled = true;
      var res = await window.friendStore.respondFriend(active.id, req.player_id, 'accept');
      dismissFriendRequestBanner();
      if (res && !res.error && !res.offline) {
        _friendState.incoming = _friendState.incoming.filter(function (r) { return r && r.player_id !== req.player_id; });
        updateFriendsNavBadge(_friendState.incoming.length);
        toast('You and ' + (req.handle || 'Player') + ' are now friends!', 2200);
        if (getCurrentScreenId() === 's-friends') renderFriendsScreen(true);
      } else {
        toast('Could not accept friend request right now', 2000);
      }
    });

    decBtn.addEventListener('click', async function () {
      var active = getActiveProfile();
      if (!active || !_popupTokens.consume(decBtn.getAttribute('data-action-token'), active.id, req.player_id, 'friend_request').ok) return;
      accBtn.disabled = true;
      decBtn.disabled = true;
      _dismissedFriendReqIds[req.player_id] = true;
      dismissFriendRequestBanner();
      await window.friendStore.respondFriend(active.id, req.player_id, 'decline');
      _friendState.incoming = _friendState.incoming.filter(function (r) { return r && r.player_id !== req.player_id; });
      updateFriendsNavBadge(_friendState.incoming.length);
      if (getCurrentScreenId() === 's-friends') renderFriendsScreen(true);
    });

    laterBtn.addEventListener('click', function () {
      _dismissedFriendReqIds[req.player_id] = true;
      dismissFriendRequestBanner();
    });
  }

  async function pollIncomingSocialActivity(forceFriendCheck) {
    var NON_GAME_SCREENS = {
      's-setup': true, 's-profile': true, 's-leaderboard': true,
      's-friends': true, 's-atlas': true, 's-badges': true, 's-store': true
    };
    if (document.hidden) return;
    var profile = getActiveProfile();

    // Clear stale popups & session state immediately on profile switch or logout
    var currentPid = profile && profile.id ? String(profile.id) : null;
    if (currentPid !== _lastPolledProfileId) {
      _lastPolledProfileId = currentPid;
      _dismissedRoomIds = {};
      _dismissedFriendReqIds = {};
      _popupTokens.clear();
      dismissAllSocialBanners();
      updateFriendsNavBadge(0);
    }

    if (!canShowSocialPopupForProfile(profile)) {
      dismissAllSocialBanners();
      return;
    }
    var screenId = getCurrentScreenId();
    if (!NON_GAME_SCREENS[screenId]) return;
    if (!window.friendStore) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

    // 1. Check live incoming H2H challenges (every 5s)
    var chalRes = await window.friendStore.listIncomingChallenges(profile.id);
    var challenges = (chalRes && Array.isArray(chalRes.challenges)) ? chalRes.challenges : [];
    var activeChal = challenges.find(function (c) { return c && c.room_id && !_dismissedRoomIds[c.room_id]; });
    if (activeChal) {
      showIncomingChallengeBanner(activeChal);
      return;
    } else if (_activeBannerRoomId) {
      dismissChallengeBanner();
    }

    // 2. Check live incoming Friend Requests (immediately on first tick & every 10s)
    var shouldCheckFriends = !!forceFriendCheck || (_pollTickCount % 2 === 0);
    _pollTickCount += 1;
    if (!shouldCheckFriends) return;

    var frRes = await window.friendStore.listFriends(profile.id);
    if (!frRes || frRes.offline || frRes.error) return;
    if (typeof frRes.allow_friend_requests === 'boolean') {
      _friendState.allowRequests = frRes.allow_friend_requests;
      profile.allowFriendRequests = frRes.allow_friend_requests;
      if (!frRes.allow_friend_requests) {
        dismissFriendRequestBanner();
        return;
      }
    }
    var incoming = Array.isArray(frRes.incoming) ? frRes.incoming : [];
    _friendState.incoming = incoming;
    updateFriendsNavBadge(incoming.length);

    // Don't overlay popup when already viewing #s-friends (incoming list is shown inline)
    if (getCurrentScreenId() === 's-friends') {
      dismissFriendRequestBanner();
      return;
    }
    var activeReq = incoming.find(function (r) { return r && r.player_id && !_dismissedFriendReqIds[r.player_id]; });
    if (activeReq) {
      showIncomingFriendRequestBanner(activeReq);
    } else if (_activeFriendBannerSenderId) {
      dismissFriendRequestBanner();
    }
  }

  function startIncomingChallengePoller() {
    if (_challengePollTimer) return;
    // Run an immediate check shortly after boot so pending friend requests pop up promptly
    pollIncomingSocialActivity(true);
    _challengePollTimer = setInterval(function () {
      pollIncomingSocialActivity(false);
    }, 5000);
  }

  // ── 5. Always-Unlocked World Atlas & Country Genesis Cards ───────────────

  var _genesisCache = null;
  var _genesisPromise = null;
  var _topoCache = null;
  var _atlasState = {
    view: 'list', // 'list' | 'globe'
    continent: 'all',
    originType: 'all',
    search: ''
  };

  var _atlasGlobe = {
    rafId: null,
    cleanupFns: [],
    rotation: [-15, -20, 0],
    zoom: 1.0,
    spinning: true,
    suspendedUntil: 0,
    hoveredNumId: null,
    selectedNumId: null,
    tween: null,
    lastFrame: 0,
    api: null
  };

  function stopAtlasGlobe() {
    if (_atlasGlobe.rafId) {
      cancelAnimationFrame(_atlasGlobe.rafId);
      _atlasGlobe.rafId = null;
    }
    _atlasGlobe.tween = null;
    while (_atlasGlobe.cleanupFns.length) {
      try { _atlasGlobe.cleanupFns.pop()(); } catch (_) {}
    }
    _atlasGlobe.api = null;
  }

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
    if (n === 798 && window.OC_TUVALU_FEATURE) return window.OC_TUVALU_FEATURE;
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
    stopAtlasGlobe();
    var allCards = _getCardsArray(data);
    var filtered = filterGenesisCards(allCards, _atlasState);
    var isGlobe = _atlasState.view === 'globe';

    var html = '<div style="width:100%;max-width:760px;margin:0 auto;padding:14px 14px 40px;box-sizing:border-box;color:#eef2ff;overflow-x:hidden;">';

    // Top row
    html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;width:100%;">' +
      '<button id="btn-atlas-back" style="background:none;border:none;color:var(--dim);font-size:13px;font-weight:700;padding:6px 0;cursor:pointer;flex-shrink:0;">← Back</button>' +
      '<div style="font-family:\'Space Mono\',monospace;font-size:11px;color:var(--dim);white-space:nowrap;">' + (isGlobe ? allCards.length + ' countries &amp; territories' : (filtered.length + ' / ' + allCards.length + ' entries')) + '</div>' +
      '</div>';

    // Header
    html += '<div style="margin-bottom:12px;">' +
      '<h2 style="font-family:\'Fredoka One\',sans-serif;font-size:25px;color:#fff;margin:0;line-height:1.15;">World Atlas</h2>' +
      '<div style="font-size:13px;color:var(--dim);margin-top:4px;line-height:1.4;">Explore modern borders, environments, physical features, and cultural highlights across all 200 entries.</div>' +
      '</div>';

    // View Mode Switcher (A-Z List vs Spinning Globe)
    html += '<div role="tablist" aria-label="World Atlas view mode" style="display:flex;width:100%;background:rgba(255,255,255,.05);border:1px solid var(--border);border-radius:12px;padding:3px;gap:4px;margin-bottom:12px;box-sizing:border-box;">' +
      '<button id="atlas-view-list" role="tab" aria-selected="' + (!isGlobe ? 'true' : 'false') + '" style="flex:1;min-width:0;padding:9px 10px;border-radius:9px;border:none;font-size:13px;font-weight:800;cursor:pointer;background:' + (!isGlobe ? 'var(--blue)' : 'transparent') + ';color:' + (!isGlobe ? '#fff' : 'var(--dim)') + ';">📋 A–Z List</button>' +
      '<button id="atlas-view-globe" role="tab" aria-selected="' + (isGlobe ? 'true' : 'false') + '" style="flex:1;min-width:0;padding:9px 10px;border-radius:9px;border:none;font-size:13px;font-weight:800;cursor:pointer;background:' + (isGlobe ? 'var(--blue)' : 'transparent') + ';color:' + (isGlobe ? '#fff' : 'var(--dim)') + ';">🌍 Spinning Globe</button>' +
      '</div>';

    if (!isGlobe) {
      // Search + Origin Filter row (wraps cleanly on narrow mobile screens)
      html += '<div style="display:flex;gap:8px;flex-wrap:wrap;width:100%;margin-bottom:10px;box-sizing:border-box;">' +
        '<input id="atlas-search" type="search" value="' + esc(_atlasState.search) + '" placeholder="Search country, capital, biome, landmark, or festival…" style="flex:1 1 175px;min-width:0;width:100%;padding:10px 12px;border-radius:11px;border:1px solid var(--border);background:var(--bg-panel);color:#fff;font-size:13px;box-sizing:border-box;">' +
        '<select id="atlas-origin-filter" aria-label="Filter by border origin" style="flex:1 1 140px;min-width:0;max-width:100%;padding:10px 12px;border-radius:11px;border:1px solid var(--border);background:var(--bg-panel);color:#e2e8f0;font-size:12px;font-weight:700;cursor:pointer;box-sizing:border-box;">' +
        '  <option value="all"' + (_atlasState.originType === 'all' ? ' selected' : '') + '>All Origins</option>';
      Object.keys(ORIGIN_META).forEach(function (key) {
        var meta = ORIGIN_META[key];
        html += '<option value="' + key + '"' + (_atlasState.originType === key ? ' selected' : '') + '>' + meta.icon + ' ' + esc(meta.label) + '</option>';
      });
      html += '</select></div>';
    }

    // Interactive Continent Filter / Jump Tabs
    html += '<div style="display:flex;gap:6px;overflow-x:auto;max-width:100%;padding-bottom:6px;margin-bottom:12px;scrollbar-width:none;-webkit-overflow-scrolling:touch;box-sizing:border-box;">';
    CONTINENT_META.forEach(function (c) {
      var active = _atlasState.continent === c.id;
      html += '<button class="atlas-cont-tab" data-cont="' + c.id + '" style="flex-shrink:0;padding:7px 12px;border-radius:9px;border:1px solid ' + (active ? 'var(--blue)' : 'var(--border)') + ';background:' + (active ? 'var(--blue)' : 'var(--bg-panel)') + ';color:' + (active ? '#fff' : 'var(--dim)') + ';font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;">' + esc(c.label) + '</button>';
    });
    html += '</div>';

    if (isGlobe) {
      html += '<div style="width:100%;background:var(--bg-panel);border:1px solid var(--border);border-radius:18px;padding:14px 12px 16px;box-sizing:border-box;text-align:center;">' +
        '<div style="font-size:12px;color:#a8c8e0;margin-bottom:10px;">Drag to spin · Pinch or use +/− to zoom · Tap any country to open its card</div>' +
        '<div id="atlas-globe-stage" style="position:relative;width:min(100%, 400px);aspect-ratio:1/1;margin:0 auto;touch-action:none;user-select:none;-webkit-user-select:none;cursor:grab;">' +
        '  <canvas id="atlas-globe-canvas" style="width:100%;height:100%;display:block;border-radius:50%;"></canvas>' +
        '  <div id="atlas-globe-loading" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--dim);pointer-events:none;">Loading globe…</div>' +
        '</div>' +
        '<div id="atlas-globe-readout" style="margin-top:12px;min-height:22px;font-size:13px;font-weight:700;color:#e2e8f0;">Tap any country on the globe to read its story</div>' +
        '<div style="display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;margin-top:12px;">' +
        '  <button id="atlas-zoom-out" aria-label="Zoom out" style="width:36px;height:34px;border-radius:9px;border:1px solid var(--border);background:var(--bg-deep);color:#fff;font-family:\'Space Mono\',monospace;font-size:16px;font-weight:700;cursor:pointer;">−</button>' +
        '  <span id="atlas-zoom-val" style="min-width:44px;font-family:\'Space Mono\',monospace;font-size:12px;color:#cbd5e1;">1.0×</span>' +
        '  <button id="atlas-zoom-in" aria-label="Zoom in" style="width:36px;height:34px;border-radius:9px;border:1px solid var(--border);background:var(--bg-deep);color:#fff;font-family:\'Space Mono\',monospace;font-size:16px;font-weight:700;cursor:pointer;">+</button>' +
        '  <button id="atlas-spin-toggle" style="padding:7px 12px;border-radius:9px;border:1px solid var(--border);background:var(--bg-deep);color:#cbd5e1;font-size:12px;font-weight:700;cursor:pointer;">' + (_atlasGlobe.spinning ? '⏸ Pause' : '▶ Spin') + '</button>' +
        '  <button id="atlas-globe-reset" style="padding:7px 12px;border-radius:9px;border:1px solid var(--border);background:transparent;color:var(--dim);font-size:12px;font-weight:700;cursor:pointer;">↺ Reset</button>' +
        '</div>' +
        '</div>';
    } else if (filtered.length === 0) {
      html += '<div style="text-align:center;padding:40px 16px;color:var(--dim);font-size:13px;">No countries match that filter.</div>';
    } else {
      // Country Grid (single-elevation cards with large framed flag panel filling right side)
      var NON_RECT_FLAGS = { np: true, ch: true, va: true };
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(min(280px,100%),1fr));gap:10px;width:100%;box-sizing:border-box;">';
      filtered.forEach(function (card) {
        var om = ORIGIN_META[card.originType] || { icon: '🗺️', label: 'Modern Borders' };
        var contName = CONTINENT_LABELS[card.continent] || card.continent;
        var originDisplay = card.originLabel || om.label;
        var iso2 = flagEmojiToIso2(card.flag);
        var fitContain = iso2 && NON_RECT_FLAGS[iso2];
        var flagHtml = iso2
          ? '<img class="atlas-flag-img" src="/assets/flags/' + esc(iso2) + '.svg" alt="" loading="lazy" decoding="async" data-fallback="' + esc(card.flag || '🏳️') + '" style="width:100%;height:100%;object-fit:' + (fitContain ? 'contain' : 'cover') + ';' + (fitContain ? 'padding:4px;box-sizing:border-box;' : '') + 'display:block;">'
          : '<span style="font-size:40px;line-height:1;">' + esc(card.flag || '🏳️') + '</span>';

        html += '<button class="atlas-card-btn" data-cid="' + esc(card.id) + '" style="width:100%;min-width:0;box-sizing:border-box;text-align:left;background:var(--bg-panel);border:1px solid var(--border);border-radius:14px;padding:0;cursor:pointer;color:#eef2ff;display:flex;align-items:stretch;justify-content:space-between;gap:12px;transition:border-color .15s,transform .12s;overflow:hidden;">' +
          '<div style="flex:1;min-width:0;padding:12px 0 12px 14px;display:flex;flex-direction:column;justify-content:center;gap:4px;">' +
          '  <div style="font-weight:800;font-size:15px;color:#fff;line-height:1.2;overflow-wrap:anywhere;">' + esc(card.name) + '</div>' +
          '  <div style="font-size:11px;color:var(--dim);">' + esc(contName) + ' · <span style="font-family:\'Space Mono\',monospace;color:#cbd5e1;">' + esc(card.modernYear || '') + '</span></div>' +
          '  <div style="font-size:11px;color:#93c5fd;font-weight:700;margin-top:2px;line-height:1.3;">' + om.icon + ' ' + esc(originDisplay) + '</div>' +
          '</div>' +
          '<div style="flex-shrink:0;width:112px;min-height:76px;margin:7px 7px 7px 0;border-radius:10px;overflow:hidden;border:1px solid rgba(255,255,255,0.14);background:rgba(6,13,46,0.65);display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.28);">' +
          flagHtml +
          '</div>' +
          '</button>';
      });
      html += '</div>';
    }

    html += '</div>';
    rootEl.innerHTML = html;

    // Seamless offline emoji fallback if any flag image cannot load
    rootEl.querySelectorAll('.atlas-flag-img').forEach(function (img) {
      img.addEventListener('error', function () {
        var fb = img.getAttribute('data-fallback') || '🏳️';
        var span = document.createElement('span');
        span.style.cssText = 'font-size:40px;line-height:1;';
        span.textContent = fb;
        if (img.parentNode) img.parentNode.replaceChild(span, img);
      }, { once: true });
    });

    var backBtn = rootEl.querySelector('#btn-atlas-back');
    if (backBtn) backBtn.addEventListener('click', function () {
      stopAtlasGlobe();
      if (typeof window.goBack === 'function') window.goBack();
      else if (typeof window.go === 'function') window.go('s-setup');
    });

    var listTab = rootEl.querySelector('#atlas-view-list');
    if (listTab) listTab.addEventListener('click', function () {
      if (_atlasState.view === 'list') return;
      _atlasState.view = 'list';
      paintAtlasDOM(rootEl, data);
    });

    var globeTab = rootEl.querySelector('#atlas-view-globe');
    if (globeTab) globeTab.addEventListener('click', function () {
      if (_atlasState.view === 'globe') return;
      _atlasState.view = 'globe';
      paintAtlasDOM(rootEl, data);
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
        var cont = tab.getAttribute('data-cont');
        _atlasState.continent = cont;
        if (_atlasState.view === 'globe' && _atlasGlobe.api) {
          rootEl.querySelectorAll('.atlas-cont-tab').forEach(function (b) {
            var act = b.getAttribute('data-cont') === cont;
            b.style.borderColor = act ? 'var(--blue)' : 'var(--border)';
            b.style.background = act ? 'var(--blue)' : 'var(--bg-panel)';
            b.style.color = act ? '#fff' : 'var(--dim)';
          });
          _atlasGlobe.api.flyToContinent(cont);
        } else {
          paintAtlasDOM(rootEl, data);
        }
      });
    });

    rootEl.querySelectorAll('.atlas-card-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openGenesisCard(btn.getAttribute('data-cid'));
      });
    });

    if (isGlobe) {
      mountAtlasGlobe(rootEl, data);
    }
  }

  async function mountAtlasGlobe(rootEl, data) {
    var stage = rootEl.querySelector('#atlas-globe-stage');
    var canvas = rootEl.querySelector('#atlas-globe-canvas');
    var loadingEl = rootEl.querySelector('#atlas-globe-loading');
    var readoutEl = rootEl.querySelector('#atlas-globe-readout');
    var zoomValEl = rootEl.querySelector('#atlas-zoom-val');
    var spinBtn = rootEl.querySelector('#atlas-spin-toggle');
    if (!stage || !canvas || !window.d3) {
      if (loadingEl) loadingEl.textContent = 'Globe unavailable offline.';
      return;
    }

    var allCards = _getCardsArray(data);
    var cardsByNumId = {};
    allCards.forEach(function (c) {
      if (c && c.numId != null) cardsByNumId[Number(c.numId)] = c;
    });

    var rawFeatures = await loadTopoFeatures();
    if (!document.body.contains(canvas)) return; // User switched view while loading
    if (!rawFeatures || !rawFeatures.length) {
      if (loadingEl) loadingEl.textContent = 'Could not load map geometry.';
      return;
    }
    if (loadingEl) loadingEl.style.display = 'none';

    var features = rawFeatures.slice();
    if (window.EURO_KOSOVO_FEATURE && !features.some(function (f) { return Number(f.id) === 383; })) {
      features.push(window.EURO_KOSOVO_FEATURE);
    }
    if (window.SA_FRENCH_GUIANA_FEATURE && !features.some(function (f) { return Number(f.id) === 254; })) {
      features.push(window.SA_FRENCH_GUIANA_FEATURE);
    }
    if (window.OC_TUVALU_FEATURE && !features.some(function (f) { return Number(f.id) === 798; })) {
      features.push(window.OC_TUVALU_FEATURE);
    }

    var ctx = canvas.getContext('2d');
    var graticule = window.d3.geoGraticule10();
    var cssSize = 360;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var baseRadius = 172;

    function decimateRing(ring) {
      if (!Array.isArray(ring) || ring.length <= 32) return ring;
      var step = ring.length > 180 ? 4 : (ring.length > 72 ? 3 : 2);
      var out = [];
      for (var k = 0; k < ring.length - 1; k += step) out.push(ring[k]);
      out.push(ring[ring.length - 1]);
      return out.length >= 4 ? out : ring;
    }

    function decimateFeature(feat) {
      if (!feat || !feat.geometry) return feat;
      var g = feat.geometry;
      if (g.type === 'Polygon') {
        return { type: 'Feature', id: feat.id, geometry: { type: 'Polygon', coordinates: g.coordinates.map(decimateRing) } };
      }
      if (g.type === 'MultiPolygon') {
        return {
          type: 'Feature',
          id: feat.id,
          geometry: {
            type: 'MultiPolygon',
            coordinates: g.coordinates.map(function (poly) { return poly.map(decimateRing); })
          }
        };
      }
      return feat;
    }

    var renderFeatures = features.map(decimateFeature);
    var projection = window.d3.geoOrthographic()
      .clipAngle(90)
      .precision(2.5);
    var pathGen = window.d3.geoPath(projection, ctx);

    function syncCanvasSize() {
      var rect = stage.getBoundingClientRect();
      cssSize = Math.max(220, Math.round(rect.width || 340));
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(cssSize * dpr);
      canvas.height = Math.round(cssSize * dpr);
      baseRadius = (cssSize / 2) - 6;
      projection
        .translate([cssSize / 2, cssSize / 2])
        .scale(baseRadius * _atlasGlobe.zoom)
        .rotate(_atlasGlobe.rotation);
    }

    function updateZoomLabel() {
      if (zoomValEl) zoomValEl.textContent = _atlasGlobe.zoom.toFixed(1) + '×';
    }

    function drawGlobe() {
      if (!ctx) return;
      projection
        .scale(baseRadius * _atlasGlobe.zoom)
        .rotate(_atlasGlobe.rotation);

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, cssSize, cssSize);

      var cx = cssSize / 2;
      var cy = cssSize / 2;
      var sphereR = Math.min(baseRadius * _atlasGlobe.zoom, baseRadius);

      // Clip to circular globe viewport when zoomed in
      ctx.beginPath();
      ctx.arc(cx, cy, baseRadius, 0, Math.PI * 2);
      ctx.save();
      ctx.clip();

      // Ocean fill with subtle 3D radial lighting matching MapolisGlobe
      var grad = ctx.createRadialGradient(cx - baseRadius * 0.28, cy - baseRadius * 0.28, baseRadius * 0.08, cx, cy, baseRadius);
      grad.addColorStop(0, '#234c91');
      grad.addColorStop(0.65, '#1a3a70');
      grad.addColorStop(1, '#10244a');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, sphereR, 0, Math.PI * 2);
      ctx.fill();

      // Graticule
      ctx.beginPath();
      pathGen(graticule);
      ctx.strokeStyle = 'rgba(255,255,255,0.09)';
      ctx.lineWidth = 0.55;
      ctx.stroke();

      // Countries — batch standard countries into 1 fill+stroke pass (100x faster on mobile)
      var borderWidth = Math.max(0.45, Math.min(1.1, 0.65 * Math.sqrt(_atlasGlobe.zoom)));
      var hoveredFeat = null;
      var selectedFeat = null;

      ctx.beginPath();
      for (var i = 0; i < renderFeatures.length; i++) {
        var feat = renderFeatures[i];
        var numId = Number(feat.id);
        if (_atlasGlobe.selectedNumId === numId) { selectedFeat = feat; continue; }
        if (_atlasGlobe.hoveredNumId === numId && cardsByNumId[numId]) { hoveredFeat = feat; continue; }
        pathGen(feat);
      }
      ctx.fillStyle = 'rgba(100,190,80,0.78)';
      ctx.strokeStyle = 'rgba(195,248,180,0.58)';
      ctx.lineWidth = borderWidth;
      ctx.fill();
      ctx.stroke();

      if (hoveredFeat) {
        ctx.beginPath();
        pathGen(hoveredFeat);
        ctx.fillStyle = 'rgba(255,225,53,0.52)';
        ctx.strokeStyle = '#ffe135';
        ctx.lineWidth = 1.2;
        ctx.fill();
        ctx.stroke();
      }
      if (selectedFeat) {
        ctx.beginPath();
        pathGen(selectedFeat);
        ctx.fillStyle = '#ffe135';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.4;
        ctx.fill();
        ctx.stroke();
      }

      ctx.restore(); // end clip

      // Subtle atmospheric rim stroke
      ctx.beginPath();
      ctx.arc(cx, cy, baseRadius, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(142,218,118,0.48)';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      ctx.restore();
    }

    function setZoom(nextZoom) {
      _atlasGlobe.zoom = Math.max(1.0, Math.min(4.5, nextZoom));
      updateZoomLabel();
      drawGlobe();
    }

    function flyToContinent(contId) {
      var target = ATLAS_GLOBE_TARGETS[contId] || ATLAS_GLOBE_TARGETS.all;
      _atlasGlobe.suspendedUntil = performance.now() + 4500;
      _atlasGlobe.tween = {
        startTime: performance.now(),
        duration: 550,
        fromRot: _atlasGlobe.rotation.slice(),
        toRot: target.rotate.slice(),
        fromZoom: _atlasGlobe.zoom,
        toZoom: target.zoom
      };
      ensureTick();
    }

    function hitTestClientPoint(clientX, clientY) {
      var rect = canvas.getBoundingClientRect();
      var px = clientX - rect.left;
      var py = clientY - rect.top;
      var dx = px - cssSize / 2;
      var dy = py - cssSize / 2;
      if (dx * dx + dy * dy > baseRadius * baseRadius) return null;
      var lonLat = projection.invert([px, py]);
      if (!lonLat || !Number.isFinite(lonLat[0]) || !Number.isFinite(lonLat[1])) return null;
      var fallbackDeg = Math.max(1.0, 3.0 / _atlasGlobe.zoom);
      return findAtlasCountryAtLonLat(
        lonLat,
        features,
        cardsByNumId,
        window.d3.geoContains,
        window.d3.geoCentroid,
        window.d3.geoArea,
        fallbackDeg
      );
    }

    // Drag, pinch-zoom, wheel-zoom, hover & tap handlers
    var isDragging = false;
    var hasMoved = false;
    var downX = 0, downY = 0;
    var startRot = [0, 0, 0];
    var pinchStartDist = 0;
    var pinchStartZoom = 1;

    function onMouseDown(e) {
      if (e.button !== 0) return;
      isDragging = true;
      hasMoved = false;
      downX = e.clientX;
      downY = e.clientY;
      startRot = _atlasGlobe.rotation.slice();
      _atlasGlobe.tween = null;
      stage.style.cursor = 'grabbing';
    }

    function onMouseMove(e) {
      if (isDragging) {
        var dx = e.clientX - downX;
        var dy = e.clientY - downY;
        if (Math.abs(dx) + Math.abs(dy) > 5) hasMoved = true;
        if (!hasMoved) return;
        var sens = 0.38 / _atlasGlobe.zoom;
        _atlasGlobe.rotation = [
          startRot[0] + dx * sens,
          Math.max(-85, Math.min(85, startRot[1] - dy * sens)),
          0
        ];
        _atlasGlobe.suspendedUntil = performance.now() + 3500;
        drawGlobe();
        return;
      }
      // Subtle hover preview when pointer is over the canvas
      if (e.target === canvas) {
        var hit = hitTestClientPoint(e.clientX, e.clientY);
        var nextHover = hit ? Number(hit.feature.id) : null;
        if (nextHover !== _atlasGlobe.hoveredNumId) {
          _atlasGlobe.hoveredNumId = nextHover;
          if (readoutEl) {
            readoutEl.textContent = hit
              ? ((hit.card.flag || '') + ' ' + hit.card.name + ' · Tap to open Genesis Card')
              : 'Tap any country on the globe to read its story';
          }
          drawGlobe();
        }
      }
    }

    function handleTapAt(clientX, clientY) {
      var hit = hitTestClientPoint(clientX, clientY);
      if (!hit || !hit.card) {
        if (readoutEl) readoutEl.textContent = 'Ocean — try zooming in (+) or tapping a landmass';
        return;
      }
      _atlasGlobe.selectedNumId = Number(hit.feature.id);
      _atlasGlobe.suspendedUntil = performance.now() + 5000;
      if (readoutEl) {
        readoutEl.textContent = (hit.card.flag || '') + ' ' + hit.card.name + ' (' + (hit.card.modernYear || '') + ')';
      }
      drawGlobe();
      if (typeof window.AudioMgr !== 'undefined' && window.AudioMgr.slideIn) {
        try { window.AudioMgr.slideIn(); } catch (_) {}
      }
      openGenesisCard(hit.card.id);
    }

    function onMouseUp(e) {
      if (!isDragging) return;
      isDragging = false;
      stage.style.cursor = 'grab';
      _atlasGlobe.suspendedUntil = performance.now() + 3500;
      if (!hasMoved) {
        handleTapAt(downX, downY);
      }
    }

    function touchDist(touches) {
      var dx = touches[0].clientX - touches[1].clientX;
      var dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }

    function onTouchStart(e) {
      if (e.cancelable) e.preventDefault();
      _atlasGlobe.tween = null;
      if (e.touches.length >= 2) {
        isDragging = false;
        hasMoved = true;
        pinchStartDist = touchDist(e.touches);
        pinchStartZoom = _atlasGlobe.zoom;
        return;
      }
      if (e.touches.length === 1) {
        isDragging = true;
        hasMoved = false;
        downX = e.touches[0].clientX;
        downY = e.touches[0].clientY;
        startRot = _atlasGlobe.rotation.slice();
      }
    }

    function onTouchMove(e) {
      if (e.touches.length >= 2 && pinchStartDist > 0) {
        if (e.cancelable) e.preventDefault();
        var ratio = touchDist(e.touches) / pinchStartDist;
        _atlasGlobe.suspendedUntil = performance.now() + 4000;
        setZoom(pinchStartZoom * ratio);
        return;
      }
      if (!isDragging || e.touches.length !== 1) return;
      if (e.cancelable) e.preventDefault();
      var dx = e.touches[0].clientX - downX;
      var dy = e.touches[0].clientY - downY;
      if (Math.abs(dx) + Math.abs(dy) > 7) hasMoved = true;
      if (!hasMoved) return;
      var sens = 0.42 / _atlasGlobe.zoom;
      _atlasGlobe.rotation = [
        startRot[0] + dx * sens,
        Math.max(-85, Math.min(85, startRot[1] - dy * sens)),
        0
      ];
      _atlasGlobe.suspendedUntil = performance.now() + 3500;
      drawGlobe();
    }

    function onTouchEnd(e) {
      if (e.touches.length < 2) pinchStartDist = 0;
      if (!isDragging) return;
      if (e.touches.length === 0) {
        isDragging = false;
        _atlasGlobe.suspendedUntil = performance.now() + 3500;
        if (!hasMoved) {
          handleTapAt(downX, downY);
        }
      }
    }

    function onWheel(e) {
      e.preventDefault();
      var delta = e.deltaY < 0 ? 0.25 : -0.25;
      _atlasGlobe.suspendedUntil = performance.now() + 3500;
      setZoom(_atlasGlobe.zoom + delta);
    }

    function onResize() {
      syncCanvasSize();
      drawGlobe();
    }

    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd, { passive: false });
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('resize', onResize);

    _atlasGlobe.cleanupFns.push(function () {
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', onResize);
    });

    // Control buttons
    var zoomInBtn = rootEl.querySelector('#atlas-zoom-in');
    var zoomOutBtn = rootEl.querySelector('#atlas-zoom-out');
    var resetBtn = rootEl.querySelector('#atlas-globe-reset');
    if (zoomInBtn) zoomInBtn.addEventListener('click', function () { setZoom(_atlasGlobe.zoom + 0.5); });
    if (zoomOutBtn) zoomOutBtn.addEventListener('click', function () { setZoom(_atlasGlobe.zoom - 0.5); });
    if (spinBtn) spinBtn.addEventListener('click', function () {
      _atlasGlobe.spinning = !_atlasGlobe.spinning;
      _atlasGlobe.suspendedUntil = 0;
      spinBtn.textContent = _atlasGlobe.spinning ? '⏸ Pause' : '▶ Spin';
      if (_atlasGlobe.spinning) {
        ensureTick();
      } else if (!_atlasGlobe.tween && _atlasGlobe.rafId) {
        cancelAnimationFrame(_atlasGlobe.rafId);
        _atlasGlobe.rafId = null;
      }
    });
    if (resetBtn) resetBtn.addEventListener('click', function () {
      _atlasState.continent = 'all';
      _atlasGlobe.selectedNumId = null;
      _atlasGlobe.spinning = true;
      if (spinBtn) spinBtn.textContent = '⏸ Pause';
      flyToContinent('all');
      rootEl.querySelectorAll('.atlas-cont-tab').forEach(function (b) {
        var act = b.getAttribute('data-cont') === 'all';
        b.style.borderColor = act ? 'var(--blue)' : 'var(--border)';
        b.style.background = act ? 'var(--blue)' : 'var(--bg-panel)';
        b.style.color = act ? '#fff' : 'var(--dim)';
      });
      if (readoutEl) readoutEl.textContent = 'Tap any country on the globe to read its story';
    });

    _atlasGlobe.api = {
      flyToContinent: flyToContinent,
      setZoom: setZoom,
      selectPoint: handleTapAt
    };

    var lastSpinDraw = 0;
    function ensureTick() {
      if (_atlasGlobe.rafId) return;
      _atlasGlobe.lastFrame = performance.now();
      _atlasGlobe.rafId = requestAnimationFrame(tick);
    }

    function tick(now) {
      if (!document.body.contains(canvas)) {
        stopAtlasGlobe();
        return;
      }
      var dt = Math.min(now - _atlasGlobe.lastFrame, 50);
      _atlasGlobe.lastFrame = now;
      var needsDraw = false;

      if (_atlasGlobe.tween) {
        var tw = _atlasGlobe.tween;
        var t = Math.min(1, (now - tw.startTime) / tw.duration);
        var ease = 1 - Math.pow(1 - t, 3);
        _atlasGlobe.rotation = [
          tw.fromRot[0] + (tw.toRot[0] - tw.fromRot[0]) * ease,
          tw.fromRot[1] + (tw.toRot[1] - tw.fromRot[1]) * ease,
          0
        ];
        _atlasGlobe.zoom = tw.fromZoom + (tw.toZoom - tw.fromZoom) * ease;
        updateZoomLabel();
        if (t >= 1) _atlasGlobe.tween = null;
        needsDraw = true;
      } else if (_atlasGlobe.spinning && !isDragging && now > _atlasGlobe.suspendedUntil && !document.getElementById('mapolis-genesis-card-modal')) {
        if (now - lastSpinDraw >= 32) {
          var stepDt = Math.min(now - lastSpinDraw, 80);
          lastSpinDraw = now;
          var speed = 0.014 / Math.sqrt(_atlasGlobe.zoom);
          _atlasGlobe.rotation[0] = ((_atlasGlobe.rotation[0] + stepDt * speed + 540) % 360) - 180;
          needsDraw = true;
        }
      }

      if (needsDraw) drawGlobe();

      if (_atlasGlobe.tween || _atlasGlobe.spinning) {
        _atlasGlobe.rafId = requestAnimationFrame(tick);
      } else {
        _atlasGlobe.rafId = null;
      }
    }

    syncCanvasSize();
    updateZoomLabel();
    if (_atlasState.continent && _atlasState.continent !== 'all') {
      flyToContinent(_atlasState.continent);
    }
    drawGlobe();
    if (_atlasGlobe.spinning || _atlasGlobe.tween) {
      ensureTick();
    }
  }

  var _cachedGameAssetIndex = null;
  function getLiveGameAssetIndex() {
    if (_cachedGameAssetIndex && _cachedGameAssetIndex.loadedCount > 0) return _cachedGameAssetIndex;
    _cachedGameAssetIndex = buildGameAssetIndex(window);
    return _cachedGameAssetIndex;
  }

  function renderFeatureRowHtml(label, items) {
    if (!items || !items.length) return '';
    var joined = items.map(function (it) { return esc(it.name); }).join(' <span style="color:rgba(148,163,184,0.45);margin:0 4px;">·</span> ');
    return '<div style="display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 12px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.06);">' +
      '<div style="width:124px;flex-shrink:0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#94a3b8;">' + esc(label) + '</div>' +
      '<div style="flex:1;min-width:170px;font-size:13.5px;line-height:1.5;color:#eef2ff;">' + joined + '</div>' +
      '</div>';
  }

  async function openGenesisCard(countryIdOrName) {
    var data = await loadGenesisData();
    if (!data) {
      toast('Could not load country dossier right now', 2000);
      return;
    }
    var card = resolveGenesisCard(data, countryIdOrName);
    if (!card) {
      toast('Country dossier not available for that entry', 1800);
      return;
    }

    var om = ORIGIN_META[card.originType] || { icon: '🗺️', label: 'Modern Borders' };
    var contName = CONTINENT_LABELS[card.continent] || card.continent;
    var originDisplay = card.originLabel || om.label;
    var resolved = resolveCardAssets(card, getLiveGameAssetIndex());

    var modalIso2 = flagEmojiToIso2(card.flag);
    var modalFitContain = modalIso2 && (modalIso2 === 'np' || modalIso2 === 'ch' || modalIso2 === 'va');
    var modalFlagHtml = modalIso2
      ? '<div style="width:54px;height:38px;border-radius:8px;overflow:hidden;border:1px solid rgba(255,255,255,0.16);background:rgba(6,13,46,0.7);display:flex;align-items:center;justify-content:center;flex-shrink:0;">' +
        '<img class="gc-modal-flag" src="/assets/flags/' + esc(modalIso2) + '.svg" alt="" data-fallback="' + esc(card.flag || '🏳️') + '" style="width:100%;height:100%;object-fit:' + (modalFitContain ? 'contain' : 'cover') + ';' + (modalFitContain ? 'padding:2px;box-sizing:border-box;' : '') + 'display:block;">' +
        '</div>'
      : '<span style="font-size:34px;line-height:1;">' + esc(card.flag || '🏳️') + '</span>';

    var hasCultureSection = (resolved.triviaItems.length + resolved.heritageSites.length + resolved.cities.length + resolved.languages.length) > 0;

    // ── Header + Lightweight Inline Jump Bar ──
    var html = '' +
      '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px;">' +
      '  <div style="display:flex;align-items:center;gap:12px;min-width:0;">' +
      '    ' + modalFlagHtml +
      '    <div style="min-width:0;">' +
      '      <h3 style="font-family:\'Fredoka One\',sans-serif;font-size:24px;color:#fff;margin:0;line-height:1.15;overflow-wrap:anywhere;">' + esc(card.name) + '</h3>' +
      '      <div style="font-size:12px;color:#a5b4cf;margin-top:4px;line-height:1.4;">' +
               esc(contName) +
               (card.capital ? ' · Capital: <span style="color:#e2e8f0;font-weight:600;">' + esc(card.capital) + '</span>' : '') +
               ' · Modern Borders: <span style="font-family:\'Space Mono\',monospace;color:#e2e8f0;">' + esc(card.modernYear || '') + '</span>' +
      '      </div>' +
      '    </div>' +
      '  </div>' +
      '  <button id="gc-close" aria-label="Close" style="background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);color:#cbd5e1;width:32px;height:32px;border-radius:10px;cursor:pointer;font-size:16px;flex-shrink:0;">✕</button>' +
      '</div>' +

      // Lightweight inline section jump bar (unboxed typographic navigation, hairline bottom border)
      '<nav aria-label="Country dossier sections" style="display:flex;align-items:center;gap:8px 16px;flex-wrap:wrap;padding:0 0 10px;margin-bottom:16px;border-bottom:1px solid rgba(255,255,255,0.1);font-size:12px;">' +
      '  <button type="button" class="gc-jump-btn" data-target="gc-sec-borders" style="background:none;border:none;padding:2px 0;color:#93c5fd;font-size:12px;font-weight:700;cursor:pointer;letter-spacing:.02em;white-space:nowrap;"><span style="font-family:\'Space Mono\',monospace;opacity:.75;margin-right:4px;">01</span>Borders</button>' +
      '  <button type="button" class="gc-jump-btn" data-target="gc-sec-environment" style="background:none;border:none;padding:2px 0;color:#94a3b8;font-size:12px;font-weight:700;cursor:pointer;letter-spacing:.02em;white-space:nowrap;"><span style="font-family:\'Space Mono\',monospace;opacity:.75;margin-right:4px;">02</span>Environment</button>' +
      (hasCultureSection
        ? '  <button type="button" class="gc-jump-btn" data-target="gc-sec-culture" style="background:none;border:none;padding:2px 0;color:#94a3b8;font-size:12px;font-weight:700;cursor:pointer;letter-spacing:.02em;white-space:nowrap;"><span style="font-family:\'Space Mono\',monospace;opacity:.75;margin-right:4px;">03</span>Culture</button>'
        : '') +
      '</nav>';

    // ── Section 1: Genesis of Modern Borders ──
    html += '<section id="gc-sec-borders" style="scroll-margin-top:12px;">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;">' +
      '  <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.11em;color:#93c5fd;">🗺️ 01 · Genesis of Modern Borders</div>' +
      '</div>' +

      // Live D3 TopoJSON Silhouette Frame
      '<div id="gc-silhouette" style="background:rgba(6,13,46,0.7);border:1px solid rgba(91,143,255,0.2);border-radius:14px;padding:8px;margin-bottom:14px;min-height:148px;display:flex;align-items:center;justify-content:center;">' +
      '  <div style="font-size:11px;color:var(--dim);">Drawing borders…</div>' +
      '</div>' +

      // Unboxed Origin Category (icon + label, never hue-only)
      '<div style="font-size:12px;font-weight:800;color:#93c5fd;letter-spacing:.03em;margin-bottom:8px;">' +
      om.icon + ' ' + esc(originDisplay) +
      '</div>' +

      // Main border prose
      '<p style="font-size:14px;line-height:1.65;color:#e2e8f0;margin:0 0 14px;">' + esc(card.story || '') + '</p>';

    // Hairline-bordered Key Turning Point inset (no thick colored left bar)
    if (card.turningPoint) {
      var tpText = (typeof card.turningPoint === 'string')
        ? card.turningPoint
        : ((card.turningPoint.year ? card.turningPoint.year + ' · ' : '') + (card.turningPoint.title || '') + (card.turningPoint.detail ? ' — ' + card.turningPoint.detail : ''));
      html += '<div style="background:rgba(255,255,255,0.035);border:1px solid rgba(91,143,255,0.22);border-radius:12px;padding:11px 14px;margin-bottom:12px;">' +
        '<div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px;">Key Turning Point</div>' +
        '<div style="font-size:13px;font-weight:800;color:#ffe135;line-height:1.45;">' + esc(tpText) + '</div>' +
        '</div>';
    }

    // Optional calm Contested Borders note
    if (card.contestedNote) {
      html += '<div style="background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:10px 13px;margin-bottom:4px;font-size:12.5px;line-height:1.55;color:#cbd5e1;">' +
        '<strong style="color:#fde68a;">Border Note:</strong> ' + esc(card.contestedNote) +
        '</div>';
    }
    html += '</section>';

    // ── Section 2: Environment & Physical Features ──
    html += '<section id="gc-sec-environment" style="margin-top:20px;padding-top:18px;border-top:1px solid rgba(255,255,255,0.1);scroll-margin-top:12px;">' +
      '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.11em;color:#6ee7b7;margin-bottom:8px;">🌿 02 · Environment &amp; Physical Features</div>';

    if (resolved.biomeLabel) {
      html += '<div style="font-size:15.5px;font-weight:800;color:#ffffff;line-height:1.3;margin-bottom:5px;">' + esc(resolved.biomeLabel) + '</div>';
    }
    if (resolved.summary) {
      html += '<p style="font-size:14px;line-height:1.62;color:#cbd5e1;margin:0 0 12px;">' + esc(resolved.summary) + '</p>';
    }

    // Strictly game-linked Land & Water features (structured unboxed rows, zero pills)
    var physRowsHtml = '';
    physRowsHtml += renderFeatureRowHtml('Mountains', resolved.landByGroup.mountain);
    physRowsHtml += renderFeatureRowHtml('Peninsulas', resolved.landByGroup.peninsula);
    physRowsHtml += renderFeatureRowHtml('Islands', resolved.landByGroup.island);
    physRowsHtml += renderFeatureRowHtml('Archipelagos', resolved.landByGroup.archipelago);
    physRowsHtml += renderFeatureRowHtml('Rivers', resolved.rivers);
    physRowsHtml += renderFeatureRowHtml('Lakes', resolved.lakes);
    physRowsHtml += renderFeatureRowHtml('Seas & Waters', resolved.seasAndStraits);

    if (physRowsHtml) {
      html += '<div style="border-top:1px solid rgba(255,255,255,0.08);margin-top:6px;">' + physRowsHtml + '</div>';
    }

    // Native Wildlife from Mapolis Animal Preserve (self-hosted local WebP icons)
    if (resolved.animals.length > 0) {
      html += '<div style="margin-top:14px;">' +
        '<div style="font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.09em;color:#94a3b8;margin-bottom:8px;">Native Wildlife · Animal Preserve</div>' +
        '<div style="display:flex;flex-direction:column;">';
      resolved.animals.forEach(function (animal, idxA) {
        var borderStyle = idxA > 0 ? 'border-top:1px solid rgba(255,255,255,0.06);' : '';
        html += '<div style="display:flex;align-items:center;gap:11px;padding:7px 0;' + borderStyle + '">' +
          '<img class="gc-animal-icon" src="/assets/badges/' + esc(animal.cp) + '.webp" alt="' + esc(animal.name) + '" loading="lazy" width="34" height="34" style="width:34px;height:34px;object-fit:contain;flex-shrink:0;">' +
          '<div style="min-width:0;flex:1;">' +
          '  <div style="font-size:13.5px;font-weight:800;color:#fff;line-height:1.25;">' + esc(animal.name) + '</div>' +
          (animal.desc ? '  <div style="font-size:12px;color:#cbd5e1;line-height:1.4;margin-top:2px;">' + esc(animal.desc) + '</div>' : '') +
          '</div>' +
          '</div>';
      });
      html += '</div></div>';
    }
    html += '</section>';

    // ── Section 3: Culture, Landmarks & Festivals ──
    if (hasCultureSection) {
      html += '<section id="gc-sec-culture" style="margin-top:20px;padding-top:18px;border-top:1px solid rgba(255,255,255,0.1);scroll-margin-top:12px;">' +
        '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.11em;color:#fcd34d;margin-bottom:10px;">🏛️ 03 · Culture, Landmarks &amp; Festivals</div>';

      if (resolved.triviaItems.length > 0) {
        html += '<div style="display:flex;flex-direction:column;margin-bottom:10px;">';
        resolved.triviaItems.forEach(function (ti, idxT) {
          var km = TRIVIA_KIND_META[ti.kind] || TRIVIA_KIND_META.culture;
          var borderTop = idxT > 0 ? 'border-top:1px solid rgba(255,255,255,0.06);' : '';
          html += '<div style="padding:8px 0;' + borderTop + '">' +
            '<div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.09em;color:' + km.color + ';margin-bottom:3px;">' + esc(km.label) + '</div>' +
            '<div style="font-size:13.5px;line-height:1.58;color:#eef2ff;">' + esc(ti.fact) + '</div>' +
            '</div>';
        });
        html += '</div>';
      }

      var culRowsHtml = '';
      culRowsHtml += renderFeatureRowHtml('UNESCO Heritage', resolved.heritageSites);
      culRowsHtml += renderFeatureRowHtml('Notable Cities', resolved.cities);
      if (resolved.languages.length > 0) {
        var langHtml = resolved.languages.map(function (l) {
          return esc(l.name) + (l.clue ? ' <span style="color:#94a3b8;font-size:12px;">(' + esc(l.clue) + ')</span>' : '');
        }).join(' <span style="color:rgba(148,163,184,0.45);margin:0 4px;">·</span> ');
        culRowsHtml += '<div style="display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 12px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.06);">' +
          '<div style="width:124px;flex-shrink:0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#94a3b8;">Languages</div>' +
          '<div style="flex:1;min-width:170px;font-size:13.5px;line-height:1.5;color:#eef2ff;">' + langHtml + '</div>' +
          '</div>';
      }

      if (culRowsHtml) {
        html += '<div style="border-top:1px solid rgba(255,255,255,0.08);">' + culRowsHtml + '</div>';
      }
      html += '</section>';
    }

    // Quiet footer link to Lines on a Map (s-solidarity)
    html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:18px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.08);font-size:12px;">' +
      '<button id="gc-lines-link" style="background:none;border:none;color:#93c5fd;font-size:12px;font-weight:700;cursor:pointer;padding:0;text-align:left;">Learn why borders matter → Lines on a Map</button>' +
      '<button id="gc-done" style="padding:7px 14px;border-radius:9px;border:1px solid var(--border);background:rgba(255,255,255,.06);color:#fff;font-size:12px;font-weight:700;cursor:pointer;">Done</button>' +
      '</div>';

    var m = createOverlayModal('mapolis-genesis-card-modal', html, { maxWidth: '620px' });
    m.sheet.style.scrollBehavior = 'smooth';

    var modalFlagImg = m.sheet.querySelector('.gc-modal-flag');
    if (modalFlagImg) {
      modalFlagImg.addEventListener('error', function () {
        var fb = modalFlagImg.getAttribute('data-fallback') || '🏳️';
        var span = document.createElement('span');
        span.style.cssText = 'font-size:30px;line-height:1;';
        span.textContent = fb;
        if (modalFlagImg.parentNode) modalFlagImg.parentNode.replaceChild(span, modalFlagImg);
      }, { once: true });
    }

    // Graceful fallback if any animal badge image fails offline
    m.sheet.querySelectorAll('.gc-animal-icon').forEach(function (img) {
      img.addEventListener('error', function () {
        img.style.display = 'none';
      }, { once: true });
    });

    // Smooth inline section jump links inside the dossier sheet
    var jumpBtns = m.sheet.querySelectorAll('.gc-jump-btn');
    jumpBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var targetId = btn.getAttribute('data-target');
        var sec = targetId ? m.sheet.querySelector('#' + targetId) : null;
        if (sec) {
          sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
          jumpBtns.forEach(function (b) {
            b.style.color = (b === btn) ? '#93c5fd' : '#94a3b8';
          });
        }
      });
    });

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
    TRIVIA_KIND_META: TRIVIA_KIND_META,
    normalizeFriendQuery: normalizeFriendQuery,
    normalizeRoomCodeInput: normalizeRoomCodeInput,
    formatRoomCodeDisplay: formatRoomCodeDisplay,
    createActionTokenRegistry: createActionTokenRegistry,
    buildGameAssetIndex: buildGameAssetIndex,
    resolveCardAssets: resolveCardAssets,
    resolveGenesisCard: resolveGenesisCard,
    filterGenesisCards: filterGenesisCards,
    openH2HModePicker: openH2HModePicker,
    renderFriendsScreen: renderFriendsScreen,
    openPublicPlayerCard: openPublicPlayerCard,
    showIncomingChallengeBanner: showIncomingChallengeBanner,
    showIncomingFriendRequestBanner: showIncomingFriendRequestBanner,
    dismissChallengeBanner: dismissChallengeBanner,
    dismissFriendRequestBanner: dismissFriendRequestBanner,
    pollIncomingSocialActivity: pollIncomingSocialActivity,
    startIncomingChallengePoller: startIncomingChallengePoller,
    renderAtlasScreen: renderAtlasScreen,
    stopAtlasGlobe: stopAtlasGlobe,
    openGenesisCard: openGenesisCard,
    loadGenesisData: loadGenesisData,
    findAtlasCountryAtLonLat: findAtlasCountryAtLonLat,
    flagEmojiToIso2: flagEmojiToIso2
  };

  window.openH2HModePicker = openH2HModePicker;
  window.renderFriendsScreen = renderFriendsScreen;
  window.openPublicPlayerCard = openPublicPlayerCard;
  window.renderAtlasScreen = renderAtlasScreen;
  window.stopAtlasGlobe = stopAtlasGlobe;
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

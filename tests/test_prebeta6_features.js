'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const prebeta6 = require('../assets/features-prebeta6.js');
const shared = require('../assets/shared.js');

function loadMapDataCountries() {
  const code = fs.readFileSync(path.join(__dirname, '..', 'map-data.js'), 'utf8');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(code + '\nthis.__out = { EURO_COUNTRIES, AFRICA_COUNTRIES, ASIA_COUNTRIES, NA_COUNTRIES, SA_COUNTRIES, OC_COUNTRIES };', ctx);
  const all = [];
  for (const [group, mapObj] of Object.entries(ctx.__out)) {
    for (const [numId, info] of Object.entries(mapObj)) {
      all.push({ group, numId: Number(numId), ...info });
    }
  }
  return all;
}

test('genesis-cards.json covers all 200 unique countries/territories in map-data.js with flags', () => {
  const dataset = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'genesis-cards.json'), 'utf8'));
  const mapEntries = loadMapDataCountries();

  assert.ok(Array.isArray(dataset.cards), 'dataset.cards should be an array');
  assert.equal(dataset.cards.length, 200, 'Expected 200 unique country genesis cards');
  assert.equal(dataset.aliases.turkey_eu, 'turkey', 'Expected turkey_eu alias to resolve to turkey');

  const validOrigins = new Set(Object.keys(prebeta6.ORIGIN_META));
  const missing = [];
  for (const entry of mapEntries) {
    const card = prebeta6.resolveGenesisCard(dataset, entry.id);
    if (!card) missing.push(entry.id);
  }
  assert.deepEqual(missing, [], 'Missing genesis cards for map-data entries: ' + missing.join(', '));

  let priorityCount = 0;
  for (const card of dataset.cards) {
    assert.ok(card.id && card.id.length > 0, 'Missing id');
    assert.ok(Number.isInteger(card.numId), `numId must be integer for ${card.id}`);
    assert.ok(card.name && card.name.length > 0, `Missing name for ${card.id}`);
    assert.ok(card.flag && card.flag.length > 0, `Missing flag for ${card.id}`);
    assert.ok(validOrigins.has(card.originType), `Invalid originType ${card.originType} for ${card.id}`);
    assert.ok(card.story && card.story.length >= 60, `Story too short for ${card.id}`);
    assert.ok(card.turningPoint && card.turningPoint.length >= 4, `Missing turningPoint for ${card.id}`);
    assert.ok(card.modernYear && card.modernYear.length >= 3, `Missing modernYear for ${card.id}`);
    assert.ok(card.reviewStatus === 'draft' || card.reviewStatus === 'approved', `Invalid reviewStatus for ${card.id}`);
    if (card.sensitivity === 'priority_review') priorityCount++;
  }
  assert.ok(priorityCount >= 20, 'Expected at least 20 sensitive regions flagged for priority editorial review');
});

test('normalizeFriendQuery enforces exact handle or MAP-XXXX code and rejects wildcards', () => {
  assert.deepEqual(prebeta6.normalizeFriendQuery(''), { ok: false, query: '', kind: 'empty' });
  assert.deepEqual(prebeta6.normalizeFriendQuery('a'), { ok: false, query: 'a', kind: 'length_invalid' });
  assert.deepEqual(prebeta6.normalizeFriendQuery('geo%'), { ok: false, query: '', kind: 'wildcard_disallowed' });
  assert.deepEqual(prebeta6.normalizeFriendQuery('*atlas*'), { ok: false, query: '', kind: 'wildcard_disallowed' });

  const h = prebeta6.normalizeFriendQuery('  @GeoMaster  ');
  assert.deepEqual(h, { ok: true, query: 'GeoMaster', kind: 'handle' });

  const c1 = prebeta6.normalizeFriendQuery('map-7k2p');
  assert.deepEqual(c1, { ok: true, query: 'MAP-7K2P', kind: 'friend_code' });

  const c2 = prebeta6.normalizeFriendQuery('map7k2p');
  assert.deepEqual(c2, { ok: true, query: 'MAP-7K2P', kind: 'friend_code' });
});

test('room code normalization and display formatting', () => {
  assert.equal(prebeta6.normalizeRoomCodeInput('k7m-2p9'), 'K7M2P9');
  assert.equal(prebeta6.normalizeRoomCodeInput('  ab cd 12 99 '), 'ABCD12');
  assert.equal(prebeta6.formatRoomCodeDisplay('k7m2p9'), 'K7M-2P9');
});

test('resolveGenesisCard resolves direct keys, aliases, ISO IDs, mistake prefixes, and names', () => {
  const dataset = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'genesis-cards.json'), 'utf8'));

  assert.equal(prebeta6.resolveGenesisCard(dataset, 'nepal').name, 'Nepal');
  assert.equal(prebeta6.resolveGenesisCard(dataset, 'turkey_eu').id, 'turkey');
  assert.equal(prebeta6.resolveGenesisCard(dataset, 524).id, 'nepal');
  assert.equal(prebeta6.resolveGenesisCard(dataset, 'country_france').id, 'france');
  assert.equal(prebeta6.resolveGenesisCard(dataset, 'capital_tokyo').id, 'japan');
  assert.equal(prebeta6.resolveGenesisCard(dataset, 'flag_brazil').id, 'brazil');
  assert.equal(prebeta6.resolveGenesisCard(dataset, 'South Sudan').id, 'south_sudan');
});

test('filterGenesisCards filters accurately by continent, originType, and search', () => {
  const dataset = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'genesis-cards.json'), 'utf8'));
  const all = dataset.cards;

  const sa = prebeta6.filterGenesisCards(all, { continent: 'south-america' });
  assert.ok(sa.length >= 12 && sa.every(c => c.continent === 'south-america'));

  const nepalSearch = prebeta6.filterGenesisCards(all, { search: 'kathmandu' });
  assert.equal(nepalSearch.length, 1);
  assert.equal(nepalSearch[0].id, 'nepal');

  const unifEurope = prebeta6.filterGenesisCards(all, { continent: 'europe', originType: 'unification' });
  assert.ok(unifEurope.some(c => c.id === 'germany'));
  assert.ok(unifEurope.some(c => c.id === 'italy'));
});

test('friendStore exposes all required compliance-safe RPC methods', () => {
  const expectedMethods = [
    'getMyCode', 'rotateCode', 'setPrivacy', 'lookupPlayer', 'getPlayerCard',
    'requestFriend', 'respondFriend', 'listFriends',
    'createRoom', 'joinRoom', 'pollRoom', 'cancelRoom',
    'listIncomingChallenges', 'respondChallenge'
  ];
  assert.ok(shared.friendStore, 'friendStore must be exported from assets/shared.js');
  for (const m of expectedMethods) {
    assert.equal(typeof shared.friendStore[m], 'function', `friendStore.${m} must be a function`);
  }
});

test('Israel Genesis Card covers Zionism, diverse Jewish viewpoints, the Nakba, West Bank settlements, settler violence, apartheid, indirect/regional deaths, ethnic cleansing, genocide, and Jerusalem Day Flag March', () => {
  const genesisData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'genesis-cards.json'), 'utf8'));
  const israel = prebeta6.resolveGenesisCard(genesisData, 'israel');
  assert.ok(israel, 'Israel card must exist');
  const combined = `${israel.turningPoint} ${israel.story} ${israel.contestedNote}`.toLowerCase();
  assert.ok(combined.includes('zionism'), 'Israel card must mention Zionism');
  assert.ok(combined.includes('europe') && combined.includes('united states'), 'Israel card must connect Zionism to Europe and the United States');
  assert.ok(combined.includes('opposing viewpoints') && combined.includes('jewish communities'), 'Israel card must note opposing viewpoints in Jewish communities worldwide');
  assert.ok(combined.includes('nakba'), 'Israel card must mention the Nakba');
  assert.ok(combined.includes('west bank') && combined.includes('settlement'), 'Israel card must mention West Bank settlements');
  assert.ok(combined.includes('settler violence') && combined.includes('5,300'), 'Israel card must include settler violence estimates');
  assert.ok(combined.includes('apartheid'), 'Israel card must mention apartheid findings');
  assert.ok(combined.includes('indirect deaths'), 'Israel card must mention indirect deaths');
  assert.ok(combined.includes('outside israel'), 'Israel card must include deaths outside Israel borders');
  assert.ok(combined.includes('ethnic cleansing'), 'Israel card must mention continued ethnic cleansing');
  assert.ok(combined.includes('genocide'), 'Israel card must include the term genocide');
  assert.ok(!combined.includes('widely regarded as'), 'Israel card must not include "widely regarded as"');
  assert.ok(
    israel.culture.triviaItems.some(t => t.id === 'tri_israel_jerusalem_day' && t.kind === 'festival' && /flag march/i.test(t.fact)),
    'Israel card culture section must include synced Jerusalem Day Flag March festival item'
  );
});

test('findAtlasCountryAtLonLat prioritizes smaller overlapping polygons, falls back to microstate centroids, and ignores ocean', () => {
  const feats = [
    { id: 710, name: 'South Africa' },
    { id: 426, name: 'Lesotho' },
    { id: 702, name: 'Singapore' }
  ];
  const cards = {
    710: { id: 'south_africa', name: 'South Africa' },
    426: { id: 'lesotho', name: 'Lesotho' },
    702: { id: 'singapore', name: 'Singapore' }
  };
  const contains = (feat, pt) => {
    if (pt[0] === 28.2 && pt[1] === -29.6) return feat.id === 710 || feat.id === 426;
    return false;
  };
  const centroid = (feat) => {
    if (feat.id === 710) return [24, -29];
    if (feat.id === 426) return [28.2, -29.6];
    if (feat.id === 702) return [103.82, 1.35];
    return [0, 0];
  };
  const area = (feat) => (feat.id === 710 ? 0.1 : feat.id === 426 ? 0.002 : 0.0001);

  const enclaveHit = prebeta6.findAtlasCountryAtLonLat([28.2, -29.6], feats, cards, contains, centroid, area, 2.5);
  assert.equal(enclaveHit.card.id, 'lesotho');

  const microHit = prebeta6.findAtlasCountryAtLonLat([104.2, 1.5], feats, cards, contains, centroid, area, 2.5);
  assert.equal(microHit.card.id, 'singapore');

  const oceanHit = prebeta6.findAtlasCountryAtLonLat([-150, -30], feats, cards, contains, centroid, area, 2.5);
  assert.equal(oceanHit, null);
});

test('flagEmojiToIso2 converts all 200 genesis card emoji flags to lowercase 2-letter ISO codes', () => {
  const genesisData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'genesis-cards.json'), 'utf8'));
  for (const c of genesisData.cards) {
    const iso = prebeta6.flagEmojiToIso2(c.flag);
    assert.match(iso || '', /^[a-z]{2}$/, `Expected valid ISO-2 code for ${c.id} (${c.flag}), got ${iso}`);
  }
  assert.equal(prebeta6.flagEmojiToIso2('🇳🇵'), 'np');
  assert.equal(prebeta6.flagEmojiToIso2('🇽🇰'), 'xk');
  assert.equal(prebeta6.flagEmojiToIso2('🇵🇸'), 'ps');
});

test('genesis cards have clean plain-text formatting and broad numeric casualty/displacement coverage', () => {
  const genesisData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'genesis-cards.json'), 'utf8'));
  let numericImpactCount = 0;
  for (const c of genesisData.cards) {
    const combined = `${c.story} ${c.contestedNote || ''}`;
    assert.ok(!/[*`_]/.test(combined), `Unexpected raw markdown character in ${c.id}`);
    if (/\b\d{1,3},\d{3}\b|\b\d+\s*(?:to\s*\d+\s*)?(?:million|thousand|%)/i.test(combined)) {
      numericImpactCount++;
    }
  }
  assert.ok(numericImpactCount >= 160, `Expected at least 160 cards with numeric impact stats, got ${numericImpactCount}`);

  const mustContain = [
    ['drc', /1\.5 to 10 million/i],
    ['namibia', /herero and nama.*genocide/i],
    ['rwanda', /500,000 to 800,000/i],
    ['armenia', /armenian genocide/i],
    ['ukraine', /holodomor/i],
    ['india', /12 to 18 million/i],
    ['cambodia', /cambodian genocide/i],
    ['bosnia', /srebrenica genocide/i],
    ['guatemala', /genocide against the maya/i],
    ['palestine', /700,000 palestinians/i],
    ['sudan', /darfur/i],
    ['usa', /trail of tears/i],
    ['australia', /frontier wars/i],
    ['canada', /residential school/i],
    ['myanmar', /rohingya/i],
    ['east_timor', /102,800/i]
  ];
  for (const [id, regex] of mustContain) {
    const card = prebeta6.resolveGenesisCard(genesisData, id);
    assert.ok(card, `Card ${id} must exist`);
    assert.match(`${card.story} ${card.contestedNote || ''}`, regex, `Card ${id} missing expected historical content ${regex}`);
  }
});

test('all 200 flags are self-hosted locally in assets/flags/*.svg with zero external flagcdn references', () => {
  const genesisData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'genesis-cards.json'), 'utf8'));
  const flagsDir = path.join(__dirname, '..', 'assets', 'flags');
  for (const c of genesisData.cards) {
    const iso = prebeta6.flagEmojiToIso2(c.flag);
    const svgPath = path.join(flagsDir, `${iso}.svg`);
    assert.ok(fs.existsSync(svgPath), `Missing self-hosted SVG flag for ${c.id}: ${svgPath}`);
    const content = fs.readFileSync(svgPath, 'utf8');
    assert.ok(content.includes('<svg'), `Invalid SVG content in ${svgPath}`);
  }

  for (const rel of ['play/index.html', 'assets/features-prebeta6.js', 'sw.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    assert.ok(!/flagcdn\.com/i.test(src), `Unexpected external flagcdn.com reference in ${rel}`);
  }
});

test('under-14 external link and Notes to Dev Team gating blocks guests and ages under 14', () => {
  const compliance = require('../assets/compliance-helpers.js');
  const yr = 2026;

  // Logged-out / guest / missing birthYear
  assert.equal(compliance.canAccessExternalLinks(null, yr), false);
  assert.equal(compliance.canAccessDevNotes(null, yr), false);
  assert.equal(compliance.canAccessExternalLinks({ handle: 'NoYear' }, yr), false);
  assert.equal(compliance.canAccessDevNotes({ handle: 'NoYear', birthYear: null }, yr), false);

  // Under 14 (ages 8, 12, 13)
  for (const by of [2018, 2014, 2013]) {
    assert.equal(compliance.canAccessExternalLinks({ birthYear: by }, yr), false, `Expected external links blocked for birthYear ${by}`);
    assert.equal(compliance.canAccessDevNotes({ birthYear: by }, yr), false, `Expected dev notes blocked for birthYear ${by}`);
  }

  // 14+ allowed (ages 14, 17, 30)
  for (const by of [2012, 2009, 1996]) {
    assert.equal(compliance.canAccessExternalLinks({ birthYear: by }, yr), true, `Expected external links allowed for birthYear ${by}`);
    assert.equal(compliance.canAccessDevNotes({ birthYear: by }, yr), true, `Expected dev notes allowed for birthYear ${by}`);
  }
});

test('under-13 COPPA cloud sync defaults to local-only and requires verified Email Plus consent', () => {
  const compliance = require('../assets/compliance-helpers.js');
  const yr = 2026;

  // Under-13 without parent email -> local_only
  const kidLocal = { birthYear: 2016, parentEmail: null, localOnly: true, parentConsentStatus: 'local_only' };
  assert.equal(compliance.getCloudSyncStatus(kidLocal, yr), 'local_only');
  assert.equal(compliance.isCloudSyncAllowed(kidLocal, yr), false);

  // Under-13 with pending parent consent -> pending_consent (still blocked from cloud sync)
  const kidPending = { birthYear: 2016, parentEmail: 'parent@example.com', localOnly: true, parentConsentStatus: 'pending' };
  assert.equal(compliance.getCloudSyncStatus(kidPending, yr), 'pending_consent');
  assert.equal(compliance.isCloudSyncAllowed(kidPending, yr), false);

  // Under-13 after parent clicks Email Plus approval -> allowed
  const kidVerified = { birthYear: 2016, parentEmail: 'parent@example.com', localOnly: false, parentConsentStatus: 'verified' };
  assert.equal(compliance.getCloudSyncStatus(kidVerified, yr), 'allowed');
  assert.equal(compliance.isCloudSyncAllowed(kidVerified, yr), true);

  // Age 13+ -> allowed by default
  const teen = { birthYear: 2013, parentEmail: null, localOnly: false };
  assert.equal(compliance.getCloudSyncStatus(teen, yr), 'allowed');
  assert.equal(compliance.isCloudSyncAllowed(teen, yr), true);
});

test('Email Plus 72-hour HMAC consent token verifies valid tokens and rejects tampered or expired tokens', async () => {
  const consentFn = require('../netlify/functions/parent-consent.js');
  const secret = 'test-signing-secret-32-chars-minimum';
  const nowMs = Date.UTC(2026, 10, 24, 12, 0, 0);
  const pid = '11111111-2222-4333-8444-555555555555';

  const token = consentFn.buildConsentToken(secret, {
    playerId: pid,
    handle: 'AtlasKid',
    email: 'Parent@Example.com',
    birthYear: 2016,
    country: 'United States'
  }, nowMs);

  // Valid right away and at 71h59m
  const ok1 = consentFn.verifyConsentToken(token, secret, nowMs + 1000);
  assert.equal(ok1.valid, true);
  assert.equal(ok1.payload.playerId, pid);
  assert.equal(ok1.payload.email, 'parent@example.com');
  assert.equal(ok1.payload.handle, 'AtlasKid');

  const ok2 = consentFn.verifyConsentToken(token, secret, nowMs + (71 * 3600 + 3500) * 1000);
  assert.equal(ok2.valid, true);

  // Expired after 72h + 1s
  const expired = consentFn.verifyConsentToken(token, secret, nowMs + (72 * 3600 + 2) * 1000);
  assert.equal(expired.valid, false);
  assert.equal(expired.reason, 'expired');

  // Tampered signature rejected
  const tampered = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
  const badSig = consentFn.verifyConsentToken(tampered, secret, nowMs + 1000);
  assert.equal(badSig.valid, false);
  assert.equal(badSig.reason, 'invalid');

  // Wrong secret rejected
  const wrongKey = consentFn.verifyConsentToken(token, 'different-secret', nowMs + 1000);
  assert.equal(wrongKey.valid, false);

  // Handler rejects missing confirmed checkbox
  const prevSecret = process.env.CONSENT_SIGNING_SECRET;
  const prevSvc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.CONSENT_SIGNING_SECRET = secret;
  process.env.SUPABASE_SERVICE_ROLE_KEY = secret;
  try {
    const resNoCheck = await consentFn.handleConfirmParentConsent({ token, confirmed: false });
    assert.equal(resNoCheck.status, 400);
    assert.equal(resNoCheck.data.ok, false);
  } finally {
    if (prevSecret === undefined) delete process.env.CONSENT_SIGNING_SECRET; else process.env.CONSENT_SIGNING_SECRET = prevSecret;
    if (prevSvc === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = prevSvc;
  }
});

test('s-compliance, RETENTION_POLICY, and parent email notices include explicit written data retention timeframes and accurate gating copy', () => {
  const compliance = require('../assets/compliance-helpers.js');
  const playHtml = fs.readFileSync(path.join(__dirname, '..', 'play', 'index.html'), 'utf8');
  const welcomeSrc = fs.readFileSync(path.join(__dirname, '..', 'netlify', 'functions', 'send-welcome-notice.js'), 'utf8');
  const consentSrc = fs.readFileSync(path.join(__dirname, '..', 'netlify', 'functions', 'parent-consent.js'), 'utf8');
  const retentionText = compliance.RETENTION_POLICY.summaryBullets.join('\n');

  // Written retention timeframes present in policy helper, s-compliance, and welcome notice
  for (const [name, src] of [['compliance-helpers.js', retentionText], ['play/index.html', playHtml], ['send-welcome-notice.js', welcomeSrc]]) {
    assert.match(src, /72\s*hours/i, `${name} must mention 72-hour unconfirmed consent expiry`);
    assert.match(src, /24\s*months/i, `${name} must mention 24-month inactive under-13 retention limit`);
    assert.match(src, /30\s*days/i, `${name} must mention 30-day backup purge window`);
  }
  assert.match(consentSrc, /buildRetentionHtmlList\(\)/, 'parent-consent.js must embed RETENTION_POLICY HTML list');
  assert.match(consentSrc, /buildRetentionPlainList\(\)/, 'parent-consent.js must embed RETENTION_POLICY plain-text list');

  // No stale false claim about already having a cognitive parental gate live on external links
  assert.ok(!/Parental gate is a real cognitive task, not a speed bump/i.test(playHtml), 's-compliance must not claim a cognitive parental gate is currently active');
  // Solidarity charity cards must NOT hardcode static href links in initial HTML (set dynamically for 14+ only)
  assert.ok(!/<a\s+href="https:\/\/www\.pcrf\.net\/"/i.test(playHtml), 's-solidarity PCRF card must not hardcode static href');
  assert.ok(!/<a\s+href="https:\/\/www\.culturalsurvival\.org\/"/i.test(playHtml), 's-solidarity Cultural Survival card must not hardcode static href');
  assert.ok(!/<a\s+href="https:\/\/linktr\.ee\/moco_irc"/i.test(playHtml), 's-solidarity MoCo IRC card must not hardcode static href');
});

function loadFullMapData() {
  const code = fs.readFileSync(path.join(__dirname, '..', 'map-data.js'), 'utf8');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(
    code +
      `\nthis.__all = {
        COUNTRY_DATA, CONTINENT_COUNTRIES, OC_TUVALU_FEATURE,
        EURO_COUNTRIES, AFRICA_COUNTRIES, ASIA_COUNTRIES, NA_COUNTRIES, SA_COUNTRIES, OC_COUNTRIES,
        EURO_ISLANDS, AFRICA_ISLANDS, ASIA_ISLANDS, NA_ISLANDS, SA_ISLANDS, OC_ISLANDS,
        EURO_WATER_BODIES, AFRICA_WATER_BODIES, ASIA_WATER_BODIES, NA_WATER_BODIES, SA_WATER_BODIES, OC_WATER_BODIES,
        EURO_RIVERS, AFRICA_RIVERS, ASIA_RIVERS, NA_RIVERS, SA_RIVERS, OC_RIVERS,
        EURO_CITIES, AFRICA_CITIES, ASIA_CITIES, NA_CITIES, SA_CITIES, OC_CITIES,
        EURO_HERITAGE_SITES, AFRICA_HERITAGE_SITES, ASIA_HERITAGE_SITES, NA_HERITAGE_SITES, SA_HERITAGE_SITES, OC_HERITAGE_SITES,
        EURO_LANGUAGE_QUESTIONS, ASIA_LANGUAGE_QUESTIONS,
        EURO_TRIVIA_QUESTIONS, AFRICA_TRIVIA_QUESTIONS, ASIA_TRIVIA_QUESTIONS, NA_TRIVIA_QUESTIONS, SA_TRIVIA_QUESTIONS, OC_TRIVIA_QUESTIONS,
        MOUNTAIN_PEAKS
      };`,
    ctx
  );
  return ctx.__all;
}

test('Section 1: security, compliance text, PBKDF2 password hashing, recovery doc, and sw.js precaching', async () => {
  const playHtml = fs.readFileSync(path.join(__dirname, '..', 'play', 'index.html'), 'utf8');
  const swSrc = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  const recoveryDoc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'SUPABASE_RECOVERY_REPORT.md'), 'utf8');

  // s-compliance text accuracy
  assert.ok(!/195-word filter/i.test(playHtml), 's-compliance must not have stale 195-word filter text');
  assert.match(playHtml, /500\+ real-name detector/i, 's-compliance must describe updated real-name detector');
  assert.match(playHtml, /Utah App Store Act[\s\S]{0,250}May 2027/i, 's-compliance must reflect Utah HB 498 May 2027 effective date');
  assert.ok(!/Utah App Store Act[\s\S]{0,250}May 2026/i.test(playHtml), 's-compliance must not show outdated Utah May 2026 date');
  assert.ok(!/no handle-rename flow exists/i.test(playHtml), 'stale handle-rename comment must be removed');

  // Extract & execute hashPassword and hashPasswordLegacySha256 via Web Crypto
  const hashBlockMatch = playHtml.match(/const PBKDF2_ITERATIONS =[\s\S]*?async function hashPassword\(password\) \{[\s\S]*?return 'pbkdf2\$' \+ PBKDF2_ITERATIONS \+ '\$' \+ hex;\n\}/);
  assert.ok(hashBlockMatch, 'PBKDF2 hashPassword and hashPasswordLegacySha256 block must exist in play/index.html');
  const hashCtx = { crypto: globalThis.crypto, TextEncoder, Uint8Array };
  vm.createContext(hashCtx);
  vm.runInContext(hashBlockMatch[0] + '\nthis.__fns = { hashPassword, hashPasswordLegacySha256 };', hashCtx);
  const pbkdf2Hash = await hashCtx.__fns.hashPassword('TestPass!2026');
  const legacyHash = await hashCtx.__fns.hashPasswordLegacySha256('TestPass!2026');
  assert.match(pbkdf2Hash, /^pbkdf2\$100000\$[0-9a-f]{64}$/, 'hashPassword must produce pbkdf2$100000$<64hex>');
  assert.match(legacyHash, /^[0-9a-f]{64}$/, 'hashPasswordLegacySha256 must produce 64-char SHA-256 hex');
  assert.equal(await hashCtx.__fns.hashPassword('TestPass!2026'), pbkdf2Hash, 'PBKDF2 hash must be deterministic');
  assert.notEqual(pbkdf2Hash, legacyHash);
  assert.match(playHtml, /hashPasswordLegacySha256\(pw\)/, 'login/restore flow must keep legacy SHA-256 fallback');

  // Recovery doc accuracy
  assert.match(recoveryDoc, /restore_profile_by_email.*dropped/is, 'SUPABASE_RECOVERY_REPORT.md must document dropped restore_profile_by_email');
  assert.match(recoveryDoc, /\/api\/request-recovery/, 'SUPABASE_RECOVERY_REPORT.md must document tokenized recovery endpoint');

  // sw.js version & asset lists
  assert.match(swSrc, /CACHE_NAME\s*=\s*'mapolis-cache-v18'/, 'sw.js must be bumped to mapolis-cache-v18');
  assert.doesNotThrow(() => new Function(swSrc), 'sw.js must parse with valid JS syntax');
  const badgeFiles = fs.readdirSync(path.join(__dirname, '..', 'assets', 'badges')).filter(f => f.endsWith('.webp'));
  const flagFiles = fs.readdirSync(path.join(__dirname, '..', 'assets', 'flags')).filter(f => f.endsWith('.svg'));
  assert.equal(badgeFiles.length, 121, 'Expected 121 badge webp assets');
  assert.equal(flagFiles.length, 200, 'Expected 200 flag svg assets');
  for (const b of badgeFiles) {
    assert.ok(swSrc.includes(`'/assets/badges/${b}'`), `sw.js missing badge precache entry: ${b}`);
  }
  for (const f of flagFiles) {
    assert.ok(swSrc.includes(`'/assets/flags/${f}'`), `sw.js missing flag warm-cache entry: ${f}`);
  }
});

test('Section 2: Oceania antimeridian projection, Puerto Rico ID, divided/multi-island extraction, Taiwan Strait, Cotopaxi, altTargetIds, Tuvalu', () => {
  const md = loadFullMapData();
  const playHtml = fs.readFileSync(path.join(__dirname, '..', 'play', 'index.html'), 'utf8');
  const featSrc = fs.readFileSync(path.join(__dirname, '..', 'assets', 'features-prebeta6.js'), 'utf8');

  const allIslands = Object.fromEntries(
    [...md.EURO_ISLANDS, ...md.AFRICA_ISLANDS, ...md.ASIA_ISLANDS, ...md.NA_ISLANDS, ...md.SA_ISLANDS, ...md.OC_ISLANDS].map(i => [i.id, i])
  );

  // Puerto Rico ISO 630
  assert.equal(allIslands.puerto_rico.countryId, '630');
  assert.equal(allIslands.puerto_rico.allRings, true);

  // Oceania antimeridian projection math (rotate [-165, 0], center [0, -18], scale 360 on 800x500)
  assert.match(playHtml, /oceania:\s*\{[^}]*rotate:\s*\[-165,\s*0\][^}]*scale:\s*360/, 'VIEW_CONFIGS.oceania must rotate across antimeridian');
  assert.match(playHtml, /if\s*\(cfg\.rotate\)\s*proj\.rotate\(cfg\.rotate\)/, 'createProjection must apply cfg.rotate');

  // Verify exact Mercator math for Oceania points on 800x500 viewport
  const deg2rad = d => (d * Math.PI) / 180;
  const mercY = latDeg => Math.log(Math.tan(Math.PI / 4 + deg2rad(latDeg) / 2));
  const projectOceania = ([lon, lat]) => {
    let dLon = lon - 165;
    if (dLon > 180) dLon -= 360;
    if (dLon < -180) dLon += 360;
    const x = 400 + 360 * deg2rad(dLon);
    const y = 250 - 360 * (mercY(lat) - mercY(-18));
    return [x, y];
  };
  const oceaniaChecks = {
    perth: [115.86, -31.95],
    palau: [134.58, 7.51],
    tuvalu: [179.19, -8.52],
    fiji: [178.06, -17.71],
    tonga: [-175.20, -21.14],
    samoa: [-171.76, -13.83],
    french_polynesia: [-149.41, -17.68],
    nz_south: [168.35, -46.41]
  };
  for (const [name, coord] of Object.entries(oceaniaChecks)) {
    const [x, y] = projectOceania(coord);
    assert.ok(x >= 20 && x <= 780 && y >= 20 && y <= 480, `Oceania target ${name} projected off-screen at [${x.toFixed(1)}, ${y.toFixed(1)}]`);
  }

  // Extract and execute extractIslandFeatures on real countries-50m.json
  const extractFnMatch = playHtml.match(/function extractIslandRing\([\s\S]*?\nfunction extractIslandFeatures\(isl, geoFeatures\) \{[\s\S]*?\n\}/);
  assert.ok(extractFnMatch, 'extractIslandFeatures must exist in play/index.html');
  const topojson = require('../lib/topojson.min.js');
  const worldTopo = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'countries-50m.json'), 'utf8'));
  const worldFeats = topojson.feature(worldTopo, worldTopo.objects.countries).features;
  // Mirror runtime _idFixups from play/index.html (Northern Cyprus → 196)
  for (const f of worldFeats) {
    if (f.id === undefined && f.properties && f.properties.name === 'N. Cyprus') f.id = '196';
  }
  worldFeats.push(md.OC_TUVALU_FEATURE);

  const ringArea = ring => {
    let a = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    }
    return Math.abs(a) / 2;
  };
  const islCtx = {
    d3: {
      geoArea: f => {
        const ring = f.geometry.coordinates[0];
        return ringArea(ring);
      }
    }
  };
  vm.createContext(islCtx);
  vm.runInContext(extractFnMatch[0] + '\nthis.__extract = extractIslandFeatures;', islCtx);

  // Divided islands must yield >= 2 polygons (covering all sovereign halves)
  for (const id of ['borneo', 'hispaniola', 'tierra_del_fuego', 'timor', 'png_island', 'cyprus']) {
    const res = islCtx.__extract(allIslands[id], worldFeats);
    assert.ok(res.length >= 2, `Divided island ${id} expected >= 2 polygons, got ${res.length}`);
  }
  assert.equal(allIslands.png_island.name, 'New Guinea', 'png_island must be named New Guinea');
  // Multi-island archipelagos must yield >= 2 polygons
  for (const id of ['hawaii', 'galapagos', 'svalbard', 'falklands', 'fiji_islands', 'solomons_is', 'vanuatu_is', 'cape_verde_is', 'comoros_is', 'maldives_is', 'samoa', 'puerto_rico']) {
    const res = islCtx.__extract(allIslands[id], worldFeats);
    assert.ok(res.length >= 2, `Island group ${id} expected >= 2 polygons, got ${res.length}`);
  }

  // _classifyWater classifies Taiwan Strait as straits (not gulfs)
  const cwMatch = playHtml.match(/function _classifyWater\(w\) \{[\s\S]*?\n\}/);
  assert.ok(cwMatch, '_classifyWater must exist in play/index.html');
  const cwCtx = {};
  vm.createContext(cwCtx);
  vm.runInContext(cwMatch[0] + '\nthis.__cw = _classifyWater;', cwCtx);
  assert.equal(cwCtx.__cw({ name: 'Taiwan Strait', id: 'taiwan_strait' }), 'straits');
  assert.equal(cwCtx.__cw({ name: 'Persian Gulf', id: 'persian_gulf' }), 'gulfs');
  assert.equal(cwCtx.__cw({ name: 'Bay of Bengal', id: 'bay_of_bengal' }), 'gulfs');
  assert.equal(cwCtx.__cw({ name: 'Strait of Magellan', id: 'magellan_strait' }), 'straits');
  const validWaterCats = new Set(['oceans', 'seas', 'gulfs', 'straits', 'lakes']);
  for (const w of [
    ...md.EURO_WATER_BODIES, ...md.AFRICA_WATER_BODIES, ...md.ASIA_WATER_BODIES,
    ...md.NA_WATER_BODIES, ...md.SA_WATER_BODIES, ...md.OC_WATER_BODIES
  ]) {
    assert.ok(validWaterCats.has(cwCtx.__cw(w)), `Unexpected water category for ${w.id} (${w.name}): ${cwCtx.__cw(w)}`);
  }

  // Cotopaxi coordinates & elevation fixed (array format [lon, lat, elevFt])
  const cotopaxis = md.MOUNTAIN_PEAKS.andes_north.filter(p => Array.isArray(p) ? (Math.abs(p[0] - (-78.436)) < 0.01) : p.name === 'Cotopaxi');
  assert.equal(cotopaxis.length, 1, 'Expected exactly 1 Cotopaxi peak');
  assert.equal(cotopaxis[0][1], -0.677);
  assert.equal(cotopaxis[0][2], 19347);
  assert.ok(!md.MOUNTAIN_PEAKS.andes_north.some(p => p[2] === 22834 && Math.abs(p[0] - (-78.436)) < 0.1), 'Corrupted Cotopaxi 22834 entry must be removed');

  // altTargetId / altTargetIds wired into buildPool and handleGameClick
  assert.match(playHtml, /altTargetId:\s*q\.altTargetId \|\| null/);
  assert.match(playHtml, /altTargetIds:\s*Array\.isArray\(q\.altTargetIds\) \? q\.altTargetIds\.slice\(\) : null/);
  assert.match(playHtml, /detectByGeo\(lon, lat, q\.type, q\.altTargetIds\[ai\], detectCd\)/);

  // Tuvalu synthetic feature + globe label
  assert.equal(md.OC_TUVALU_FEATURE.id, '798');
  assert.equal(md.OC_TUVALU_FEATURE.geometry.type, 'MultiPolygon');
  assert.ok(md.OC_TUVALU_FEATURE.geometry.coordinates.length >= 3);
  assert.match(playHtml, /ALL_FEATURES\.push\(OC_TUVALU_FEATURE\)/);
  assert.match(featSrc, /allCards\.length \+ ' countries &amp; territories'/);
});

test('Section 3: COUNTRY_DATA sync (200), Equatorial Guinea capital, UNESCO replacements, deduplication, water typos, trivia fixes', () => {
  const md = loadFullMapData();
  const playHtml = fs.readFileSync(path.join(__dirname, '..', 'play', 'index.html'), 'utf8');

  // COUNTRY_DATA has all 200 unique entries
  assert.equal(Object.keys(md.COUNTRY_DATA).length, 200, 'COUNTRY_DATA must contain all 200 countries/territories');
  assert.equal(md.COUNTRY_DATA[226].capital, 'Ciudad de la Paz');
  assert.equal(md.AFRICA_COUNTRIES[226].capital, 'Ciudad de la Paz');
  assert.equal(md.SA_COUNTRIES[254].isTerritory, true);
  assert.equal(md.OC_COUNTRIES[540].isTerritory, true);
  assert.equal(md.AFRICA_COUNTRIES[732].isTerritory, true);

  // Non-UNESCO sites removed, Neuschwanstein kept
  const allHeritage = Object.fromEntries(
    [...md.EURO_HERITAGE_SITES, ...md.AFRICA_HERITAGE_SITES, ...md.ASIA_HERITAGE_SITES, ...md.NA_HERITAGE_SITES, ...md.SA_HERITAGE_SITES, ...md.OC_HERITAGE_SITES].map(h => [h.id, h])
  );
  for (const removed of ['meiji_shrine', 'fushimi_inari', 'niagara', 'panama_canal', 'torres_del_paine', 'salt_flats', 'amazon_rainforest', 'ciudad_perdida', 'twelve_apostles']) {
    assert.equal(allHeritage[removed], undefined, `Non-UNESCO site ${removed} should have been replaced`);
  }
  for (const added of ['nikko_shrines', 'itsukushima_shrine', 'rideau_canal', 'panama_viejo', 'valparaiso_historic', 'potosi_bolivia', 'central_amazon', 'san_agustin_park', 'tasmanian_wilderness', 'neuschwanstein']) {
    assert.ok(allHeritage[added], `Expected UNESCO site ${added} to exist`);
  }

  // Deduplicated heritage sites
  for (const dup of ['parthenon', 'gaudi', 'okavango_delta', 'halong_bay', 'cahokia_mounds', 'cartagena', 'tierra_del_fuego', 'milford_sound', 'fiordland']) {
    assert.equal(allHeritage[dup], undefined, `Duplicate/misnamed heritage site ${dup} should be removed`);
  }

  // Deduplicated cities
  const allCities = Object.fromEntries(
    [...md.EURO_CITIES, ...md.AFRICA_CITIES, ...md.ASIA_CITIES, ...md.NA_CITIES, ...md.SA_CITIES, ...md.OC_CITIES].map(c => [c.id, c])
  );
  for (const dupCity of ['luanda_city', 'khartoum_city', 'tehran_city', 'hanoi_city', 'suva_city']) {
    assert.equal(allCities[dupCity], undefined, `Duplicate city ${dupCity} should be removed`);
  }

  // Water typos & removals & Murray/Darling split
  const allWaterArr = [
    ...md.EURO_WATER_BODIES, ...md.AFRICA_WATER_BODIES, ...md.ASIA_WATER_BODIES,
    ...md.NA_WATER_BODIES, ...md.SA_WATER_BODIES, ...md.OC_WATER_BODIES
  ];
  const allWater = Object.fromEntries(allWaterArr.map(w => [w.id, w]));
  assert.equal(allWater.golfo_de_california, undefined, 'Duplicate golfo_de_california should be removed');
  assert.equal(allWater.great_barrier, undefined, 'Non-water great_barrier should be removed from OC_WATER_BODIES');
  const waterNames = new Set(allWaterArr.map(w => w.name));
  for (const fixedName of ['Padunskoye More', 'Gulf of Khambhat', 'Olenyok Gulf', 'Prince Albert Sound', 'Northwest Passage', 'Étang Saumâtre', 'Strait of Magellan', 'Bahía Inútil']) {
    assert.ok(waterNames.has(fixedName), `Expected corrected water body name: ${fixedName}`);
  }
  const ocRivers = Object.fromEntries(md.OC_RIVERS.map(r => [r.id, r]));
  assert.equal(ocRivers.murray_darling.name, 'Murray River');
  assert.equal(ocRivers.darling.name, 'Darling River');

  // Trivia & Language fixes & deduplications
  const allTrivia = [
    ...md.EURO_LANGUAGE_QUESTIONS, ...md.ASIA_LANGUAGE_QUESTIONS,
    ...md.EURO_TRIVIA_QUESTIONS, ...md.AFRICA_TRIVIA_QUESTIONS, ...md.ASIA_TRIVIA_QUESTIONS,
    ...md.NA_TRIVIA_QUESTIONS, ...md.SA_TRIVIA_QUESTIONS, ...md.OC_TRIVIA_QUESTIONS
  ];
  const triviaById = Object.fromEntries(allTrivia.map(t => [t.id, t]));
  assert.equal(triviaById.tri_monsoon.targetId, 'india');
  assert.match(triviaById.lang_bahasa.label, /Bahasa Indonesia/);
  assert.ok(!/largest.*oil.*exporter|most oil/i.test(triviaById.tri_oil.clue || ''), 'tri_oil should not make false superlative claim');
  assert.ok(!/busiest cruise/i.test(triviaById.tri_caribbean_cruise.clue || ''), 'tri_caribbean_cruise should not make false superlative claim');
  for (const id of ['lang_basque', 'lang_romanian', 'tri_aurora', 'tri_gorillas', 'tri_dead_sea', 'tri_dmz', 'tri_inuit', 'tri_tango']) {
    assert.ok(triviaById[id].altTargetId || (Array.isArray(triviaById[id].altTargetIds) && triviaById[id].altTargetIds.length > 0), `Expected alternate target(s) on ${id}`);
  }
  for (const removedTrivia of ['tri_coffee_origin', 'tri_silk_road_china', 'tri_salar', 'tri_angel_falls', 'tri_coral_sea', 'tri_rugby_nz']) {
    assert.equal(triviaById[removedTrivia], undefined, `Duplicate trivia ${removedTrivia} should be removed`);
  }

  // Turkey myth fixed
  assert.ok(!/Ben Franklin\\'s choice/.test(playHtml), 'Turkey animal description must not state Franklin national bird myth');
  assert.match(playHtml, /Native North American bird admired by Ben Franklin/);
});

test('Section 4: Genesis Card 2024-2026 updates, 10 historical precision fixes, and multi-capital headers', () => {
  const dataset = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'genesis-cards.json'), 'utf8'));
  const byId = Object.fromEntries(dataset.cards.map(c => [c.id, c]));

  // 2024-2026 geopolitical updates
  assert.equal(byId.eq_guinea.capital, 'Ciudad de la Paz');
  assert.match(byId.eq_guinea.story, /Ciudad de la Paz/i);
  assert.match(byId.syria.story, /December 8, 2024/i);
  assert.match(byId.syria.story, /1920/);
  assert.match(byId.syria.story, /1939/);
  const mauritiusText = `${byId.mauritius.story} ${byId.mauritius.contestedNote || ''}`;
  assert.match(mauritiusText, /May 2025/i);
  assert.match(mauritiusText, /unratified|stalled/i);

  // 10 historical precision fixes
  assert.match(byId.bahamas.story, /1648/);
  assert.match(byId.bahamas.story, /1718/);
  assert.match(byId.canada.story, /1883/);
  assert.match(byId.belarus.story, /9,200/);
  assert.match(byId.belarus.story, /628/);
  assert.match(byId.spain.story, /1713/);
  assert.match(byId.spain.story, /1801/);
  assert.match(byId.france.story, /1947/);
  assert.match(byId.iran.story, /1932/);
  assert.match(byId.iran.story, /1975/);
  assert.match(byId.ghana.story, /Sudan/i);
  assert.match(byId.dominica.story, /1903/);
  assert.match(byId.colombia.story, /1830/);
  assert.match(byId.drc.story, /1\.5 to 10 million/i);
  assert.match(byId.belgium.story, /1\.5 to 10 million/i);

  // Multi-capital & de facto headers
  assert.match(byId.nauru.capital, /Yaren.*de facto/i);
  assert.match(byId.south_africa.capital, /Pretoria.*Cape Town.*Bloemfontein/i);
  assert.match(byId.switzerland.capital, /Bern.*de facto/i);
  assert.match(byId.bolivia.capital, /Sucre.*La Paz/i);
  assert.match(byId.eswatini.capital, /Mbabane.*Lobamba/i);
  assert.match(byId.w_sahara.capital, /El Aaiún|Laayoune/i);
  assert.match(byId.palestine.capital, /Jerusalem|Ramallah/i);
  assert.match(byId.palestine.story, /1988/);
  assert.match(byId.palestine.story, /2012/);
});

function loadFullGameGlobals() {
  const mapCode = fs.readFileSync(path.join(__dirname, '..', 'map-data.js'), 'utf8');
  const playHtml = fs.readFileSync(path.join(__dirname, '..', 'play', 'index.html'), 'utf8');
  const animalMatch = playHtml.match(/const ANIMAL_PRESERVE = \[[\s\S]*?\n\];/);
  assert.ok(animalMatch, 'ANIMAL_PRESERVE array must exist in play/index.html');
  assert.match(playHtml, /window\.ANIMAL_PRESERVE\s*=\s*ANIMAL_PRESERVE;/, 'play/index.html must expose window.ANIMAL_PRESERVE');

  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(
    mapCode +
      '\n' +
      animalMatch[0] +
      '\nthis.__g = { EUROPE_DATA, AFRICA_DATA, ASIA_DATA, NA_DATA, SA_DATA, OC_DATA, ANIMAL_PRESERVE, COUNTRY_DATA };',
    ctx
  );
  return ctx.__g;
}

test('Section 5: World Atlas 3-section Country Dossier two-way cross-check parity across all 200 countries', () => {
  const dataset = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'genesis-cards.json'), 'utf8'));
  const g = loadFullGameGlobals();
  const assetIndex = prebeta6.buildGameAssetIndex(g);
  assert.ok(assetIndex.loadedCount > 900, `Expected >900 indexed game assets, got ${assetIndex.loadedCount}`);

  // 1. Validate zero duplicate trivia/language IDs and 100% valid targets in map-data.js
  const continentDatas = [g.EUROPE_DATA, g.AFRICA_DATA, g.ASIA_DATA, g.NA_DATA, g.SA_DATA, g.OC_DATA];
  const allCountryIds = new Set(Object.values(g.COUNTRY_DATA).map(c => c.id));
  for (const cd of continentDatas) {
    for (const c of Object.values(cd.countries || {})) allCountryIds.add(c.id);
  }
  const seenTriviaIds = new Set();
  const seenLangIds = new Set();
  for (const cd of continentDatas) {
    const localCountryIds = new Set(Object.values(cd.countries || {}).map(c => c.id));
    for (const t of (cd.triviaQuestions || [])) {
      assert.ok(!seenTriviaIds.has(t.id), `Duplicate trivia question ID: ${t.id}`);
      seenTriviaIds.add(t.id);
      assert.ok(localCountryIds.has(t.targetId), `Invalid targetId ${t.targetId} on trivia ${t.id} in ${cd.id}`);
      if (t.altTargetId) {
        assert.ok(allCountryIds.has(t.altTargetId), `Invalid altTargetId ${t.altTargetId} on trivia ${t.id}`);
      }
      if (Array.isArray(t.altTargetIds)) {
        for (const alt of t.altTargetIds) {
          assert.ok(allCountryIds.has(alt), `Invalid altTargetIds entry ${alt} on trivia ${t.id}`);
        }
      }
    }
    for (const l of (cd.languageQuestions || [])) {
      assert.ok(!seenLangIds.has(l.id), `Duplicate language question ID: ${l.id}`);
      seenLangIds.add(l.id);
    }
  }
  assert.ok(seenTriviaIds.size >= 260, `Expected >=260 synced trivia questions, got ${seenTriviaIds.size}`);

  // 2. Strict two-way parity across ALL 200 cards
  const validKinds = new Set(['festival', 'tradition', 'landmark', 'culture']);
  let withLand = 0, withWater = 0, withAnimal = 0, withHeritage = 0, withCities = 0;

  for (const card of dataset.cards) {
    assert.ok(card.environment && typeof card.environment === 'object', `Missing environment on ${card.id}`);
    assert.ok(card.culture && typeof card.culture === 'object', `Missing culture on ${card.id}`);
    assert.ok(card.environment.biomeLabel && card.environment.biomeLabel.length >= 6, `Missing biomeLabel on ${card.id}`);
    assert.ok(card.environment.summary && card.environment.summary.length >= 40, `Missing environment summary on ${card.id}`);
    assert.ok(!/[*`_]/.test(card.environment.biomeLabel + ' ' + card.environment.summary), `Raw markdown in environment of ${card.id}`);

    for (const ref of (card.environment.landFeatureIds || [])) {
      assert.ok(assetIndex[ref.type] && assetIndex[ref.type][ref.id], `Dangling land feature ${ref.type}:${ref.id} on ${card.id}`);
    }
    for (const ref of (card.environment.waterFeatureIds || [])) {
      assert.ok(assetIndex[ref.type] && assetIndex[ref.type][ref.id], `Dangling water feature ${ref.type}:${ref.id} on ${card.id}`);
    }
    for (const aid of (card.environment.animalIds || [])) {
      assert.ok(assetIndex.animal[aid], `Dangling animalId ${aid} on ${card.id}`);
    }
    for (const hid of (card.culture.heritageIds || [])) {
      assert.ok(assetIndex.heritage[hid], `Dangling heritageId ${hid} on ${card.id}`);
    }
    for (const cid of (card.culture.cityIds || [])) {
      assert.ok(assetIndex.city[cid], `Dangling cityId ${cid} on ${card.id}`);
    }
    for (const lid of (card.culture.languageIds || [])) {
      assert.ok(assetIndex.language[lid], `Dangling languageId ${lid} on ${card.id}`);
    }
    assert.ok(
      (card.culture.triviaItems && card.culture.triviaItems.length > 0) ||
      (card.culture.languageIds && card.culture.languageIds.length > 0),
      `Expected at least 1 synced cultural highlight for ${card.id}`
    );
    for (const ti of (card.culture.triviaItems || [])) {
      assert.ok(assetIndex.trivia[ti.id], `Dangling triviaItem ${ti.id} on ${card.id}`);
      assert.ok(validKinds.has(ti.kind), `Invalid trivia kind ${ti.kind} on ${card.id}:${ti.id}`);
      assert.ok(ti.fact && ti.fact.length >= 16, `Trivia fact too short on ${card.id}:${ti.id}`);
      assert.ok(!/[*`_]/.test(ti.fact), `Raw markdown in trivia fact on ${card.id}:${ti.id}`);
      assert.ok(!/\?$/.test(ti.fact.trim()), `Unconverted question mark in trivia fact on ${card.id}:${ti.id}: ${ti.fact}`);
    }

    if ((card.environment.landFeatureIds || []).length > 0) withLand++;
    if ((card.environment.waterFeatureIds || []).length > 0) withWater++;
    if ((card.environment.animalIds || []).length > 0) withAnimal++;
    if ((card.culture.heritageIds || []).length > 0) withHeritage++;
    if ((card.culture.cityIds || []).length > 0) withCities++;
  }

  assert.ok(withLand >= 130, `Expected >=130 countries with land features, got ${withLand}`);
  assert.ok(withWater >= 115, `Expected >=115 countries with water features, got ${withWater}`);
  assert.ok(withAnimal >= 30, `Expected >=30 countries with Preserve wildlife, got ${withAnimal}`);
  assert.ok(withHeritage >= 50, `Expected >=50 countries with UNESCO sites, got ${withHeritage}`);
  assert.ok(withCities >= 90, `Expected >=90 countries with notable cities, got ${withCities}`);

  // 3. Audit guardrails: ZERO questions anywhere in rendered languages or trivia, zero broken transforms, key factual fixes
  const questionStartRe = /^(which|where|what|who|whose|in which|find the|locate the)\b/i;
  for (const card of dataset.cards) {
    const res = prebeta6.resolveCardAssets(card, assetIndex);
    // Environment summary must be a complete sentence (not starting with bare third-person verb like "Spans..." or "Transitions...")
    assert.ok(
      !/^(Spans|Transitions|Encompasses|Combines|Connects|Divides|Progresses|Stretches|Bridges|Splits|Ranges|Features|Centers|Climbs|Steps|Packs|Unites|Rises|Dramatically)\b/.test(res.summary),
      `Subjectless fragment in environment summary of ${card.id}: ${res.summary}`
    );
    assert.ok(!/\?/.test(res.summary), `Question mark in environment summary of ${card.id}`);
    // Every resolved language must be declarative (never a quiz question)
    for (const lang of res.languages) {
      assert.ok(!/\?/.test(lang.name + ' ' + lang.clue), `Question mark leaked in language display of ${card.id}: ${lang.name}`);
      assert.ok(!questionStartRe.test(lang.name), `Quiz question leaked in language display of ${card.id}: ${lang.name}`);
    }
    // Every trivia fact must be declarative and well-formed
    for (const ti of res.triviaItems) {
      assert.ok(!/\?/.test(ti.fact), `Question mark leaked in trivia fact of ${card.id}:${ti.id}`);
      assert.ok(!questionStartRe.test(ti.fact), `Quiz question leaked in trivia fact of ${card.id}:${ti.id}`);
      assert.ok(!/\b(founded was|invented was)\b/i.test(ti.fact), `Inverted grammar in ${card.id}:${ti.id}: ${ti.fact}`);
    }
  }

  // Spot-check specific factual & language fixes from the audit
  const byId = Object.fromEntries(dataset.cards.map(c => [c.id, c]));
  const swissRes = prebeta6.resolveCardAssets(byId.switzerland, assetIndex);
  assert.equal(swissRes.languages.length, 1);
  assert.equal(swissRes.languages[0].name, 'German, French, Italian, and Romansh');
  assert.equal(swissRes.languages[0].clue, 'four official languages');
  assert.ok(swissRes.rivers.some(r => r.id === 'rhine'), 'Switzerland must include Rhine River');
  assert.ok(!swissRes.rivers.some(r => r.id === 'danube'), 'Switzerland must not include Danube River');

  const fijiRes = prebeta6.resolveCardAssets(byId.fiji, assetIndex);
  assert.equal(fijiRes.rivers.length, 0, 'Fiji must have zero antimeridian-bleed continental rivers');
  assert.equal(fijiRes.landByGroup.mountain.length, 0, 'Fiji must not include Andes mountains');

  const russiaRes = prebeta6.resolveCardAssets(byId.russia, assetIndex);
  assert.ok(!russiaRes.rivers.some(r => r.id === 'yukon' || r.id === 'mackenzie'), 'Russia must not include North American rivers');
  assert.ok(!russiaRes.landByGroup.peninsula.some(p => p.id === 'crimean'), 'Russia must not list Crimean Peninsula');
  const ukraineRes = prebeta6.resolveCardAssets(byId.ukraine, assetIndex);
  assert.ok(ukraineRes.landByGroup.peninsula.some(p => p.id === 'crimean'), 'Ukraine must list Crimean Peninsula');

  assert.ok(!byId.oman.culture.triviaItems.some(t => /Burj Khalifa/i.test(t.fact)), 'Oman must not claim Burj Khalifa');
  assert.ok(!byId.sri_lanka.culture.triviaItems.some(t => /originated in Sri Lanka/i.test(t.fact)), 'Sri Lanka must not claim Diwali originated there');
  assert.ok(!byId.nepal.culture.triviaItems.some(t => /originated in Nepal/i.test(t.fact)), 'Nepal must not claim Diwali originated there');
  assert.ok(!byId.zambia.culture.triviaItems.some(t => /Lake of Stars/i.test(t.fact)), 'Zambia must not claim Lake of Stars festival');
  assert.ok(!byId.drc.culture.triviaItems.some(t => /Brazzaville/i.test(t.fact)), 'DR Congo must not claim Brazzaville FESPAM');
  assert.match(byId.south_korea.culture.triviaItems.find(t => t.id === 'tri_dmz').fact, /North Korea and South Korea/);
  assert.match(byId.sweden.culture.triviaItems.find(t => t.id === 'tri_ikea').fact, /IKEA was founded/);
  assert.match(byId.denmark.culture.triviaItems.find(t => t.id === 'tri_lego').fact, /LEGO building bricks were invented/);

  const brazilRes = prebeta6.resolveCardAssets(byId.brazil, assetIndex);
  assert.ok(brazilRes.rivers.some(r => /amazon/i.test(r.name)), 'Brazil must include Amazon River');
  assert.ok(!brazilRes.rivers.some(r => /orinoco/i.test(r.name)), 'Brazil must not include Orinoco River');
  assert.ok(brazilRes.animals.length >= 3, 'Brazil must include Animal Preserve wildlife');
  assert.ok(brazilRes.triviaItems.some(t => /carnival/i.test(t.fact)), 'Brazil must include Carnival highlight');

  const tuvaluRes = prebeta6.resolveCardAssets(byId.tuvalu, assetIndex);
  assert.equal(tuvaluRes.hasLand, false);
  assert.equal(tuvaluRes.hasWater, false);
  assert.equal(tuvaluRes.animals.length, 0);
  assert.ok(tuvaluRes.triviaItems.some(t => /fatele/i.test(t.fact)), 'Tuvalu must include Fatele cultural highlight');

  assert.ok(prebeta6.filterGenesisCards(dataset.cards, { search: 'Oktoberfest' }, assetIndex).some(c => c.id === 'germany'));
  assert.ok(prebeta6.filterGenesisCards(dataset.cards, { search: 'Atacama' }, assetIndex).some(c => c.id === 'chile'));
  assert.ok(prebeta6.filterGenesisCards(dataset.cards, { search: 'Alps' }, assetIndex).some(c => c.id === 'switzerland'));
  assert.ok(prebeta6.filterGenesisCards(dataset.cards, { search: 'Angkor' }, assetIndex).some(c => c.id === 'cambodia'));
  assert.ok(prebeta6.filterGenesisCards(dataset.cards, { search: 'Romansh' }, assetIndex).some(c => c.id === 'switzerland'));
});

test('Section 6: Age-gated social popups, single-use tokenized buttons, and removal of clunky room/friend codes from UI', () => {
  const compliance = require('../assets/compliance-helpers.js');
  const yr = 2026;

  // 1. canReceiveSocialPopups age & COPPA gating
  assert.equal(compliance.canReceiveSocialPopups(null, yr), false, 'Guest must never receive social popups');
  assert.equal(compliance.canReceiveSocialPopups({ handle: 'NoId', birthYear: 2000 }, yr), false, 'Profile without id must not receive social popups');
  assert.equal(
    compliance.canReceiveSocialPopups({ id: 'u-kid-local', birthYear: 2016, localOnly: true, parentConsentStatus: 'local_only' }, yr),
    false,
    'Under-13 local-only profile must never receive social popups'
  );
  assert.equal(
    compliance.canReceiveSocialPopups({ id: 'u-kid-pending', birthYear: 2016, parentEmail: 'p@example.com', localOnly: true, parentConsentStatus: 'pending' }, yr),
    false,
    'Under-13 pending parent consent must never receive social popups'
  );
  assert.equal(
    compliance.canReceiveSocialPopups({ id: 'u-kid-verified', birthYear: 2016, parentEmail: 'p@example.com', localOnly: false, parentConsentStatus: 'verified' }, yr),
    true,
    'Under-13 with verified Email Plus parental consent may receive social popups'
  );
  assert.equal(
    compliance.canReceiveSocialPopups({ id: 'u-teen', birthYear: 2013, localOnly: false }, yr),
    true,
    '13+ active profile may receive social popups'
  );
  assert.equal(
    compliance.canReceiveSocialPopups({ id: 'u-teen-paused', birthYear: 2013, localOnly: false, allowFriendRequests: false }, yr),
    false,
    'Profile with paused friend requests must not receive social popups'
  );

  // 2. Single-use action token registry (profile-bound, sender-bound, expiry, replay rejection)
  const reg = prebeta6.createActionTokenRegistry(60_000);
  const t0 = 1_700_000_000_000;
  const tok = reg.issue('profile-A', 'sender-X', 'friend_request', t0);
  assert.match(tok, /^act_/);

  // Mismatched profile / sender / kind rejected without consuming
  assert.deepEqual(reg.consume(tok, 'profile-B', 'sender-X', 'friend_request', t0 + 1000), { ok: false, reason: 'mismatch' });
  assert.deepEqual(reg.consume(tok, 'profile-A', 'sender-Y', 'friend_request', t0 + 1000), { ok: false, reason: 'mismatch' });
  assert.deepEqual(reg.consume(tok, 'profile-A', 'sender-X', 'challenge', t0 + 1000), { ok: false, reason: 'mismatch' });

  // Valid consume succeeds once, replay immediately fails
  assert.deepEqual(reg.consume(tok, 'profile-A', 'sender-X', 'friend_request', t0 + 5000), { ok: true });
  assert.deepEqual(reg.consume(tok, 'profile-A', 'sender-X', 'friend_request', t0 + 5001), { ok: false, reason: 'invalid_token' });

  // Expired token fails
  const tokExp = reg.issue('profile-A', 'sender-Z', 'friend_request', t0);
  assert.deepEqual(reg.consume(tokExp, 'profile-A', 'sender-Z', 'friend_request', t0 + 60_001), { ok: false, reason: 'expired' });

  // 3. UI regression guard: clunky Room Code & Friend Code controls removed from Friends & Challenge UI
  const featSrc = fs.readFileSync(path.join(__dirname, '..', 'assets', 'features-prebeta6.js'), 'utf8');
  assert.ok(!featSrc.includes('Create Private Room'), 'UI must not include Create Private Room button');
  assert.ok(!featSrc.includes('Instant Private Room'), 'UI must not include Instant Private Room card');
  assert.ok(!featSrc.includes('Backup Room Code'), 'Challenge wait modal must not display Backup Room Code');
  assert.ok(!featSrc.includes('Your Friend Code'), 'Friends UI must not display Your Friend Code card');
  assert.ok(!featSrc.includes('fr-join-input'), 'Friends UI must not include Room Code join input');
  assert.ok(!featSrc.includes('fr-create-room'), 'Friends UI must not include Create Private Room button ID');
  assert.ok(featSrc.includes('showIncomingFriendRequestBanner'), 'Live incoming friend request popup must be implemented');
  assert.ok(featSrc.includes('data-action-token'), 'Popup action buttons must carry single-use action tokens');

  // 4. reconcileFriendsSnapshot immediately flips Pending -> Friends when accepted (or -> none if declined)
  const prevState = {
    allowRequests: true,
    friends: [],
    incoming: [],
    outgoing: [{ player_id: 'p-b', handle: 'Cartographer99' }],
    blocked: [],
    lookupResult: {
      found: true,
      relation_status: 'pending_sent',
      player: { player_id: 'p-b', handle: 'Cartographer99' }
    }
  };
  const afterAccept = prebeta6.reconcileFriendsSnapshot(prevState, {
    allow_friend_requests: true,
    friends: [{ player_id: 'p-b', handle: 'Cartographer99', rating: 1410 }],
    incoming: [],
    outgoing: [],
    blocked: []
  });
  assert.equal(afterAccept.nextLookupRelation, 'friends', 'Accepted friend must flip lookupResult from pending_sent to friends');
  assert.equal(afterAccept.changed, true);
  assert.equal(afterAccept.newlyAccepted.length, 1);
  assert.equal(afterAccept.newlyAccepted[0].handle, 'Cartographer99');

  const afterDecline = prebeta6.reconcileFriendsSnapshot(prevState, {
    allow_friend_requests: true,
    friends: [],
    incoming: [],
    outgoing: [],
    blocked: []
  });
  assert.equal(afterDecline.nextLookupRelation, 'none', 'Declined request must reset lookupResult from pending_sent back to none');
  assert.equal(afterDecline.changed, true);
  assert.equal(afterDecline.newlyAccepted.length, 0);
});








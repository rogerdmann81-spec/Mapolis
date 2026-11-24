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

test('Israel Genesis Card covers Zionism, diverse Jewish viewpoints, the Nakba, West Bank settlements, ethnic cleansing, and genocide', () => {
  const genesisData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'genesis-cards.json'), 'utf8'));
  const israel = prebeta6.resolveGenesisCard(genesisData, 'israel');
  assert.ok(israel, 'Israel card must exist');
  const combined = `${israel.turningPoint} ${israel.story} ${israel.contestedNote}`.toLowerCase();
  assert.ok(combined.includes('zionism'), 'Israel card must mention Zionism');
  assert.ok(combined.includes('europe') && combined.includes('united states'), 'Israel card must connect Zionism to Europe and the United States');
  assert.ok(combined.includes('opposing viewpoints') && combined.includes('jewish communities'), 'Israel card must note opposing viewpoints in Jewish communities worldwide');
  assert.ok(combined.includes('nakba'), 'Israel card must mention the Nakba');
  assert.ok(combined.includes('west bank') && combined.includes('settlement'), 'Israel card must mention West Bank settlements');
  assert.ok(combined.includes('ethnic cleansing'), 'Israel card must mention continued ethnic cleansing');
  assert.ok(combined.includes('genocide'), 'Israel card must include the term genocide');
  assert.ok(!combined.includes('widely regarded as'), 'Israel card must not include "widely regarded as"');
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
    ['drc', /5 to 10 million/i],
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







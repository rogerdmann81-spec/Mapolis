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




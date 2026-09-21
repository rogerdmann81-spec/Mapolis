const { mergeProfiles } = require('../assets/shared.js');
const assert = require('assert');

console.log('🧪 Starting Profile Merge Test Suite...');

// ─────────────────────────────────────────────────────────────
// Test 1: Dual Offline Sessions (Deltas combine, no stars lost!)
// ─────────────────────────────────────────────────────────────
{
  const local = {
    id: 'player-1',
    updatedAt: '2026-09-21T12:00:00Z',
    stats: {
      cr: 130, // started at 100, earned 30 in sess_1
      gamesPlayed: 5,
      totalAnswered: 50,
      totalCorrect: 45,
      processedSessions: {
        'sess_1': { crGain: 30, gamesPlayed: 1, answered: 10, correct: 9, ts: '2026-09-21T11:55:00Z' }
      }
    }
  };

  const remote = {
    id: 'player-1',
    updatedAt: '2026-09-21T12:30:00Z',
    stats: {
      cr: 125, // started at 100, earned 25 in sess_2
      gamesPlayed: 5,
      totalAnswered: 50,
      totalCorrect: 42,
      processedSessions: {
        'sess_2': { crGain: 25, gamesPlayed: 1, answered: 10, correct: 8, ts: '2026-09-21T12:25:00Z' }
      }
    }
  };

  const merged = mergeProfiles(local, remote);
  console.log('  Test 1 Result - Merged Stars:', merged.stats.cr);

  // Base 125 (remote) + 30 (unapplied local sess_1) = 155 stars!
  assert.strictEqual(merged.stats.cr, 155, 'Expected 155 stars combining both offline sessions');
  assert.strictEqual(merged.stats.gamesPlayed, 6, 'Expected 6 games played');
  assert.strictEqual(merged.stats.totalCorrect, 51, 'Expected 42 + 9 = 51 correct answers');
  assert(merged.stats.processedSessions['sess_1'], 'sess_1 should be tracked');
  assert(merged.stats.processedSessions['sess_2'], 'sess_2 should be tracked');
  console.log('  ✅ Test 1 Passed: Dual offline sessions combined correctly without losing progress.');
}

// ─────────────────────────────────────────────────────────────
// Test 2: Idempotency (Already synced sessions are not double-counted)
// ─────────────────────────────────────────────────────────────
{
  const local = {
    id: 'player-1',
    updatedAt: '2026-09-21T13:00:00Z',
    stats: {
      cr: 155,
      processedSessions: {
        'sess_1': { crGain: 30 },
        'sess_2': { crGain: 25 }
      }
    }
  };

  const remote = {
    id: 'player-1',
    updatedAt: '2026-09-21T13:05:00Z',
    stats: {
      cr: 155,
      processedSessions: {
        'sess_1': { crGain: 30 },
        'sess_2': { crGain: 25 }
      }
    }
  };

  const merged = mergeProfiles(local, remote);
  assert.strictEqual(merged.stats.cr, 155, 'Stars should not be double counted on idempotency');
  console.log('  ✅ Test 2 Passed: Idempotent session deduplication verified.');
}

// ─────────────────────────────────────────────────────────────
// Test 3: Badge & Store Unlocks Union
// ─────────────────────────────────────────────────────────────
{
  const local = {
    id: 'player-1',
    badges: ['speed_demon', 'explorer_1'],
    accessories: ['hat_gold'],
    unlockedAvatar: {
      types: { robot: true },
      packs: { 'robot:neon': true }
    }
  };

  const remote = {
    id: 'player-1',
    badges: ['speed_demon', 'world_champ'],
    accessories: ['scarf_blue'],
    unlockedAvatar: {
      types: { alien: true },
      packs: { 'alien:space': true }
    }
  };

  const merged = mergeProfiles(local, remote);
  assert.strictEqual(merged.badges.length, 3, 'All 3 unique badges must be preserved');
  assert(merged.badges.includes('speed_demon'));
  assert(merged.badges.includes('explorer_1'));
  assert(merged.badges.includes('world_champ'));

  assert(merged.accessories.includes('hat_gold'));
  assert(merged.accessories.includes('scarf_blue'));

  assert.strictEqual(merged.unlockedAvatar.types.robot, true);
  assert.strictEqual(merged.unlockedAvatar.types.alien, true);
  assert.strictEqual(merged.unlockedAvatar.packs['robot:neon'], true);
  assert.strictEqual(merged.unlockedAvatar.packs['alien:space'], true);
  console.log('  ✅ Test 3 Passed: Badges, accessories, and store unlocks strictly unioned.');
}

// ─────────────────────────────────────────────────────────────
// Test 4: Mastered Cards & Activity Heatmap Union
// ─────────────────────────────────────────────────────────────
{
  const local = {
    id: 'player-1',
    stats: {
      mastered: { 'FRA': true, 'DEU': true },
      dayHistory: ['2026-09-20', '2026-09-21']
    }
  };

  const remote = {
    id: 'player-1',
    stats: {
      mastered: { 'DEU': true, 'JPN': true },
      dayHistory: ['2026-09-19', '2026-09-20']
    }
  };

  const merged = mergeProfiles(local, remote);
  assert.strictEqual(Object.keys(merged.stats.mastered).length, 3, 'FRA, DEU, JPN all mastered');
  assert.deepStrictEqual(merged.stats.dayHistory, ['2026-09-19', '2026-09-20', '2026-09-21'], 'Days deduplicated & sorted');
  console.log('  ✅ Test 4 Passed: Mastered cards and dayHistory heatmap unioned.');
}

// ─────────────────────────────────────────────────────────────
// Test 5: Cosmetics Follow Latest Timestamp (No Badge Loss)
// ─────────────────────────────────────────────────────────────
{
  const local = {
    id: 'player-1',
    updatedAt: '2026-09-21T10:00:00Z',
    avatar: { face: '😎', hat: 'cap' },
    badges: ['rare_badge']
  };

  const remote = {
    id: 'player-1',
    updatedAt: '2026-09-21T15:00:00Z', // Changed cosmetic later on iPad
    avatar: { face: '🤠', hat: 'cowboy' },
    badges: []
  };

  const merged = mergeProfiles(local, remote);
  assert.strictEqual(merged.avatar.face, '🤠', 'Newer cosmetic look from remote wins');
  assert.strictEqual(merged.avatar.hat, 'cowboy');
  assert(merged.badges.includes('rare_badge'), 'Local badge still preserved despite older timestamp');
  console.log('  ✅ Test 5 Passed: Latest cosmetic look equipped without affecting earned badges.');
}

console.log('\n🎉 ALL 5 TEST SUITES PASSED! Profile merge logic is verified.');

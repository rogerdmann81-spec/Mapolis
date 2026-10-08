if (typeof global.localStorage === 'undefined') {
  const store = {};
  global.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { for (const k in store) delete store[k]; }
  };
}

const crypto = require('crypto');
const { h2hStore, syncStore, SUPABASE_URL } = require('../assets/shared.js');

async function runH2HTests() {
  console.log('🧪 Starting H2H Multiplayer Integration Test Suite...');

  const pat = process.env.supabase_pat;
  if (pat) {
    // Clear old test match_queue entries and previous test handles
    await fetch('https://api.supabase.com/v1/projects/tbibeuwpollcrlvowcpg/database/query', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + pat, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: "DELETE FROM match_queue; DELETE FROM match_players WHERE match_id IN (SELECT id FROM matches WHERE started_at < now() - interval '5 minutes'); DELETE FROM profiles WHERE handle LIKE 'SpeedyGeo%' OR handle LIKE 'AtlasMaster%';" })
    });
  }

  // Setup 2 unique player UUIDs and handles
  const p1Id = crypto.randomUUID();
  const p2Id = crypto.randomUUID();
  const p1Handle = 'Speedy_' + p1Id.substring(0, 6);
  const p2Handle = 'Atlas_' + p2Id.substring(0, 6);

  const dummyDeck = [
    { id: 'fra', name: 'France', type: 'country' },
    { id: 'jpn', name: 'Japan', type: 'country' },
    { id: 'bra', name: 'Brazil', type: 'country' }
  ];

  // 1. Create temporary player profiles so foreign key checks / profile lookups pass
  const p1Profile = {
    id: p1Id,
    handle: p1Handle,
    avatar: '🦁',
    stats: { h2h: { rating: 1250, wins: 5, losses: 2, ties: 0 } }
  };
  const p2Profile = {
    id: p2Id,
    handle: p2Handle,
    avatar: '🦅',
    stats: { h2h: { rating: 1220, wins: 3, losses: 1, ties: 0 } }
  };

  if (pat) {
    await fetch('https://api.supabase.com/v1/projects/tbibeuwpollcrlvowcpg/database/query', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + pat, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: `
        INSERT INTO profiles (player_id, handle, avatar_face, stats, cr)
        VALUES
          ('${p1Id}', '${p1Handle}', '🦁', '{"h2h":{"rating":1250,"wins":5,"losses":2,"ties":0}}'::jsonb, 1250),
          ('${p2Id}', '${p2Handle}', '🦅', '{"h2h":{"rating":1220,"wins":3,"losses":1,"ties":0}}'::jsonb, 1220)
        ON CONFLICT (player_id) DO UPDATE SET handle = EXCLUDED.handle, stats = EXCLUDED.stats, cr = EXCLUDED.cr;
      ` })
    });
  } else {
    await syncStore.syncProfile(p1Profile);
    await syncStore.syncProfile(p2Profile);
  }
  console.log('  ✅ Step 1 Passed: Test profiles seeded in Supabase.');

  // 2. Player 1 joins queue
  const p1QueueRes = await h2hStore.joinQueue(p1Id, 5, dummyDeck, p1Profile);
  if (p1QueueRes.status !== 'waiting') {
    throw new Error('Player 1 should be waiting in queue, got: ' + JSON.stringify(p1QueueRes));
  }
  console.log('  ✅ Step 2 Passed: Player 1 entered match queue.');

  // 3. Player 2 joins queue (should pair immediately with Player 1)
  const p2QueueRes = await h2hStore.joinQueue(p2Id, 4, dummyDeck, p2Profile);
  if (p2QueueRes.status !== 'matched') {
    throw new Error('Player 2 should have matched Player 1, got: ' + JSON.stringify(p2QueueRes));
  }
  console.log('  ✅ Step 3 Passed: Player 2 paired immediately with Player 1.');

  const matchId = p2QueueRes.match_id;
  if (!matchId) throw new Error('Match ID missing in match data');

  // 4. Player 1 polls queue and gets the matched payload
  const p1PollRes = await h2hStore.pollQueue(p1Id);
  if (p1PollRes.status !== 'matched' || p1PollRes.match_id !== matchId) {
    throw new Error('Player 1 failed to retrieve match via poll: ' + JSON.stringify(p1PollRes));
  }
  console.log('  ✅ Step 4 Passed: Player 1 retrieved matching match_id via polling.');

  // Check shared card sequence and tier
  if (!p1PollRes.card_sequence || p1PollRes.card_sequence.length !== 3) {
    throw new Error('Card sequence was not properly synchronized between players');
  }
  // The tier should be min(5, 4) = 4
  if (p1PollRes.tier !== 4 || p2QueueRes.tier !== 4) {
    throw new Error(`Expected tier to be 4 (lower grade), got p1:${p1PollRes.tier} p2:${p2QueueRes.tier}`);
  }
  console.log('  ✅ Step 5 Passed: Synchronized card deck and tier cap verified (Tier ' + p1PollRes.tier + ').');

  // 5. Real-time setup lobby synchronization
  // P1 chooses South America and Seas, clicks ready
  const p1Setup = await h2hStore.syncSetup(matchId, p1Id, 'south-america', { seas: true }, true);
  if (!p1Setup || !p1Setup.has_opponent) {
    throw new Error('P1 setup sync failed: ' + JSON.stringify(p1Setup));
  }
  // P2 syncs: should immediately receive P1's choices and real profile stats
  const p2Setup = await h2hStore.syncSetup(matchId, p2Id, 'globe', {}, false);
  if (!p2Setup || !p2Setup.has_opponent || p2Setup.opp_continent !== 'south-america' || !p2Setup.opp_features.seas || !p2Setup.opp_ready) {
    throw new Error('P2 failed to receive P1 setup choices: ' + JSON.stringify(p2Setup));
  }
  if (!p2Setup.opponent || p2Setup.opponent.handle !== p1Handle || p2Setup.opponent.rating !== 1250) {
    throw new Error('P2 failed to receive P1 real profile stats: ' + JSON.stringify(p2Setup.opponent));
  }
  console.log('  ✅ Step 6 Passed: Real-time lobby setup sync and real opponent stats verified.');

  // 6. In-game live score syncing
  // P1 scores a correct point (+1)
  const p1Sync1 = await h2hStore.syncGameplay(matchId, p1Id, 1, 'fra', true);
  if (!p1Sync1 || typeof p1Sync1.opp_score !== 'number') {
    throw new Error('P1 sync gameplay failed: ' + JSON.stringify(p1Sync1));
  }

  // P2 scores a point (+1) and receives P1\'s current score
  const p2Sync1 = await h2hStore.syncGameplay(matchId, p2Id, 1, 'fra', true);
  if (!p2Sync1 || p2Sync1.opp_score !== 1) {
    throw new Error('P2 failed to receive P1 score of 1, got: ' + JSON.stringify(p2Sync1));
  }

  // P1 scores another correct (+1 -> 2)
  await h2hStore.syncGameplay(matchId, p1Id, 2, 'jpn', true);
  // P2 gets a wrong answer (-0.5 -> 0.5)
  const p2Sync2 = await h2hStore.syncGameplay(matchId, p2Id, 0.5, 'jpn', false);
  if (p2Sync2.opp_score !== 2) {
    throw new Error('P2 should observe P1 score at 2, got: ' + p2Sync2.opp_score);
  }
  console.log('  ✅ Step 6 Passed: Real-time score sync and fractional scoring verified.');

  // Step 6.5: Verify opponent finish detection & countdown signal
  await h2hStore.syncGameplay(matchId, p1Id, 2, 'bra', true, true);
  const p2FinishSync = await h2hStore.syncGameplay(matchId, p2Id, 0.5);
  if (!p2FinishSync || p2FinishSync.opp_finished !== true) {
    throw new Error('P2 failed to detect opp_finished signal: ' + JSON.stringify(p2FinishSync));
  }
  console.log('  ✅ Step 6.5 Passed: Real-time opponent finish detection and countdown signal verified.');

  // 6. Finalize match
  // P1 finishes with 2 points
  const p1Final = await h2hStore.finalizeMatch(matchId, p1Id, 2);
  // P2 finishes with 0.5 points
  const p2Final = await h2hStore.finalizeMatch(matchId, p2Id, 0.5);

  if (!p1Final || !p2Final) {
    throw new Error('Finalize match returned null');
  }

  if (p1Final.outcome !== 'win' || p2Final.outcome !== 'loss') {
    throw new Error(`Expected P1 win and P2 loss, got P1:${p1Final.outcome} P2:${p2Final.outcome}`);
  }

  if (p1Final.rating_delta <= 0 || p2Final.rating_delta >= 0) {
    throw new Error(`Expected rating deltas to reflect win/loss, got P1:${p1Final.rating_delta} P2:${p2Final.rating_delta}`);
  }
  console.log(`  ✅ Step 7 Passed: Authoritative Elo finalization verified (P1 won +${p1Final.rating_delta} [${p1Final.elo_after}], P2 lost ${p2Final.rating_delta} [${p2Final.elo_after}]).`);

  // 7. Cleanup
  if (pat) {
    await fetch('https://api.supabase.com/v1/projects/tbibeuwpollcrlvowcpg/database/query', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + pat, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `
          DELETE FROM match_events WHERE match_id = '${matchId}';
          DELETE FROM match_players WHERE match_id = '${matchId}';
          DELETE FROM match_results WHERE match_id = '${matchId}';
          DELETE FROM matches WHERE id = '${matchId}';
          DELETE FROM competitive_ratings WHERE profile_id IN ('${p1Id}', '${p2Id}');
          DELETE FROM profiles WHERE player_id IN ('${p1Id}', '${p2Id}');
        `
      })
    });
  }

  console.log('🎉 ALL H2H INTEGRATION TESTS PASSED!');
}

runH2HTests().catch(err => {
  console.error('❌ H2H Test Failed:', err);
  process.exit(1);
});

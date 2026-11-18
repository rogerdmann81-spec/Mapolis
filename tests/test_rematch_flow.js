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
const { ensureAuthSession, authedHeaders, SUPABASE_URL } = require('../assets/shared.js');

const pat = process.env.supabase_pat;
const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRiaWJldXdwb2xsY3Jsdm93Y3BnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxODg5MTUsImV4cCI6MjA5MTc2NDkxNX0.2fIzL1Fn0aKLwCfOjOMXXQV-3WtvbwY4YoanJJ-Vys8';

async function runRematchFlowTests() {
  console.log('🧪 Starting H2H Endgame Rematch Flow Test Suite...');

  if (!pat) {
    console.log('⚠️  supabase_pat not set, skipping live Supabase rematch test.');
    return;
  }

  await ensureAuthSession();
  const sessRaw = global.localStorage.getItem('mapolis_auth_session');
  const authUid = sessRaw ? JSON.parse(sessRaw).user.id : null;
  if (!authUid) throw new Error('Failed to create test auth session');

  // Create 2 temporary test profiles owned by authUid
  const p1Id = crypto.randomUUID();
  const p2Id = crypto.randomUUID();
  const m1Id = crypto.randomUUID();
  const m2Id = crypto.randomUUID();
  let rematchMatchId = null;

  try {
    await fetch('https://api.supabase.com/v1/projects/tbibeuwpollcrlvowcpg/database/query', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + pat, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: `
        INSERT INTO profiles (player_id, auth_uid, handle, avatar_face, stats, cr)
        VALUES
          ('${p1Id}', '${authUid}', 'RematchP1_${p1Id.slice(0, 6)}', '🦁', '{}'::jsonb, 1200),
          ('${p2Id}', '${authUid}', 'RematchP2_${p2Id.slice(0, 6)}', '🦅', '{}'::jsonb, 1200);

        INSERT INTO matches (id, status, card_pool_tier, started_at)
        VALUES ('${m1Id}', 'finished', 6, now());

        INSERT INTO match_players (match_id, profile_id, final_score, finished_at, setup_continent, setup_features, results_heartbeat, left_results_screen)
        VALUES
          ('${m1Id}', '${p1Id}', 10, now(), 'europe', '{"mountains":true,"rivers":false}'::jsonb, now(), false),
          ('${m1Id}', '${p2Id}', 8, now(), 'north-america', '{"capitals":true,"flags":true}'::jsonb, now(), false);
      ` })
    });

    const headers = authedHeaders();

    async function callRematchSync(matchId, playerId, action, customHeaders = headers) {
      const resp = await fetch(SUPABASE_URL + '/rest/v1/rpc/h2h_rematch_sync', {
        method: 'POST',
        headers: customHeaders,
        body: JSON.stringify({
          p_match_id: matchId,
          p_player_id: playerId,
          p_action: action
        })
      });
      const data = await resp.json();
      return { ok: resp.ok, status: resp.status, data };
    }

    // Security Check: Unauthenticated / non-owner call MUST fail
    const unauthHeaders = { 'apikey': anonKey, 'Authorization': 'Bearer ' + anonKey, 'Content-Type': 'application/json' };
    const unauthRes = await callRematchSync(m1Id, p1Id, 'request', unauthHeaders);
    if (unauthRes.ok) {
      throw new Error('Security check failed: unauthenticated h2h_rematch_sync should have been rejected');
    }
    console.log('🔒 Security Check Passed: Unauthenticated caller rejected from h2h_rematch_sync.');

    // Step 1: Both players arrive at endgame stats screen
    console.log('📌 Test 1: Both players on endgame stats screen (heartbeat)');
    const p1Stay = (await callRematchSync(m1Id, p1Id, 'stay')).data;
    const p2Stay = (await callRematchSync(m1Id, p2Id, 'stay')).data;
    if (p1Stay.status !== 'idle' || !p1Stay.opp_available || p1Stay.opp_requested || !p2Stay.opp_available) {
      throw new Error('Test 1 failed: Expected idle with opp_available = true');
    }

    // Step 2: Player 1 presses Rematch button
    console.log('📌 Test 2: Player 1 presses Rematch button');
    const p1Req = (await callRematchSync(m1Id, p1Id, 'request')).data;
    if (p1Req.status !== 'pulsing' || !p1Req.you_requested || p1Req.opp_requested) {
      throw new Error('Test 2 failed: Expected P1 button to pulse waiting for P2');
    }

    // Step 3: Player 2 polls stats screen and sees Player 1 has requested rematch
    console.log('📌 Test 3: Player 2 polls and sees rematch offer');
    const p2Poll = (await callRematchSync(m1Id, p2Id, 'stay')).data;
    if (p2Poll.status !== 'pulsing' || !p2Poll.opp_requested || p2Poll.you_requested) {
      throw new Error('Test 3 failed: Expected P2 button to pulse because P1 requested rematch');
    }

    // Step 4: Player 2 presses pulsing Rematch button -> both accepted!
    console.log('📌 Test 4: Player 2 presses Rematch button while pulsing');
    const p2Req = (await callRematchSync(m1Id, p2Id, 'request')).data;
    if (p2Req.status !== 'rematch_accepted' || !p2Req.rematch_match_id) {
      throw new Error('Test 4 failed: Expected rematch_accepted with new rematch_match_id');
    }
    rematchMatchId = p2Req.rematch_match_id;

    // Step 5: Player 1 polls and receives the accepted rematch match ID
    console.log('📌 Test 5: Player 1 polls and receives rematch acceptance');
    const p1PollAccept = (await callRematchSync(m1Id, p1Id, 'stay')).data;
    if (p1PollAccept.status !== 'rematch_accepted' || p1PollAccept.rematch_match_id !== rematchMatchId) {
      throw new Error('Test 5 failed: Expected P1 to receive exact matching rematch_match_id');
    }

    // Step 6: Test opponent left screen scenario
    console.log('📌 Test 6: Opponent leaves endgame stats screen');
    await fetch('https://api.supabase.com/v1/projects/tbibeuwpollcrlvowcpg/database/query', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + pat, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: `
        INSERT INTO matches (id, status, card_pool_tier, started_at)
        VALUES ('${m2Id}', 'finished', 6, now());

        INSERT INTO match_players (match_id, profile_id, final_score, finished_at, left_results_screen)
        VALUES
          ('${m2Id}', '${p1Id}', 10, now(), false),
          ('${m2Id}', '${p2Id}', 8, now(), true);
      ` })
    });

    const p1ReqOppLeft = (await callRematchSync(m2Id, p1Id, 'request')).data;
    if (p1ReqOppLeft.status !== 'opponent_left' || p1ReqOppLeft.opp_available) {
      throw new Error('Test 6 failed: Expected opponent_left with opp_available = false (no pulse)');
    }

    console.log('✅ ALL REMATCH FLOW TESTS PASSED SUCCESSFULLY!');
  } finally {
    await fetch('https://api.supabase.com/v1/projects/tbibeuwpollcrlvowcpg/database/query', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + pat, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: `
        DELETE FROM match_players WHERE match_id IN ('${m1Id}', '${m2Id}'${rematchMatchId ? `, '${rematchMatchId}'` : ''});
        DELETE FROM matches WHERE id IN ('${m1Id}', '${m2Id}'${rematchMatchId ? `, '${rematchMatchId}'` : ''});
        DELETE FROM profiles WHERE player_id IN ('${p1Id}', '${p2Id}');
      ` })
    });
  }
}

runRematchFlowTests().catch(err => {
  console.error('❌ Rematch flow test error:', err);
  process.exit(1);
});

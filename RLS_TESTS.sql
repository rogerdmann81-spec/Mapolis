-- Mapolis RLS Test Queries
-- Run these in the Supabase SQL Editor after any policy change to verify RLS is working.
-- Tests 1, 2, 5, 6, 7, 8, 10, 11, 12 require live auth sessions with real player data.
-- Tests 3, 4, 9, 13 can be run anytime.

-- Test 1: Student cannot read another student's profile (run as student auth session)
-- Expected: 0 rows
SELECT * FROM profiles WHERE player_id != (
  SELECT player_id FROM profiles WHERE auth_uid = auth.uid() LIMIT 1
);

-- Test 2: Student cannot read sessions belonging to another student
-- Expected: 0 rows
SELECT * FROM sessions WHERE player_id != (
  SELECT player_id FROM profiles WHERE auth_uid = auth.uid() LIMIT 1
);

-- Test 3: Student cannot directly INSERT into sessions
-- Expected: error
INSERT INTO sessions (id, player_id, started_at, ended_at, mode, tier, final_score, cards_answered, cards_correct)
VALUES (gen_random_uuid(), gen_random_uuid(), now(), now(), 'solo', 1, 0, 0, 0);

-- Test 4: Student cannot directly INSERT into card_attempts
-- Expected: error
INSERT INTO card_attempts (session_id, player_id, card_id, category, correct, time_ms, answered_at)
VALUES (gen_random_uuid(), gen_random_uuid(), 'test', 'geo', true, 1000, now());

-- Test 5: Student CAN call submit_round with own player_id
-- Expected: returns a uuid
SELECT submit_round(jsonb_build_object(
  'session', jsonb_build_object(
    'id', gen_random_uuid()::text,
    'player_id', (SELECT player_id FROM profiles WHERE auth_uid = auth.uid() LIMIT 1)::text,
    'started_at', now()::text, 'ended_at', now()::text,
    'mode', 'solo', 'tier', 1, 'category', 'geo',
    'final_score', 100, 'cards_answered', 10, 'cards_correct', 8
  ),
  'card_attempts', '[]'::jsonb,
  'star_events', '[]'::jsonb,
  'progress_updates', '[]'::jsonb
));

-- Test 6: submit_round with someone else's player_id raises exception
-- Expected: 'submit_round: auth mismatch...'
SELECT submit_round(jsonb_build_object(
  'session', jsonb_build_object(
    'id', gen_random_uuid()::text,
    'player_id', '00000000-0000-0000-0000-000000000000',
    'started_at', now()::text, 'ended_at', now()::text,
    'mode', 'solo', 'tier', 1, 'category', 'geo',
    'final_score', 0, 'cards_answered', 0, 'cards_correct', 0
  ),
  'card_attempts', '[]'::jsonb,
  'star_events', '[]'::jsonb,
  'progress_updates', '[]'::jsonb
));

-- Test 7: Educator can read card_attempts for own students only
-- Expected: rows for own students only (run as educator)
SELECT ca.* FROM card_attempts ca
JOIN classroom_members cm ON cm.profile_id = ca.player_id
JOIN classrooms c ON c.id = cm.classroom_id
WHERE c.owner_id = auth.uid();

-- Test 8: Educator cannot read card_attempts of students in someone else's classroom
-- Expected: 0 rows
SELECT ca.* FROM card_attempts ca
WHERE ca.player_id NOT IN (
  SELECT cm.profile_id FROM classroom_members cm
  JOIN classrooms c ON c.id = cm.classroom_id
  WHERE c.owner_id = auth.uid()
);

-- Test 9: Non-admin cannot set is_admin = true on themselves
-- Expected: 0 rows updated
UPDATE profiles SET is_admin = true WHERE auth_uid = auth.uid();

-- Test 10: Admin can read everything (run as admin)
SELECT count(*) FROM profiles;
SELECT count(*) FROM sessions;
SELECT count(*) FROM card_attempts;

-- Test 11: Player cannot read matches they are not a participant in
-- Expected: 0 rows
SELECT * FROM matches WHERE id NOT IN (
  SELECT mp.match_id FROM match_players mp
  JOIN profiles p ON p.player_id = mp.profile_id
  WHERE p.auth_uid = auth.uid()
);

-- Test 12: Player cannot insert match_events with someone else's profile_id
-- Expected: error
INSERT INTO match_events (match_id, profile_id, card_id, correct, score_delta)
VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'test', true, 10);

-- Test 13: Competitive leaderboard readable by anyone
-- Expected: rows returned (or empty if no data yet)
SELECT profile_id, elo FROM competitive_ratings ORDER BY elo DESC LIMIT 10;

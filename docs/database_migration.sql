-- 1. Add missing columns to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_selections JSONB;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_svg TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_face TEXT DEFAULT '🧑';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS unlocked_avatar JSONB;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stats JSONB DEFAULT '{"cr":0,"totalAnswered":0,"totalCorrect":0}'::jsonb;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS link_code TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS parent_email TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS frozen BOOLEAN DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS recovery_created_at TIMESTAMPTZ;

-- 2. Fix the infinite recursion in Admin policy
DROP POLICY IF EXISTS "Admins can read all profiles" ON profiles;

CREATE OR REPLACE FUNCTION auth_is_admin() RETURNS boolean
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT is_admin FROM profiles WHERE auth_uid = auth.uid();
$$;

CREATE POLICY "Admins can read all profiles" ON profiles
    FOR ALL USING (auth_is_admin());

-- 3. Update the Restore Profile RPCs to handle frozen correctly
CREATE OR REPLACE FUNCTION restore_profile(
  p_handle text,
  p_password_hash text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_uid uuid := auth.uid();
  v_profile profiles%ROWTYPE;
BEGIN
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_profile
  FROM profiles
  WHERE lower(handle) = lower(p_handle)
    AND password_hash = p_password_hash;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid handle or password';
  END IF;

  IF v_profile.frozen = true THEN
    RAISE EXCEPTION 'Profile is frozen';
  END IF;

  UPDATE profiles
  SET auth_uid = v_auth_uid,
      recovery_created_at = now()
  WHERE player_id = v_profile.player_id
  RETURNING * INTO v_profile;

  RETURN row_to_json(v_profile)::jsonb;
END;
$$;

CREATE OR REPLACE FUNCTION restore_profile_by_email(
  p_parent_email text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_uid uuid := auth.uid();
  v_profile profiles%ROWTYPE;
BEGIN
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_profile
  FROM profiles
  WHERE lower(parent_email) = lower(p_parent_email)
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Email not found';
  END IF;

  IF v_profile.frozen = true THEN
    RAISE EXCEPTION 'Profile is frozen';
  END IF;

  UPDATE profiles
  SET auth_uid = v_auth_uid,
      recovery_created_at = now()
  WHERE player_id = v_profile.player_id
  RETURNING * INTO v_profile;

  RETURN row_to_json(v_profile)::jsonb;
END;
$$;

-- 4. Head-to-Head (H2H) Multiplayer Schema & RPCs (Branch: pre-beta4)

-- Numeric columns for half-point (+1 / -0.5) scoring without integer truncation
ALTER TABLE match_players ALTER COLUMN final_score TYPE NUMERIC;
ALTER TABLE match_results ALTER COLUMN score TYPE NUMERIC;
ALTER TABLE match_results ALTER COLUMN opponent_score TYPE NUMERIC;
ALTER TABLE match_events ALTER COLUMN score_delta TYPE NUMERIC;
ALTER TABLE match_queue ADD COLUMN IF NOT EXISTS card_sequence_json JSONB;

-- Setup tracking columns for real-time lobby choice synchronization
ALTER TABLE match_players ADD COLUMN IF NOT EXISTS setup_continent text DEFAULT 'globe';
ALTER TABLE match_players ADD COLUMN IF NOT EXISTS setup_features jsonb DEFAULT '{}'::jsonb;
ALTER TABLE match_players ADD COLUMN IF NOT EXISTS setup_ready boolean DEFAULT false;
ALTER TABLE match_players ADD COLUMN IF NOT EXISTS setup_updated_at timestamptz DEFAULT now();

-- Clean legacy triggers
DROP TRIGGER IF EXISTS check_match_queue ON match_queue;
DROP FUNCTION IF EXISTS matchmaker_process();
DROP FUNCTION IF EXISTS submit_match_result(uuid, uuid, uuid);

-- RLS security definer helper to prevent infinite recursion
CREATE OR REPLACE FUNCTION user_is_in_match(p_match_id uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM match_players mp
    JOIN profiles p ON p.player_id = mp.profile_id
    WHERE mp.match_id = p_match_id AND p.auth_uid = auth.uid()
  );
$$;

DROP POLICY IF EXISTS "matches_read" ON matches;
CREATE POLICY "matches_read" ON matches
  FOR SELECT USING (user_is_in_match(id) OR auth_is_admin());

DROP POLICY IF EXISTS "match_players_read" ON match_players;
CREATE POLICY "match_players_read" ON match_players
  FOR SELECT USING (user_is_in_match(match_id) OR auth_is_admin());

DROP POLICY IF EXISTS "match_events_read" ON match_events;
CREATE POLICY "match_events_read" ON match_events
  FOR SELECT USING (user_is_in_match(match_id) OR auth_is_admin());

DROP POLICY IF EXISTS "match_results_read" ON match_results;
CREATE POLICY "match_results_read" ON match_results
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.player_id = match_results.profile_id AND profiles.auth_uid = auth.uid())
    OR auth_is_admin()
  );

-- H2H Join Queue RPC
CREATE OR REPLACE FUNCTION h2h_join_queue(
  p_player_id uuid,
  p_tier int,
  p_card_sequence jsonb DEFAULT NULL,
  p_profile_data jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_auth_uid uuid := auth.uid();
  v_opp_queue RECORD;
  v_matched RECORD;
  v_lower_tier int;
  v_card_seq jsonb;
  v_match_id uuid;
  v_queue_id uuid;
  v_safe_handle text;
BEGIN
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'h2h_join_queue: not authenticated';
  END IF;

  -- Ensure profile exists and is updated with caller's real handle, avatar, and stats
  IF EXISTS (SELECT 1 FROM profiles WHERE player_id = p_player_id) THEN
    IF p_profile_data IS NOT NULL THEN
      UPDATE profiles SET
        auth_uid = COALESCE(v_auth_uid, auth_uid),
        avatar_svg = COALESCE(p_profile_data->>'avatar_svg', avatar_svg),
        avatar_face = COALESCE(p_profile_data->>'avatar_face', avatar_face),
        avatar_selections = COALESCE(p_profile_data->'avatar_selections', avatar_selections),
        stats = COALESCE(p_profile_data->'stats', stats),
        cr = COALESCE((p_profile_data->'stats'->'h2h'->>'rating')::int, (p_profile_data->>'rating')::int, cr)
      WHERE player_id = p_player_id;
    ELSE
      UPDATE profiles SET auth_uid = v_auth_uid WHERE player_id = p_player_id AND (auth_uid IS NULL OR auth_uid = v_auth_uid);
    END IF;
  ELSE
    -- Profile does not exist yet; verify handle is not taken by another user
    v_safe_handle := COALESCE(p_profile_data->>'handle', 'Player-' || substring(p_player_id::text from 1 for 8));
    IF EXISTS (SELECT 1 FROM profiles WHERE lower(handle) = lower(v_safe_handle) AND player_id != p_player_id) THEN
      v_safe_handle := v_safe_handle || '_' || substring(p_player_id::text from 1 for 4);
    END IF;

    INSERT INTO profiles (player_id, auth_uid, handle, avatar_svg, avatar_face, avatar_selections, stats, cr)
    VALUES (
      p_player_id,
      v_auth_uid,
      v_safe_handle,
      p_profile_data->>'avatar_svg',
      COALESCE(p_profile_data->>'avatar_face', '🧑'),
      p_profile_data->'avatar_selections',
      COALESCE(p_profile_data->'stats', '{}'::jsonb),
      COALESCE((p_profile_data->'stats'->'h2h'->>'rating')::int, (p_profile_data->>'rating')::int, 1200)
    )
    ON CONFLICT (player_id) DO UPDATE SET
      auth_uid = COALESCE(EXCLUDED.auth_uid, profiles.auth_uid),
      avatar_svg = COALESCE(EXCLUDED.avatar_svg, profiles.avatar_svg),
      avatar_face = COALESCE(EXCLUDED.avatar_face, profiles.avatar_face),
      avatar_selections = COALESCE(EXCLUDED.avatar_selections, profiles.avatar_selections),
      stats = COALESCE(EXCLUDED.stats, profiles.stats),
      cr = COALESCE(EXCLUDED.cr, profiles.cr);
  END IF;

  DELETE FROM match_queue WHERE entered_at < now() - interval '45 seconds';

  SELECT m.id, m.card_pool_tier, m.status, m.started_at, m.card_sequence_json,
         p.player_id as opp_id, p.handle as opp_handle, p.avatar_svg as opp_svg, p.avatar_face as opp_face,
         p.avatar_selections as opp_selections, p.stats as opp_stats, p.country as opp_country, p.birth_year as opp_birth_year,
         COALESCE((p.stats->'h2h'->>'rating')::int, cr.elo, NULLIF(p.cr, 0), 1200) as opp_elo,
         COALESCE((p.stats->'h2h'->>'wins')::int, cr.wins, 0) as opp_wins,
         COALESCE((p.stats->'h2h'->>'losses')::int, cr.losses, 0) as opp_losses,
         COALESCE((p.stats->'h2h'->>'ties')::int, cr.ties, 0) as opp_ties
  INTO v_matched
  FROM match_players mp_me
  JOIN matches m ON m.id = mp_me.match_id
  JOIN match_players mp_opp ON mp_opp.match_id = m.id AND mp_opp.profile_id != p_player_id
  JOIN profiles p ON p.player_id = mp_opp.profile_id
  LEFT JOIN competitive_ratings cr ON cr.profile_id = p.player_id
  WHERE mp_me.profile_id = p_player_id
    AND m.status = 'active'
    AND m.started_at > now() - interval '60 seconds'
  ORDER BY m.started_at DESC
  LIMIT 1;

  IF FOUND THEN
    DELETE FROM match_queue WHERE profile_id = p_player_id;
    RETURN jsonb_build_object(
      'status', 'matched',
      'match_id', v_matched.id,
      'role', 'reconnect',
      'opponent', jsonb_build_object(
        'player_id', v_matched.opp_id,
        'handle', v_matched.opp_handle,
        'avatar_svg', v_matched.opp_svg,
        'avatar_face', v_matched.opp_face,
        'avatar_selections', v_matched.opp_selections,
        'stats', v_matched.opp_stats,
        'country', v_matched.opp_country,
        'birth_year', v_matched.opp_birth_year,
        'rating', v_matched.opp_elo,
        'wins', v_matched.opp_wins,
        'losses', v_matched.opp_losses,
        'ties', v_matched.opp_ties,
        'tier', v_matched.card_pool_tier
      ),
      'card_sequence', v_matched.card_sequence_json,
      'tier', v_matched.card_pool_tier,
      'started_at', v_matched.started_at
    );
  END IF;

  SELECT mq.*, p.handle as opp_handle, p.avatar_svg as opp_svg, p.avatar_face as opp_face,
         p.avatar_selections as opp_selections, p.stats as opp_stats, p.country as opp_country, p.birth_year as opp_birth_year,
         COALESCE((p.stats->'h2h'->>'rating')::int, cr.elo, NULLIF(p.cr, 0), 1200) as opp_elo,
         COALESCE((p.stats->'h2h'->>'wins')::int, cr.wins, 0) as opp_wins,
         COALESCE((p.stats->'h2h'->>'losses')::int, cr.losses, 0) as opp_losses,
         COALESCE((p.stats->'h2h'->>'ties')::int, cr.ties, 0) as opp_ties
  INTO v_opp_queue
  FROM match_queue mq
  JOIN profiles p ON p.player_id = mq.profile_id
  LEFT JOIN competitive_ratings cr ON cr.profile_id = p.player_id
  WHERE mq.profile_id != p_player_id
  ORDER BY mq.entered_at ASC
  LIMIT 1
  FOR UPDATE OF mq SKIP LOCKED;

  IF FOUND THEN
    v_lower_tier := LEAST(p_tier, v_opp_queue.tier);
    v_card_seq := COALESCE(v_opp_queue.card_sequence_json, p_card_sequence);

    INSERT INTO matches (card_pool_tier, status, started_at, card_sequence_json)
    VALUES (v_lower_tier, 'active', now(), v_card_seq)
    RETURNING id INTO v_match_id;

    INSERT INTO match_players (match_id, profile_id, final_score, disconnected)
    VALUES
      (v_match_id, p_player_id, 0, false),
      (v_match_id, v_opp_queue.profile_id, 0, false);

    DELETE FROM match_queue WHERE profile_id IN (p_player_id, v_opp_queue.profile_id);

    RETURN jsonb_build_object(
      'status', 'matched',
      'match_id', v_match_id,
      'role', 'joiner',
      'opponent', jsonb_build_object(
        'player_id', v_opp_queue.profile_id,
        'handle', v_opp_queue.opp_handle,
        'avatar_svg', v_opp_queue.opp_svg,
        'avatar_face', v_opp_queue.opp_face,
        'avatar_selections', v_opp_queue.opp_selections,
        'stats', v_opp_queue.opp_stats,
        'country', v_opp_queue.opp_country,
        'birth_year', v_opp_queue.opp_birth_year,
        'rating', v_opp_queue.opp_elo,
        'wins', v_opp_queue.opp_wins,
        'losses', v_opp_queue.opp_losses,
        'ties', v_opp_queue.opp_ties,
        'tier', v_opp_queue.tier
      ),
      'card_sequence', v_card_seq,
      'tier', v_lower_tier,
      'started_at', now()
    );
  END IF;

  DELETE FROM match_queue WHERE profile_id = p_player_id;
  INSERT INTO match_queue (profile_id, tier, entered_at, card_sequence_json)
  VALUES (p_player_id, p_tier, now(), p_card_sequence)
  RETURNING id INTO v_queue_id;

  RETURN jsonb_build_object(
    'status', 'waiting',
    'queue_id', v_queue_id
  );
END;
$$;

-- H2H Queue Poll RPC
CREATE OR REPLACE FUNCTION h2h_poll_queue(
  p_player_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_auth_uid uuid := auth.uid();
  v_matched RECORD;
BEGIN
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'h2h_poll_queue: not authenticated';
  END IF;

  SELECT m.id, m.card_pool_tier, m.status, m.started_at, m.card_sequence_json,
         p.player_id as opp_id, p.handle as opp_handle, p.avatar_svg as opp_svg, p.avatar_face as opp_face,
         p.avatar_selections as opp_selections, p.stats as opp_stats, p.country as opp_country, p.birth_year as opp_birth_year,
         COALESCE((p.stats->'h2h'->>'rating')::int, cr.elo, NULLIF(p.cr, 0), 1200) as opp_elo,
         COALESCE((p.stats->'h2h'->>'wins')::int, cr.wins, 0) as opp_wins,
         COALESCE((p.stats->'h2h'->>'losses')::int, cr.losses, 0) as opp_losses,
         COALESCE((p.stats->'h2h'->>'ties')::int, cr.ties, 0) as opp_ties
  INTO v_matched
  FROM match_players mp_me
  JOIN matches m ON m.id = mp_me.match_id
  JOIN match_players mp_opp ON mp_opp.match_id = m.id AND mp_opp.profile_id != p_player_id
  JOIN profiles p ON p.player_id = mp_opp.profile_id
  LEFT JOIN competitive_ratings cr ON cr.profile_id = p.player_id
  WHERE mp_me.profile_id = p_player_id
    AND m.status = 'active'
    AND m.started_at > now() - interval '60 seconds'
  ORDER BY m.started_at DESC
  LIMIT 1;

  IF FOUND THEN
    DELETE FROM match_queue WHERE profile_id = p_player_id;
    RETURN jsonb_build_object(
      'status', 'matched',
      'match_id', v_matched.id,
      'role', 'creator',
      'opponent', jsonb_build_object(
        'player_id', v_matched.opp_id,
        'handle', v_matched.opp_handle,
        'avatar_svg', v_matched.opp_svg,
        'avatar_face', v_matched.opp_face,
        'avatar_selections', v_matched.opp_selections,
        'stats', v_matched.opp_stats,
        'country', v_matched.opp_country,
        'birth_year', v_matched.opp_birth_year,
        'rating', v_matched.opp_elo,
        'wins', v_matched.opp_wins,
        'losses', v_matched.opp_losses,
        'ties', v_matched.opp_ties,
        'tier', v_matched.card_pool_tier
      ),
      'card_sequence', v_matched.card_sequence_json,
      'tier', v_matched.card_pool_tier,
      'started_at', v_matched.started_at
    );
  END IF;

  RETURN jsonb_build_object('status', 'waiting');
END;
$$;

-- H2H Real-Time Lobby Choice & Setup Sync RPC
CREATE OR REPLACE FUNCTION h2h_sync_setup(
  p_match_id uuid,
  p_player_id uuid,
  p_continent text,
  p_features jsonb,
  p_ready boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_opp RECORD;
BEGIN
  -- Update caller's setup choices
  UPDATE match_players
  SET setup_continent = COALESCE(p_continent, setup_continent, 'globe'),
      setup_features = COALESCE(p_features, setup_features, '{}'::jsonb),
      setup_ready = COALESCE(p_ready, setup_ready, false),
      setup_updated_at = now()
  WHERE match_id = p_match_id AND profile_id = p_player_id;

  -- Query opponent's setup choices and REAL profile stats
  SELECT mp.setup_continent, mp.setup_features, mp.setup_ready,
         p.player_id, p.handle, p.avatar_svg, p.avatar_face, p.avatar_selections, p.stats, p.country, p.birth_year,
         COALESCE((p.stats->'h2h'->>'rating')::int, cr.elo, NULLIF(p.cr, 0), 1200) as opp_elo,
         COALESCE((p.stats->'h2h'->>'wins')::int, cr.wins, 0) as opp_wins,
         COALESCE((p.stats->'h2h'->>'losses')::int, cr.losses, 0) as opp_losses,
         COALESCE((p.stats->'h2h'->>'ties')::int, cr.ties, 0) as opp_ties
  INTO v_opp
  FROM match_players mp
  JOIN profiles p ON p.player_id = mp.profile_id
  LEFT JOIN competitive_ratings cr ON cr.profile_id = p.player_id
  WHERE mp.match_id = p_match_id AND mp.profile_id != p_player_id
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'has_opponent', true,
      'opp_continent', COALESCE(v_opp.setup_continent, 'globe'),
      'opp_features', COALESCE(v_opp.setup_features, '{}'::jsonb),
      'opp_ready', COALESCE(v_opp.setup_ready, false),
      'opponent', jsonb_build_object(
        'player_id', v_opp.player_id,
        'handle', v_opp.handle,
        'avatar_svg', v_opp.avatar_svg,
        'avatar_face', v_opp.avatar_face,
        'avatar_selections', v_opp.avatar_selections,
        'stats', v_opp.stats,
        'birth_year', v_opp.birth_year,
        'rating', v_opp.opp_elo,
        'wins', v_opp.opp_wins,
        'losses', v_opp.opp_losses,
        'ties', v_opp.opp_ties,
        'country', v_opp.country
      )
    );
  ELSE
    RETURN jsonb_build_object('has_opponent', false);
  END IF;
END;
$$;

  RETURN jsonb_build_object('status', 'waiting');
END;
$$;

-- H2H Leave Queue RPC
CREATE OR REPLACE FUNCTION h2h_leave_queue(
  p_player_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM match_queue WHERE profile_id = p_player_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

-- H2H Sync Gameplay Score RPC
CREATE OR REPLACE FUNCTION h2h_sync_gameplay(
  p_match_id uuid,
  p_player_id uuid,
  p_score numeric,
  p_card_id text DEFAULT NULL,
  p_correct boolean DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_opp_score numeric;
  v_opp_disc boolean;
  v_started_at timestamptz;
BEGIN
  UPDATE match_players
  SET final_score = p_score
  WHERE match_id = p_match_id AND profile_id = p_player_id;

  IF p_card_id IS NOT NULL AND p_correct IS NOT NULL THEN
    INSERT INTO match_events (match_id, profile_id, card_id, correct, score_delta, answered_at)
    VALUES (p_match_id, p_player_id, p_card_id, p_correct, CASE WHEN p_correct THEN 1.0 ELSE -0.5 END, now());
  END IF;

  SELECT mp.final_score, mp.disconnected, m.started_at
  INTO v_opp_score, v_opp_disc, v_started_at
  FROM match_players mp
  JOIN matches m ON m.id = mp.match_id
  WHERE mp.match_id = p_match_id AND mp.profile_id != p_player_id
  LIMIT 1;

  RETURN jsonb_build_object(
    'opp_score', COALESCE(v_opp_score, 0),
    'opp_disconnected', COALESCE(v_opp_disc, false),
    'elapsed_sec', EXTRACT(EPOCH FROM (now() - COALESCE(v_started_at, now())))
  );
END;
$$;

-- H2H Finalize Match RPC
CREATE OR REPLACE FUNCTION h2h_finalize_match(
  p_match_id uuid,
  p_player_id uuid,
  p_final_score numeric
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_match matches%ROWTYPE;
  v_existing_result match_results%ROWTYPE;
  v_me match_players%ROWTYPE;
  v_opp match_players%ROWTYPE;
  v_my_elo int := 1200;
  v_opp_elo int := 1200;
  v_my_score_float float;
  v_my_expected float;
  v_my_delta int;
  v_opp_delta int;
  v_winner uuid := NULL;
  v_outcome text;
BEGIN
  UPDATE match_players
  SET final_score = p_final_score
  WHERE match_id = p_match_id AND profile_id = p_player_id;

  SELECT * INTO v_match FROM matches WHERE id = p_match_id FOR UPDATE;

  IF v_match.status = 'finished' THEN
    SELECT * INTO v_existing_result
    FROM match_results
    WHERE match_id = p_match_id AND profile_id = p_player_id
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'outcome', v_existing_result.outcome,
        'elo_before', v_existing_result.elo_before,
        'elo_after', v_existing_result.elo_after,
        'rating_delta', v_existing_result.score_delta,
        'your_score', v_existing_result.score,
        'opp_score', v_existing_result.opponent_score
      );
    END IF;
  END IF;

  SELECT * INTO v_me FROM match_players WHERE match_id = p_match_id AND profile_id = p_player_id;
  SELECT * INTO v_opp FROM match_players WHERE match_id = p_match_id AND profile_id != p_player_id;

  SELECT elo INTO v_my_elo FROM competitive_ratings WHERE profile_id = p_player_id;
  IF v_my_elo IS NULL THEN v_my_elo := 1200; END IF;

  SELECT elo INTO v_opp_elo FROM competitive_ratings WHERE profile_id = v_opp.profile_id;
  IF v_opp_elo IS NULL THEN v_opp_elo := 1200; END IF;

  IF v_me.final_score > v_opp.final_score THEN
    v_winner := p_player_id;
    v_my_score_float := 1.0;
    v_outcome := 'win';
  ELSIF v_me.final_score < v_opp.final_score THEN
    v_winner := v_opp.profile_id;
    v_my_score_float := 0.0;
    v_outcome := 'loss';
  ELSE
    v_winner := NULL;
    v_my_score_float := 0.5;
    v_outcome := 'tie';
  END IF;

  v_my_expected := 1.0 / (1.0 + power(10.0, (v_opp_elo - v_my_elo)::float / 400.0));
  v_my_delta := round(32.0 * (v_my_score_float - v_my_expected))::int;
  v_opp_delta := -v_my_delta;

  UPDATE matches
  SET status = 'finished', ended_at = now(), winner_id = v_winner
  WHERE id = p_match_id;

  INSERT INTO competitive_ratings (profile_id, elo, updated_at, matches_played, wins, losses, ties)
  VALUES (
    p_player_id,
    GREATEST(0, v_my_elo + v_my_delta),
    now(), 1,
    CASE WHEN v_outcome = 'win' THEN 1 ELSE 0 END,
    CASE WHEN v_outcome = 'loss' THEN 1 ELSE 0 END,
    CASE WHEN v_outcome = 'tie' THEN 1 ELSE 0 END
  )
  ON CONFLICT (profile_id) DO UPDATE SET
    elo = GREATEST(0, competitive_ratings.elo + v_my_delta),
    updated_at = now(),
    matches_played = COALESCE(competitive_ratings.matches_played, 0) + 1,
    wins = COALESCE(competitive_ratings.wins, 0) + (CASE WHEN v_outcome = 'win' THEN 1 ELSE 0 END),
    losses = COALESCE(competitive_ratings.losses, 0) + (CASE WHEN v_outcome = 'loss' THEN 1 ELSE 0 END),
    ties = COALESCE(competitive_ratings.ties, 0) + (CASE WHEN v_outcome = 'tie' THEN 1 ELSE 0 END);

  INSERT INTO competitive_ratings (profile_id, elo, updated_at, matches_played, wins, losses, ties)
  VALUES (
    v_opp.profile_id,
    GREATEST(0, v_opp_elo + v_opp_delta),
    now(), 1,
    CASE WHEN v_outcome = 'loss' THEN 1 ELSE 0 END,
    CASE WHEN v_outcome = 'win' THEN 1 ELSE 0 END,
    CASE WHEN v_outcome = 'tie' THEN 1 ELSE 0 END
  )
  ON CONFLICT (profile_id) DO UPDATE SET
    elo = GREATEST(0, competitive_ratings.elo + v_opp_delta),
    updated_at = now(),
    matches_played = COALESCE(competitive_ratings.matches_played, 0) + 1,
    wins = COALESCE(competitive_ratings.wins, 0) + (CASE WHEN v_outcome = 'loss' THEN 1 ELSE 0 END),
    losses = COALESCE(competitive_ratings.losses, 0) + (CASE WHEN v_outcome = 'win' THEN 1 ELSE 0 END),
    ties = COALESCE(competitive_ratings.ties, 0) + (CASE WHEN v_outcome = 'tie' THEN 1 ELSE 0 END);

  INSERT INTO match_results (match_id, profile_id, outcome, elo_before, elo_after, score_delta, score, opponent_score)
  VALUES
    (p_match_id, p_player_id, v_outcome, v_my_elo, GREATEST(0, v_my_elo + v_my_delta), v_my_delta, v_me.final_score, v_opp.final_score),
    (p_match_id, v_opp.profile_id, CASE WHEN v_outcome = 'win' THEN 'loss' WHEN v_outcome = 'loss' THEN 'win' ELSE 'tie' END, v_opp_elo, GREATEST(0, v_opp_elo + v_opp_delta), v_opp_delta, v_opp.final_score, v_me.final_score);

  RETURN jsonb_build_object(
    'outcome', v_outcome,
    'elo_before', v_my_elo,
    'elo_after', GREATEST(0, v_my_elo + v_my_delta),
    'rating_delta', v_my_delta,
    'your_score', v_me.final_score,
    'opp_score', v_opp.final_score
  );
END;
$$;

-- H2H Forfeit Match RPC
CREATE OR REPLACE FUNCTION h2h_forfeit_match(
  p_match_id uuid,
  p_player_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE match_players
  SET disconnected = true, final_score = -99
  WHERE match_id = p_match_id AND profile_id = p_player_id;

  RETURN h2h_finalize_match(p_match_id, p_player_id, -99);
END;
$$;

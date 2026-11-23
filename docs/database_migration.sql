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

-- 2. Fix the infinite recursion in Admin policy & harden auth_is_admin()
DROP POLICY IF EXISTS "Admins can read all profiles" ON profiles;

CREATE OR REPLACE FUNCTION public.auth_is_admin() RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(bool_or(is_admin), false) FROM profiles WHERE auth_uid = auth.uid();
$$;

CREATE POLICY "Admins can read all profiles" ON profiles
    FOR ALL USING (auth_is_admin());

-- Deduplicate profiles insert/update policies & protect is_admin / auth_uid from direct tampering
DROP POLICY IF EXISTS "Users can insert their own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON profiles;

DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
CREATE POLICY "Users can insert own profile" ON profiles
  FOR INSERT WITH CHECK (auth_uid = auth.uid() AND COALESCE(is_admin, false) = false);

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth_uid = auth.uid())
  WITH CHECK (auth_uid = auth.uid());

CREATE OR REPLACE FUNCTION public.protect_profile_sensitive_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_jwt_role text := COALESCE(current_setting('request.jwt.claim.role', true), '');
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'service_role') OR v_jwt_role = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.is_admin := false;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.password_hash IS NOT NULL AND NEW.password_hash IS NULL THEN
      NEW.password_hash := OLD.password_hash;
    END IF;
    IF NOT COALESCE(auth_is_admin(), false) THEN
      IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
        RAISE EXCEPTION 'Permission denied: cannot modify is_admin';
      END IF;
      IF NEW.auth_uid IS DISTINCT FROM OLD.auth_uid THEN
        RAISE EXCEPTION 'Permission denied: cannot reassign auth_uid directly';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_sensitive_columns ON profiles;
CREATE TRIGGER trg_protect_profile_sensitive_columns
  BEFORE INSERT OR UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_sensitive_columns();

-- Safe public leaderboard view & opponent lookup RPC (excludes parent_email, password_hash, auth_uid, link_code)
CREATE OR REPLACE VIEW public.leaderboard_profiles AS
SELECT
  player_id, handle, country, stats, cr, birth_year, avatar_face, avatar_svg, created_at
FROM public.profiles
WHERE COALESCE(frozen, false) = false;

GRANT SELECT ON public.leaderboard_profiles TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_public_profile(p_player_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row RECORD;
BEGIN
  SELECT
    player_id, handle, country, stats, cr, birth_year,
    avatar_face, avatar_svg, avatar_selections, unlocked_avatar,
    badges, accessories, created_at, updated_at
  INTO v_row
  FROM profiles
  WHERE player_id = p_player_id AND COALESCE(frozen, false) = false
  LIMIT 1;

  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN row_to_json(v_row)::jsonb;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_profile(uuid) TO anon, authenticated;

-- Authenticated owner-scoped RLS policies for player_notes
DROP POLICY IF EXISTS "notes_auth_select" ON player_notes;
CREATE POLICY "notes_auth_select" ON player_notes
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.player_id::text = player_notes.profile_id
        AND p.auth_uid = auth.uid()
    )
    OR auth_is_admin()
  );

DROP POLICY IF EXISTS "notes_auth_insert" ON player_notes;
CREATE POLICY "notes_auth_insert" ON player_notes
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.player_id::text = player_notes.profile_id
        AND p.auth_uid = auth.uid()
    )
    OR auth_is_admin()
  );

DROP POLICY IF EXISTS "notes_auth_update" ON player_notes;
CREATE POLICY "notes_auth_update" ON player_notes
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.player_id::text = player_notes.profile_id
        AND p.auth_uid = auth.uid()
    )
    OR auth_is_admin()
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.player_id::text = player_notes.profile_id
        AND p.auth_uid = auth.uid()
    )
    OR auth_is_admin()
  );

DROP POLICY IF EXISTS "notes_auth_delete" ON player_notes;
CREATE POLICY "notes_auth_delete" ON player_notes
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.player_id::text = player_notes.profile_id
        AND p.auth_uid = auth.uid()
    )
    OR auth_is_admin()
  );

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

  RETURN jsonb_build_object(
    'player_id', v_profile.player_id,
    'auth_uid', v_profile.auth_uid,
    'handle', v_profile.handle,
    'birth_year', v_profile.birth_year,
    'country', v_profile.country,
    'stats', v_profile.stats,
    'cr', v_profile.cr,
    'badges', v_profile.badges,
    'accessories', v_profile.accessories,
    'avatar_face', v_profile.avatar_face,
    'avatar_svg', v_profile.avatar_svg,
    'avatar_selections', v_profile.avatar_selections,
    'unlocked_avatar', v_profile.unlocked_avatar,
    'parent_email', v_profile.parent_email,
    'frozen', COALESCE(v_profile.frozen, false),
    'is_admin', COALESCE(v_profile.is_admin, false),
    'created_at', v_profile.created_at,
    'updated_at', v_profile.updated_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.restore_profile(text, text) TO authenticated;

-- Legacy email-only restore removed (replaced by tokenized recovery)
DROP FUNCTION IF EXISTS public.restore_profile_by_email(text);

-- 3b. Tokenized Account Recovery Table & RPCs (Version-Controlled Source of Truth)
CREATE TABLE IF NOT EXISTS public.recovery_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE,
  player_id uuid NOT NULL REFERENCES public.profiles(player_id) ON DELETE CASCADE,
  email text NOT NULL,
  expires_at timestamptz NOT NULL,
  used boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recovery_tokens_email_created_at
  ON public.recovery_tokens (email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recovery_tokens_player_email_created_at
  ON public.recovery_tokens (player_id, email, created_at DESC);

-- Lock recovery_tokens to service_role and SECURITY DEFINER RPCs only (0 public policies)
ALTER TABLE public.recovery_tokens ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.verify_recovery_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) < 16 THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Invalid token');
  END IF;

  SELECT rt.id, rt.player_id, rt.expires_at, rt.used, p.handle, p.frozen
  INTO v_row
  FROM public.recovery_tokens rt
  JOIN public.profiles p ON p.player_id = rt.player_id
  WHERE rt.token = trim(p_token)
    AND rt.used = false
    AND rt.expires_at > now()
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Token expired or already used');
  END IF;

  IF COALESCE(v_row.frozen, false) = true THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Profile is frozen');
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'handle', v_row.handle
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_recovery_token(text) TO anon, authenticated;

-- Note: p_auth_uid is accepted only as a deprecated optional parameter for backwards compatibility
-- with older clients; the RPC strictly binds ownership to auth.uid() and ignores p_auth_uid.
CREATE OR REPLACE FUNCTION public.complete_recovery(
  p_token text,
  p_new_password_hash text,
  p_auth_uid uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_uid uuid := auth.uid();
  v_player_id uuid;
  v_profile public.profiles%ROWTYPE;
BEGIN
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_token IS NULL OR length(trim(p_token)) < 16 THEN
    RAISE EXCEPTION 'Invalid or expired recovery token';
  END IF;

  IF p_new_password_hash IS NULL OR length(trim(p_new_password_hash)) < 16 THEN
    RAISE EXCEPTION 'Invalid password hash';
  END IF;

  -- Atomically consume the single-use recovery token
  UPDATE public.recovery_tokens
  SET used = true
  WHERE token = trim(p_token)
    AND used = false
    AND expires_at > now()
  RETURNING player_id INTO v_player_id;

  IF v_player_id IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired recovery token';
  END IF;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE player_id = v_player_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  IF COALESCE(v_profile.frozen, false) = true THEN
    RAISE EXCEPTION 'Profile is frozen';
  END IF;

  UPDATE public.profiles
  SET password_hash = p_new_password_hash,
      auth_uid = v_auth_uid,
      recovery_created_at = now(),
      updated_at = now()
  WHERE player_id = v_player_id
  RETURNING * INTO v_profile;

  RETURN jsonb_build_object(
    'player_id', v_profile.player_id,
    'auth_uid', v_profile.auth_uid,
    'handle', v_profile.handle,
    'birth_year', v_profile.birth_year,
    'country', v_profile.country,
    'stats', v_profile.stats,
    'cr', v_profile.cr,
    'badges', v_profile.badges,
    'accessories', v_profile.accessories,
    'avatar_face', v_profile.avatar_face,
    'avatar_svg', v_profile.avatar_svg,
    'avatar_selections', v_profile.avatar_selections,
    'unlocked_avatar', v_profile.unlocked_avatar,
    'parent_email', v_profile.parent_email,
    'frozen', COALESCE(v_profile.frozen, false),
    'is_admin', COALESCE(v_profile.is_admin, false),
    'created_at', v_profile.created_at,
    'updated_at', v_profile.updated_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_recovery(text, text, uuid) TO authenticated;

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

-- H2H Join Queue RPC (drop legacy 3-arg overload first)
DROP FUNCTION IF EXISTS public.h2h_join_queue(uuid, integer, jsonb);

CREATE OR REPLACE FUNCTION public.h2h_join_queue(
  p_player_id uuid,
  p_tier int,
  p_card_sequence jsonb DEFAULT NULL,
  p_profile_data jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_auth_uid uuid := auth.uid();
  v_owner_uid uuid;
  v_opp_queue RECORD;
  v_lower_tier int;
  v_card_seq jsonb;
  v_match_id uuid;
  v_queue_id uuid;
  v_safe_handle text;
BEGIN
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'h2h_join_queue: not authenticated';
  END IF;

  -- Verify profile ownership if profile already exists
  SELECT auth_uid INTO v_owner_uid FROM profiles WHERE player_id = p_player_id;
  IF FOUND THEN
    IF v_owner_uid IS NOT NULL AND v_owner_uid != v_auth_uid THEN
      RAISE EXCEPTION 'h2h_join_queue: unauthorized player_id';
    END IF;
    IF p_profile_data IS NOT NULL THEN
      UPDATE profiles SET
        auth_uid = COALESCE(auth_uid, v_auth_uid),
        avatar_svg = COALESCE(p_profile_data->>'avatar_svg', avatar_svg),
        avatar_face = COALESCE(p_profile_data->>'avatar_face', avatar_face),
        avatar_selections = COALESCE(p_profile_data->'avatar_selections', avatar_selections),
        stats = COALESCE(p_profile_data->'stats', stats),
        cr = COALESCE((p_profile_data->'stats'->'h2h'->>'rating')::int, (p_profile_data->>'rating')::int, cr)
      WHERE player_id = p_player_id AND (auth_uid IS NULL OR auth_uid = v_auth_uid);
    ELSE
      UPDATE profiles SET auth_uid = v_auth_uid WHERE player_id = p_player_id AND (auth_uid IS NULL OR auth_uid = v_auth_uid);
    END IF;
  ELSE
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
      auth_uid = COALESCE(profiles.auth_uid, EXCLUDED.auth_uid),
      avatar_svg = COALESCE(EXCLUDED.avatar_svg, profiles.avatar_svg),
      avatar_face = COALESCE(EXCLUDED.avatar_face, profiles.avatar_face),
      avatar_selections = COALESCE(EXCLUDED.avatar_selections, profiles.avatar_selections),
      stats = COALESCE(EXCLUDED.stats, profiles.stats),
      cr = COALESCE(EXCLUDED.cr, profiles.cr)
    WHERE profiles.auth_uid IS NULL OR profiles.auth_uid = v_auth_uid;
  END IF;

  -- Expire stale active matches older than 60s
  UPDATE matches
  SET status = 'finished', ended_at = now()
  WHERE status = 'active' AND started_at < now() - interval '60 seconds';

  -- Clean up expired queue entries older than 60s
  DELETE FROM match_queue WHERE entered_at < now() - interval '60 seconds';

  -- Mark caller finished in all prior matches
  UPDATE match_players
  SET finished_at = COALESCE(finished_at, now())
  WHERE profile_id = p_player_id;

  UPDATE matches m
  SET status = 'finished', ended_at = now()
  WHERE m.status = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM match_players mp WHERE mp.match_id = m.id AND mp.finished_at IS NULL
    );

  -- Pair against an existing queued opponent if available
  SELECT mq.*, p.handle as opp_handle, p.avatar_svg as opp_svg, p.avatar_face as opp_face,
         p.avatar_selections as opp_selections, p.stats as opp_stats, p.country as opp_country, p.birth_year as opp_birth_year,
         COALESCE((p.stats->'h2h'->>'rating')::int, cr.elo, NULLIF(p.cr, 0), 1200) as opp_elo,
         COALESCE((p.stats->'h2h'->>'matches')::int, cr.matches_played, (COALESCE((p.stats->'h2h'->>'wins')::int, 0) + COALESCE((p.stats->'h2h'->>'losses')::int, 0) + COALESCE((p.stats->'h2h'->>'ties')::int, 0)), 0) as opp_matches,
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
        'matches', v_opp_queue.opp_matches,
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
CREATE OR REPLACE FUNCTION public.h2h_poll_queue(
  p_player_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_auth_uid uuid := auth.uid();
  v_matched RECORD;
  v_in_queue boolean;
BEGIN
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'h2h_poll_queue: not authenticated';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM profiles WHERE player_id = p_player_id AND auth_uid = v_auth_uid) THEN
    RAISE EXCEPTION 'h2h_poll_queue: unauthorized player_id';
  END IF;

  SELECT EXISTS(SELECT 1 FROM match_queue WHERE profile_id = p_player_id) INTO v_in_queue;
  IF v_in_queue THEN
    RETURN jsonb_build_object('status', 'waiting');
  END IF;

  SELECT m.id, m.card_pool_tier, m.status, m.started_at, m.card_sequence_json,
         p.player_id as opp_id, p.handle as opp_handle, p.avatar_svg as opp_svg, p.avatar_face as opp_face,
         p.avatar_selections as opp_selections, p.stats as opp_stats, p.country as opp_country, p.birth_year as opp_birth_year,
         COALESCE((p.stats->'h2h'->>'rating')::int, cr.elo, NULLIF(p.cr, 0), 1200) as opp_elo,
         COALESCE((p.stats->'h2h'->>'matches')::int, cr.matches_played, (COALESCE((p.stats->'h2h'->>'wins')::int, 0) + COALESCE((p.stats->'h2h'->>'losses')::int, 0) + COALESCE((p.stats->'h2h'->>'ties')::int, 0)), 0) as opp_matches,
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
    AND mp_me.finished_at IS NULL
    AND mp_me.disconnected = false
    AND m.started_at > now() - interval '25 seconds'
  ORDER BY m.started_at DESC
  LIMIT 1;

  IF FOUND THEN
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
        'matches', v_matched.opp_matches,
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

-- H2H Leave Queue RPC
CREATE OR REPLACE FUNCTION public.h2h_leave_queue(
  p_player_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_auth_uid uuid := auth.uid();
BEGIN
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'h2h_leave_queue: not authenticated';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM profiles WHERE player_id = p_player_id AND auth_uid = v_auth_uid) THEN
    RAISE EXCEPTION 'h2h_leave_queue: unauthorized player_id';
  END IF;

  DELETE FROM match_queue WHERE profile_id = p_player_id;
  UPDATE match_players
  SET finished_at = COALESCE(finished_at, now()), disconnected = true
  WHERE profile_id = p_player_id
    AND match_id IN (SELECT id FROM matches WHERE status = 'active');
  RETURN jsonb_build_object('success', true);
END;
$$;

-- H2H Finalize Match RPC
CREATE OR REPLACE FUNCTION public.h2h_finalize_match(
  p_match_id uuid,
  p_player_id uuid,
  p_final_score numeric
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_auth_uid uuid := auth.uid();
  v_match matches%ROWTYPE;
  v_existing_result match_results%ROWTYPE;
  v_me match_players%ROWTYPE;
  v_opp match_players%ROWTYPE;
  v_my_elo int := 1200;
  v_my_matches int := 0;
  v_my_wins int := 0;
  v_my_losses int := 0;
  v_my_ties int := 0;
  v_opp_elo int := 1200;
  v_opp_matches int := 0;
  v_opp_wins int := 0;
  v_opp_losses int := 0;
  v_opp_ties int := 0;
  v_opp_correct int := 0;
  v_opp_wrong int := 0;
  v_my_score_float float;
  v_my_expected float;
  v_my_delta int;
  v_opp_delta int;
  v_winner uuid := NULL;
  v_outcome text;
BEGIN
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'h2h_finalize_match: not authenticated';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM profiles WHERE player_id = p_player_id AND auth_uid = v_auth_uid) THEN
    RAISE EXCEPTION 'h2h_finalize_match: unauthorized player_id';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM match_players WHERE match_id = p_match_id AND profile_id = p_player_id) THEN
    RAISE EXCEPTION 'h2h_finalize_match: not a participant in match';
  END IF;

  UPDATE match_players
  SET final_score = p_final_score,
      finished_at = COALESCE(finished_at, now())
  WHERE match_id = p_match_id AND profile_id = p_player_id;

  SELECT * INTO v_match FROM matches WHERE id = p_match_id FOR UPDATE;
  SELECT * INTO v_me FROM match_players WHERE match_id = p_match_id AND profile_id = p_player_id;
  SELECT * INTO v_opp FROM match_players WHERE match_id = p_match_id AND profile_id != p_player_id;

  SELECT
    COALESCE(cr.elo, (p.stats->'h2h'->>'rating')::int, NULLIF(p.cr, 0), 1200),
    COALESCE(cr.matches_played, (p.stats->'h2h'->>'matches')::int, ((COALESCE((p.stats->'h2h'->>'wins')::int, 0) + COALESCE((p.stats->'h2h'->>'losses')::int, 0) + COALESCE((p.stats->'h2h'->>'ties')::int, 0))), 0),
    COALESCE(cr.wins, (p.stats->'h2h'->>'wins')::int, 0),
    COALESCE(cr.losses, (p.stats->'h2h'->>'losses')::int, 0),
    COALESCE(cr.ties, (p.stats->'h2h'->>'ties')::int, 0)
  INTO v_my_elo, v_my_matches, v_my_wins, v_my_losses, v_my_ties
  FROM profiles p
  LEFT JOIN competitive_ratings cr ON cr.profile_id = p.player_id
  WHERE p.player_id = p_player_id;

  SELECT
    COALESCE(cr.elo, (p.stats->'h2h'->>'rating')::int, NULLIF(p.cr, 0), 1200),
    COALESCE(cr.matches_played, (p.stats->'h2h'->>'matches')::int, ((COALESCE((p.stats->'h2h'->>'wins')::int, 0) + COALESCE((p.stats->'h2h'->>'losses')::int, 0) + COALESCE((p.stats->'h2h'->>'ties')::int, 0))), 0),
    COALESCE(cr.wins, (p.stats->'h2h'->>'wins')::int, 0),
    COALESCE(cr.losses, (p.stats->'h2h'->>'losses')::int, 0),
    COALESCE(cr.ties, (p.stats->'h2h'->>'ties')::int, 0)
  INTO v_opp_elo, v_opp_matches, v_opp_wins, v_opp_losses, v_opp_ties
  FROM profiles p
  LEFT JOIN competitive_ratings cr ON cr.profile_id = p.player_id
  WHERE p.player_id = v_opp.profile_id;

  SELECT
    COALESCE(count(*) FILTER (WHERE correct = true), 0),
    COALESCE(count(*) FILTER (WHERE correct = false), 0)
  INTO v_opp_correct, v_opp_wrong
  FROM match_events
  WHERE match_id = p_match_id AND profile_id = v_opp.profile_id;

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
        'opp_score', v_existing_result.opponent_score,
        'opp_elo_before', v_opp_elo,
        'opp_elo_after', v_opp_elo,
        'opp_rating_delta', -v_existing_result.score_delta,
        'opp_matches', v_opp_matches,
        'opp_wins', v_opp_wins,
        'opp_losses', v_opp_losses,
        'opp_ties', v_opp_ties,
        'opp_correct', v_opp_correct,
        'opp_wrong', v_opp_wrong
      );
    END IF;
  END IF;

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

  UPDATE match_players
  SET finished_at = COALESCE(finished_at, now())
  WHERE match_id = p_match_id AND profile_id = v_opp.profile_id AND finished_at IS NULL;

  INSERT INTO competitive_ratings (profile_id, elo, updated_at, matches_played, wins, losses, ties)
  VALUES (
    p_player_id,
    GREATEST(0, v_my_elo + v_my_delta),
    now(),
    v_my_matches + 1,
    v_my_wins + (CASE WHEN v_outcome = 'win' THEN 1 ELSE 0 END),
    v_my_losses + (CASE WHEN v_outcome = 'loss' THEN 1 ELSE 0 END),
    v_my_ties + (CASE WHEN v_outcome = 'tie' THEN 1 ELSE 0 END)
  )
  ON CONFLICT (profile_id) DO UPDATE SET
    elo = GREATEST(0, competitive_ratings.elo + v_my_delta),
    updated_at = now(),
    matches_played = COALESCE(competitive_ratings.matches_played, v_my_matches) + 1,
    wins = COALESCE(competitive_ratings.wins, v_my_wins) + (CASE WHEN v_outcome = 'win' THEN 1 ELSE 0 END),
    losses = COALESCE(competitive_ratings.losses, v_my_losses) + (CASE WHEN v_outcome = 'loss' THEN 1 ELSE 0 END),
    ties = COALESCE(competitive_ratings.ties, v_my_ties) + (CASE WHEN v_outcome = 'tie' THEN 1 ELSE 0 END);

  INSERT INTO competitive_ratings (profile_id, elo, updated_at, matches_played, wins, losses, ties)
  VALUES (
    v_opp.profile_id,
    GREATEST(0, v_opp_elo + v_opp_delta),
    now(),
    v_opp_matches + 1,
    v_opp_wins + (CASE WHEN v_outcome = 'loss' THEN 1 ELSE 0 END),
    v_opp_losses + (CASE WHEN v_outcome = 'win' THEN 1 ELSE 0 END),
    v_opp_ties + (CASE WHEN v_outcome = 'tie' THEN 1 ELSE 0 END)
  )
  ON CONFLICT (profile_id) DO UPDATE SET
    elo = GREATEST(0, competitive_ratings.elo + v_opp_delta),
    updated_at = now(),
    matches_played = COALESCE(competitive_ratings.matches_played, v_opp_matches) + 1,
    wins = COALESCE(competitive_ratings.wins, v_opp_wins) + (CASE WHEN v_outcome = 'loss' THEN 1 ELSE 0 END),
    losses = COALESCE(competitive_ratings.losses, v_opp_losses) + (CASE WHEN v_outcome = 'win' THEN 1 ELSE 0 END),
    ties = COALESCE(competitive_ratings.ties, v_opp_ties) + (CASE WHEN v_outcome = 'tie' THEN 1 ELSE 0 END);

  UPDATE profiles
  SET stats = jsonb_set(
    COALESCE(stats, '{}'::jsonb),
    '{h2h}',
    COALESCE(stats->'h2h', '{}'::jsonb) || jsonb_build_object(
      'rating', GREATEST(0, v_my_elo + v_my_delta),
      'matches', v_my_matches + 1,
      'wins', v_my_wins + (CASE WHEN v_outcome = 'win' THEN 1 ELSE 0 END),
      'losses', v_my_losses + (CASE WHEN v_outcome = 'loss' THEN 1 ELSE 0 END),
      'ties', v_my_ties + (CASE WHEN v_outcome = 'tie' THEN 1 ELSE 0 END)
    ),
    true
  )
  WHERE player_id = p_player_id;

  UPDATE profiles
  SET stats = jsonb_set(
    COALESCE(stats, '{}'::jsonb),
    '{h2h}',
    COALESCE(stats->'h2h', '{}'::jsonb) || jsonb_build_object(
      'rating', GREATEST(0, v_opp_elo + v_opp_delta),
      'matches', v_opp_matches + 1,
      'wins', v_opp_wins + (CASE WHEN v_outcome = 'loss' THEN 1 ELSE 0 END),
      'losses', v_opp_losses + (CASE WHEN v_outcome = 'win' THEN 1 ELSE 0 END),
      'ties', v_opp_ties + (CASE WHEN v_outcome = 'tie' THEN 1 ELSE 0 END)
    ),
    true
  )
  WHERE player_id = v_opp.profile_id;

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
    'opp_score', v_opp.final_score,
    'opp_elo_before', v_opp_elo,
    'opp_elo_after', GREATEST(0, v_opp_elo + v_opp_delta),
    'opp_rating_delta', v_opp_delta,
    'opp_matches', v_opp_matches + 1,
    'opp_wins', v_opp_wins + (CASE WHEN v_outcome = 'loss' THEN 1 ELSE 0 END),
    'opp_losses', v_opp_losses + (CASE WHEN v_outcome = 'win' THEN 1 ELSE 0 END),
    'opp_ties', v_opp_ties + (CASE WHEN v_outcome = 'tie' THEN 1 ELSE 0 END),
    'opp_correct', v_opp_correct,
    'opp_wrong', v_opp_wrong
  );
END;
$$;

-- H2H Forfeit Match RPC
CREATE OR REPLACE FUNCTION public.h2h_forfeit_match(
  p_match_id uuid,
  p_player_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_auth_uid uuid := auth.uid();
BEGIN
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'h2h_forfeit_match: not authenticated';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM profiles WHERE player_id = p_player_id AND auth_uid = v_auth_uid) THEN
    RAISE EXCEPTION 'h2h_forfeit_match: unauthorized player_id';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM match_players WHERE match_id = p_match_id AND profile_id = p_player_id) THEN
    RAISE EXCEPTION 'h2h_forfeit_match: not a participant in match';
  END IF;

  UPDATE match_players
  SET disconnected = true, final_score = -99, finished_at = COALESCE(finished_at, now())
  WHERE match_id = p_match_id AND profile_id = p_player_id;

  RETURN h2h_finalize_match(p_match_id, p_player_id, -99);
END;
$$;


-- Cascading Foreign Key Constraints for Clean Profile Deletion & Dependency Cascade
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_player_id_fkey;
ALTER TABLE sessions ADD CONSTRAINT sessions_player_id_fkey FOREIGN KEY (player_id) REFERENCES profiles(player_id) ON DELETE CASCADE;

ALTER TABLE card_attempts DROP CONSTRAINT IF EXISTS card_attempts_session_id_fkey;
ALTER TABLE card_attempts ADD CONSTRAINT card_attempts_session_id_fkey FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
ALTER TABLE card_attempts DROP CONSTRAINT IF EXISTS card_attempts_player_id_fkey;
ALTER TABLE card_attempts ADD CONSTRAINT card_attempts_player_id_fkey FOREIGN KEY (player_id) REFERENCES profiles(player_id) ON DELETE CASCADE;

ALTER TABLE star_events DROP CONSTRAINT IF EXISTS star_events_session_id_fkey;
ALTER TABLE star_events ADD CONSTRAINT star_events_session_id_fkey FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
ALTER TABLE star_events DROP CONSTRAINT IF EXISTS star_events_player_id_fkey;
ALTER TABLE star_events ADD CONSTRAINT star_events_player_id_fkey FOREIGN KEY (player_id) REFERENCES profiles(player_id) ON DELETE CASCADE;

ALTER TABLE progress DROP CONSTRAINT IF EXISTS progress_player_id_fkey;
ALTER TABLE progress ADD CONSTRAINT progress_player_id_fkey FOREIGN KEY (player_id) REFERENCES profiles(player_id) ON DELETE CASCADE;

ALTER TABLE classroom_members DROP CONSTRAINT IF EXISTS classroom_members_classroom_id_fkey;
ALTER TABLE classroom_members ADD CONSTRAINT classroom_members_classroom_id_fkey FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE CASCADE;
ALTER TABLE classroom_members DROP CONSTRAINT IF EXISTS classroom_members_profile_id_fkey;
ALTER TABLE classroom_members ADD CONSTRAINT classroom_members_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(player_id) ON DELETE CASCADE;

ALTER TABLE match_queue DROP CONSTRAINT IF EXISTS match_queue_profile_id_fkey;
ALTER TABLE match_queue ADD CONSTRAINT match_queue_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(player_id) ON DELETE CASCADE;

ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_winner_id_fkey;
ALTER TABLE matches ADD CONSTRAINT matches_winner_id_fkey FOREIGN KEY (winner_id) REFERENCES profiles(player_id) ON DELETE SET NULL;

ALTER TABLE match_players DROP CONSTRAINT IF EXISTS match_players_match_id_fkey;
ALTER TABLE match_players ADD CONSTRAINT match_players_match_id_fkey FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE;
ALTER TABLE match_players DROP CONSTRAINT IF EXISTS match_players_profile_id_fkey;
ALTER TABLE match_players ADD CONSTRAINT match_players_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(player_id) ON DELETE CASCADE;

ALTER TABLE match_events DROP CONSTRAINT IF EXISTS match_events_match_id_fkey;
ALTER TABLE match_events ADD CONSTRAINT match_events_match_id_fkey FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE;
ALTER TABLE match_events DROP CONSTRAINT IF EXISTS match_events_profile_id_fkey;
ALTER TABLE match_events ADD CONSTRAINT match_events_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(player_id) ON DELETE CASCADE;

ALTER TABLE competitive_ratings DROP CONSTRAINT IF EXISTS competitive_ratings_profile_id_fkey;
ALTER TABLE competitive_ratings ADD CONSTRAINT competitive_ratings_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(player_id) ON DELETE CASCADE;

ALTER TABLE match_results DROP CONSTRAINT IF EXISTS match_results_match_id_fkey;
ALTER TABLE match_results ADD CONSTRAINT match_results_match_id_fkey FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE;
ALTER TABLE match_results DROP CONSTRAINT IF EXISTS match_results_profile_id_fkey;
ALTER TABLE match_results ADD CONSTRAINT match_results_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(player_id) ON DELETE CASCADE;

ALTER TABLE recovery_tokens DROP CONSTRAINT IF EXISTS recovery_tokens_player_id_fkey;
ALTER TABLE recovery_tokens ADD CONSTRAINT recovery_tokens_player_id_fkey FOREIGN KEY (player_id) REFERENCES profiles(player_id) ON DELETE CASCADE;

-- Profile Deletion RPC with permission check
CREATE OR REPLACE FUNCTION delete_profile(p_player_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_auth_uid uuid := auth.uid();
  v_is_admin boolean := false;
  v_profile_owner uuid;
BEGIN
  IF v_auth_uid IS NULL THEN
    IF current_user IN ('postgres', 'service_role') THEN
      DELETE FROM profiles WHERE player_id = p_player_id;
      RETURN true;
    ELSE
      RAISE EXCEPTION 'Not authenticated';
    END IF;
  END IF;

  SELECT auth_uid INTO v_profile_owner
  FROM profiles
  WHERE player_id = p_player_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT COALESCE(bool_or(is_admin), false) INTO v_is_admin
  FROM profiles
  WHERE auth_uid = v_auth_uid;

  IF v_is_admin = true OR v_profile_owner = v_auth_uid THEN
    DELETE FROM profiles WHERE player_id = p_player_id;
    RETURN true;
  ELSE
    RAISE EXCEPTION 'Permission denied: you can only delete your own profiles';
  END IF;
END;
$func$;

GRANT EXECUTE ON FUNCTION public.delete_profile(uuid) TO authenticated;

-- Admin Test Profile Cleanup RPC
CREATE OR REPLACE FUNCTION admin_cleanup_test_profiles()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_auth_uid uuid := auth.uid();
  v_is_admin boolean := false;
  v_deleted_count int := 0;
BEGIN
  IF v_auth_uid IS NULL THEN
    IF current_user NOT IN ('postgres', 'service_role') THEN
      RAISE EXCEPTION 'Not authenticated';
    END IF;
  ELSE
    SELECT COALESCE(bool_or(is_admin), false) INTO v_is_admin
    FROM profiles
    WHERE auth_uid = v_auth_uid;

    IF v_is_admin != true THEN
      RAISE EXCEPTION 'Permission denied: admin only';
    END IF;
  END IF;

  WITH deleted AS (
    DELETE FROM profiles
    WHERE handle LIKE 'Speedy%'
       OR handle LIKE 'Atlas%'
       OR handle LIKE 'P1_%'
       OR handle LIKE 'P2_%'
       OR handle LIKE 'Player-%'
       OR handle LIKE 'test_%'
       OR handle LIKE 'TestP1_%'
       OR handle LIKE 'TestP2_%'
    RETURNING player_id
  )
  SELECT count(*) INTO v_deleted_count FROM deleted;

  RETURN jsonb_build_object('ok', true, 'deleted_count', v_deleted_count);
END;
$func$;

GRANT EXECUTE ON FUNCTION public.admin_cleanup_test_profiles() TO authenticated;

-- H2H Finish Countdown: add finished_at to match_players and update h2h_sync_gameplay
ALTER TABLE match_players ADD COLUMN IF NOT EXISTS finished_at timestamptz;

DROP FUNCTION IF EXISTS public.h2h_sync_gameplay(uuid, uuid, numeric, text, boolean);

CREATE OR REPLACE FUNCTION public.h2h_sync_gameplay(
  p_match_id uuid,
  p_player_id uuid,
  p_score numeric,
  p_card_id text DEFAULT NULL::text,
  p_correct boolean DEFAULT NULL::boolean,
  p_finished boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $func$
DECLARE
  v_auth_uid uuid := auth.uid();
  v_opp_score numeric;
  v_opp_disc boolean;
  v_opp_finished_at timestamptz;
  v_started_at timestamptz;
  v_opp_correct int := 0;
  v_opp_wrong int := 0;
BEGIN
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'h2h_sync_gameplay: not authenticated';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM profiles WHERE player_id = p_player_id AND auth_uid = v_auth_uid) THEN
    RAISE EXCEPTION 'h2h_sync_gameplay: unauthorized player_id';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM match_players WHERE match_id = p_match_id AND profile_id = p_player_id) THEN
    RAISE EXCEPTION 'h2h_sync_gameplay: not a participant in match';
  END IF;

  IF p_finished = true THEN
    UPDATE match_players
    SET final_score = p_score,
        finished_at = COALESCE(finished_at, now())
    WHERE match_id = p_match_id AND profile_id = p_player_id;
  ELSE
    UPDATE match_players
    SET final_score = p_score
    WHERE match_id = p_match_id AND profile_id = p_player_id;
  END IF;

  IF p_card_id IS NOT NULL AND p_correct IS NOT NULL THEN
    INSERT INTO match_events (match_id, profile_id, card_id, correct, score_delta, answered_at)
    VALUES (p_match_id, p_player_id, p_card_id, p_correct, CASE WHEN p_correct THEN 1.0 ELSE -0.5 END, now());
  END IF;

  SELECT mp.final_score, mp.disconnected, mp.finished_at, m.started_at
  INTO v_opp_score, v_opp_disc, v_opp_finished_at, v_started_at
  FROM match_players mp
  JOIN matches m ON m.id = mp.match_id
  WHERE mp.match_id = p_match_id AND mp.profile_id != p_player_id
  LIMIT 1;

  SELECT
    COALESCE(count(*) FILTER (WHERE correct = true), 0),
    COALESCE(count(*) FILTER (WHERE correct = false), 0)
  INTO v_opp_correct, v_opp_wrong
  FROM match_events
  WHERE match_id = p_match_id AND profile_id != p_player_id;

  RETURN jsonb_build_object(
    'opp_score', COALESCE(v_opp_score, 0),
    'opp_correct', v_opp_correct,
    'opp_wrong', v_opp_wrong,
    'opp_disconnected', COALESCE(v_opp_disc, false),
    'opp_finished', (v_opp_finished_at IS NOT NULL),
    'opp_finished_sec_ago', CASE WHEN v_opp_finished_at IS NOT NULL THEN ROUND(EXTRACT(EPOCH FROM (now() - v_opp_finished_at))::numeric, 1) ELSE NULL END,
    'elapsed_sec', EXTRACT(EPOCH FROM (now() - COALESCE(v_started_at, now())))
  );
END;
$func$;

-- H2H Sync Setup with Authoritative Card Sequence Persistence
DROP FUNCTION IF EXISTS public.h2h_sync_setup(uuid, uuid, text, jsonb, boolean);

CREATE OR REPLACE FUNCTION public.h2h_sync_setup(
  p_match_id uuid,
  p_player_id uuid,
  p_continent text,
  p_features jsonb,
  p_ready boolean,
  p_card_sequence jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $func$
DECLARE
  v_auth_uid uuid := auth.uid();
  v_opp RECORD;
  v_card_seq jsonb;
BEGIN
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'h2h_sync_setup: not authenticated';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM profiles WHERE player_id = p_player_id AND auth_uid = v_auth_uid) THEN
    RAISE EXCEPTION 'h2h_sync_setup: unauthorized player_id';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM match_players WHERE match_id = p_match_id AND profile_id = p_player_id) THEN
    RAISE EXCEPTION 'h2h_sync_setup: not a participant in match';
  END IF;

  UPDATE match_players
  SET setup_continent = COALESCE(p_continent, setup_continent, 'globe'),
      setup_features = COALESCE(p_features, setup_features, '{}'::jsonb),
      setup_ready = COALESCE(p_ready, setup_ready, false),
      setup_updated_at = now()
  WHERE match_id = p_match_id AND profile_id = p_player_id;

  IF p_card_sequence IS NOT NULL AND jsonb_array_length(p_card_sequence) > 0 THEN
    UPDATE matches
    SET card_sequence_json = p_card_sequence
    WHERE id = p_match_id AND (card_sequence_json IS NULL OR card_sequence_json = '[]'::jsonb);
  END IF;

  SELECT card_sequence_json INTO v_card_seq
  FROM matches WHERE id = p_match_id;

  SELECT mp.setup_continent, mp.setup_features, mp.setup_ready,
         p.player_id, p.handle, p.avatar_svg, p.avatar_face, p.avatar_selections, p.stats, p.country, p.birth_year,
         COALESCE((p.stats->'h2h'->>'rating')::int, cr.elo, NULLIF(p.cr, 0), 1200) as opp_elo,
         COALESCE((p.stats->'h2h'->>'matches')::int, cr.matches_played, (COALESCE((p.stats->'h2h'->>'wins')::int, 0) + COALESCE((p.stats->'h2h'->>'losses')::int, 0) + COALESCE((p.stats->'h2h'->>'ties')::int, 0)), 0) as opp_matches,
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
      'card_sequence', v_card_seq,
      'opponent', jsonb_build_object(
        'player_id', v_opp.player_id,
        'handle', v_opp.handle,
        'avatar_svg', v_opp.avatar_svg,
        'avatar_face', v_opp.avatar_face,
        'avatar_selections', v_opp.avatar_selections,
        'stats', v_opp.stats,
        'birth_year', v_opp.birth_year,
        'rating', v_opp.opp_elo,
        'matches', v_opp.opp_matches,
        'wins', v_opp.opp_wins,
        'losses', v_opp.opp_losses,
        'ties', v_opp.opp_ties,
        'country', v_opp.country
      )
    );
  ELSE
    RETURN jsonb_build_object(
      'has_opponent', false,
      'card_sequence', v_card_seq
    );
  END IF;
END;
$func$;

-- H2H Endgame Rematch Synchronization (Branch: pre-beta4)
ALTER TABLE match_players ADD COLUMN IF NOT EXISTS rematch_requested boolean DEFAULT false;
ALTER TABLE match_players ADD COLUMN IF NOT EXISTS left_results_screen boolean DEFAULT false;
ALTER TABLE match_players ADD COLUMN IF NOT EXISTS results_heartbeat timestamptz DEFAULT now();
ALTER TABLE matches ADD COLUMN IF NOT EXISTS rematch_match_id uuid;

DROP FUNCTION IF EXISTS public.h2h_rematch_sync(uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.h2h_rematch_sync(
  p_match_id uuid,
  p_player_id uuid,
  p_action text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $func$
DECLARE
  v_auth_uid uuid := auth.uid();
  v_match RECORD;
  v_me RECORD;
  v_opp RECORD;
  v_opp_available boolean := false;
  v_rematch_id uuid := NULL;
  v_tier int := 6;
BEGIN
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'h2h_rematch_sync: not authenticated';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM profiles WHERE player_id = p_player_id AND auth_uid = v_auth_uid) THEN
    RAISE EXCEPTION 'h2h_rematch_sync: unauthorized player_id';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM match_players WHERE match_id = p_match_id AND profile_id = p_player_id) THEN
    RAISE EXCEPTION 'h2h_rematch_sync: not a participant in match';
  END IF;

  IF p_action = 'leave' THEN
    UPDATE match_players
    SET left_results_screen = true
    WHERE match_id = p_match_id AND profile_id = p_player_id;
  ELSIF p_action = 'stay' THEN
    UPDATE match_players
    SET results_heartbeat = now(),
        left_results_screen = false
    WHERE match_id = p_match_id AND profile_id = p_player_id;
  END IF;

  SELECT * INTO v_match FROM matches WHERE id = p_match_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'error', 'message', 'match_not_found');
  END IF;

  SELECT * INTO v_me FROM match_players WHERE match_id = p_match_id AND profile_id = p_player_id;
  SELECT * INTO v_opp FROM match_players WHERE match_id = p_match_id AND profile_id != p_player_id LIMIT 1;

  IF v_opp.profile_id IS NOT NULL THEN
    v_opp_available := (COALESCE(v_opp.left_results_screen, false) = false)
                   AND (v_opp.results_heartbeat IS NOT NULL AND v_opp.results_heartbeat >= now() - interval '15 seconds');
  END IF;

  IF v_match.rematch_match_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status', 'rematch_accepted',
      'rematch_match_id', v_match.rematch_match_id,
      'opp_available', v_opp_available,
      'you_requested', true,
      'opp_requested', true
    );
  END IF;

  IF p_action = 'request' THEN
    IF NOT v_opp_available THEN
      RETURN jsonb_build_object(
        'status', 'opponent_left',
        'opp_available', false,
        'you_requested', false,
        'opp_requested', false
      );
    END IF;

    UPDATE match_players
    SET rematch_requested = true,
        results_heartbeat = now(),
        left_results_screen = false
    WHERE match_id = p_match_id AND profile_id = p_player_id;
    v_me.rematch_requested := true;

    IF COALESCE(v_opp.rematch_requested, false) = true THEN
      v_tier := COALESCE(v_match.card_pool_tier, 6);
      
      INSERT INTO matches (card_pool_tier, status, started_at, is_ranked)
      VALUES (v_tier, 'active', now(), COALESCE(v_match.is_ranked, true))
      RETURNING id INTO v_rematch_id;

      UPDATE matches
      SET rematch_match_id = v_rematch_id
      WHERE id = p_match_id;

      INSERT INTO match_players (match_id, profile_id, setup_continent, setup_features, setup_ready)
      VALUES 
        (v_rematch_id, v_me.profile_id, COALESCE(v_me.setup_continent, 'globe'), COALESCE(v_me.setup_features, '{}'::jsonb), false),
        (v_rematch_id, v_opp.profile_id, COALESCE(v_opp.setup_continent, 'globe'), COALESCE(v_opp.setup_features, '{}'::jsonb), false);

      RETURN jsonb_build_object(
        'status', 'rematch_accepted',
        'rematch_match_id', v_rematch_id,
        'is_ranked', COALESCE(v_match.is_ranked, true),
        'opp_available', true,
        'you_requested', true,
        'opp_requested', true
      );
    ELSE
      RETURN jsonb_build_object(
        'status', 'pulsing',
        'opp_available', true,
        'you_requested', true,
        'opp_requested', false
      );
    END IF;
  END IF;

  IF v_match.rematch_match_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status', 'rematch_accepted',
      'rematch_match_id', v_match.rematch_match_id,
      'is_ranked', COALESCE(v_match.is_ranked, true),
      'opp_available', v_opp_available,
      'you_requested', COALESCE(v_me.rematch_requested, false),
      'opp_requested', COALESCE(v_opp.rematch_requested, false)
    );
  END IF;

  IF COALESCE(v_opp.rematch_requested, false) = true AND v_opp_available THEN
    RETURN jsonb_build_object(
      'status', 'pulsing',
      'opp_available', true,
      'you_requested', COALESCE(v_me.rematch_requested, false),
      'opp_requested', true
    );
  END IF;

  IF COALESCE(v_me.rematch_requested, false) = true THEN
    IF NOT v_opp_available THEN
      RETURN jsonb_build_object(
        'status', 'opponent_left',
        'opp_available', false,
        'you_requested', true,
        'opp_requested', false
      );
    ELSE
      RETURN jsonb_build_object(
        'status', 'pulsing',
        'opp_available', true,
        'you_requested', true,
        'opp_requested', false
      );
    END IF;
  END IF;

  IF NOT v_opp_available THEN
    RETURN jsonb_build_object(
      'status', 'opponent_left',
      'opp_available', false,
      'you_requested', false,
      'opp_requested', false
    );
  ELSE
    RETURN jsonb_build_object(
      'status', 'idle',
      'opp_available', true,
      'you_requested', false,
      'opp_requested', false
    );
  END IF;
END;
$func$;

-- ============================================================================
-- PRE-BETA6: Compliance-Safe Friend Linking, Exact Handle Lookup & Private H2H
-- ============================================================================

-- 1. Profile columns for Friend Code & Privacy Opt-In
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS friend_code text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS allow_friend_requests boolean NOT NULL DEFAULT true;

-- 2. Match ranked/unranked flag (default true for backward compatibility with quick matchmaking)
ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS is_ranked boolean NOT NULL DEFAULT true;

-- 3. Unambiguous Friend Code generator (excludes 0, O, 1, I)
CREATE OR REPLACE FUNCTION public.generate_mapolis_friend_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  v_attempt int := 0;
  v_i int;
BEGIN
  LOOP
    v_attempt := v_attempt + 1;
    v_code := 'MAP-';
    FOR v_i IN 1..4 LOOP
      v_code := v_code || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE friend_code = v_code) THEN
      RETURN v_code;
    END IF;
    IF v_attempt > 40 THEN
      v_code := 'MAP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
      RETURN v_code;
    END IF;
  END LOOP;
END;
$func$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_friend_code
  ON public.profiles (friend_code)
  WHERE friend_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_handle_lower
  ON public.profiles (lower(handle));

-- Backfill existing profiles without a friend_code
UPDATE public.profiles
SET friend_code = public.generate_mapolis_friend_code()
WHERE friend_code IS NULL;

-- Update profile protection trigger to auto-populate friend_code on INSERT and block direct spoofing on UPDATE
CREATE OR REPLACE FUNCTION public.protect_profile_sensitive_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $func$
DECLARE
  v_jwt_role text := COALESCE(current_setting('request.jwt.claim.role', true), '');
  v_allow_fc text := COALESCE(current_setting('mapolis.allow_friend_code_update', true), '');
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'service_role') OR v_jwt_role = 'service_role' THEN
    IF TG_OP = 'INSERT' AND NEW.friend_code IS NULL THEN
      NEW.friend_code := public.generate_mapolis_friend_code();
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.is_admin := false;
    NEW.friend_code := public.generate_mapolis_friend_code();
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.password_hash IS NOT NULL AND NEW.password_hash IS NULL THEN
      NEW.password_hash := OLD.password_hash;
    END IF;
    IF NEW.friend_code IS DISTINCT FROM OLD.friend_code AND v_allow_fc <> '1' THEN
      NEW.friend_code := OLD.friend_code;
    END IF;
    IF NOT COALESCE(auth_is_admin(), false) THEN
      IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
        RAISE EXCEPTION 'Permission denied: cannot modify is_admin';
      END IF;
      IF NEW.auth_uid IS DISTINCT FROM OLD.auth_uid THEN
        RAISE EXCEPTION 'Permission denied: cannot reassign auth_uid directly';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$func$;

-- 4. Friend Links Table (Mutual Opt-In + Bi-Directional Block, Zero Chat)
CREATE TABLE IF NOT EXISTS public.friend_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES public.profiles(player_id) ON DELETE CASCADE,
  addressee_id uuid NOT NULL REFERENCES public.profiles(player_id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending', 'accepted', 'blocked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT friend_links_no_self CHECK (requester_id <> addressee_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_friend_links_canonical_pair
  ON public.friend_links (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id));

CREATE INDEX IF NOT EXISTS idx_friend_links_requester ON public.friend_links (requester_id, status);
CREATE INDEX IF NOT EXISTS idx_friend_links_addressee ON public.friend_links (addressee_id, status);

ALTER TABLE public.friend_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "friend_links_participant_select" ON public.friend_links;
CREATE POLICY "friend_links_participant_select" ON public.friend_links
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.auth_uid = auth.uid()
        AND p.player_id IN (friend_links.requester_id, friend_links.addressee_id)
    )
    OR auth_is_admin()
  );

-- 5. Private H2H Rooms & Direct Friend/Leaderboard Challenges Table
CREATE TABLE IF NOT EXISTS public.h2h_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_code text NOT NULL UNIQUE,
  host_id uuid NOT NULL REFERENCES public.profiles(player_id) ON DELETE CASCADE,
  guest_id uuid REFERENCES public.profiles(player_id) ON DELETE SET NULL,
  target_player_id uuid REFERENCES public.profiles(player_id) ON DELETE CASCADE,
  is_ranked boolean NOT NULL DEFAULT false,
  tier int NOT NULL DEFAULT 6,
  card_sequence_json jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'matched', 'cancelled', 'declined', 'expired')),
  match_id uuid REFERENCES public.matches(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_h2h_rooms_target_open
  ON public.h2h_rooms (target_player_id, status, expires_at DESC)
  WHERE target_player_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_h2h_rooms_host_open
  ON public.h2h_rooms (host_id, status, expires_at DESC);

ALTER TABLE public.h2h_rooms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "h2h_rooms_participant_select" ON public.h2h_rooms;
CREATE POLICY "h2h_rooms_participant_select" ON public.h2h_rooms
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.auth_uid = auth.uid()
        AND p.player_id IN (h2h_rooms.host_id, h2h_rooms.guest_id, h2h_rooms.target_player_id)
    )
    OR auth_is_admin()
  );

-- Helper to generate a unique 6-character room code (unambiguous chars)
CREATE OR REPLACE FUNCTION public.generate_h2h_room_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text;
  v_i int;
  v_attempt int := 0;
BEGIN
  LOOP
    v_attempt := v_attempt + 1;
    v_code := '';
    FOR v_i IN 1..6 LOOP
      v_code := v_code || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM public.h2h_rooms WHERE room_code = v_code) THEN
      RETURN v_code;
    END IF;
    IF v_attempt > 40 THEN
      RETURN upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    END IF;
  END LOOP;
END;
$func$;

-- 6. Friend Code & Privacy RPCs
CREATE OR REPLACE FUNCTION public.friend_get_my_code(p_player_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_auth_uid uuid := auth.uid();
  v_code text;
  v_allow boolean;
BEGIN
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'friend_get_my_code: not authenticated';
  END IF;
  SELECT friend_code, COALESCE(allow_friend_requests, true)
  INTO v_code, v_allow
  FROM profiles
  WHERE player_id = p_player_id AND auth_uid = v_auth_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'friend_get_my_code: unauthorized player_id';
  END IF;
  IF v_code IS NULL THEN
    PERFORM set_config('mapolis.allow_friend_code_update', '1', true);
    v_code := public.generate_mapolis_friend_code();
    UPDATE profiles SET friend_code = v_code WHERE player_id = p_player_id;
  END IF;
  RETURN jsonb_build_object('friend_code', v_code, 'allow_friend_requests', v_allow);
END;
$func$;

CREATE OR REPLACE FUNCTION public.friend_rotate_code(p_player_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_auth_uid uuid := auth.uid();
  v_code text;
BEGIN
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'friend_rotate_code: not authenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE player_id = p_player_id AND auth_uid = v_auth_uid) THEN
    RAISE EXCEPTION 'friend_rotate_code: unauthorized player_id';
  END IF;
  PERFORM set_config('mapolis.allow_friend_code_update', '1', true);
  v_code := public.generate_mapolis_friend_code();
  UPDATE profiles SET friend_code = v_code, updated_at = now() WHERE player_id = p_player_id;
  RETURN jsonb_build_object('friend_code', v_code);
END;
$func$;

CREATE OR REPLACE FUNCTION public.friend_set_privacy(p_player_id uuid, p_allow boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_auth_uid uuid := auth.uid();
BEGIN
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'friend_set_privacy: not authenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE player_id = p_player_id AND auth_uid = v_auth_uid) THEN
    RAISE EXCEPTION 'friend_set_privacy: unauthorized player_id';
  END IF;
  UPDATE profiles
  SET allow_friend_requests = COALESCE(p_allow, true), updated_at = now()
  WHERE player_id = p_player_id;
  RETURN jsonb_build_object('allow_friend_requests', COALESCE(p_allow, true));
END;
$func$;

-- 7. Exact-Match Player Lookup (Friend Code OR Exact Case-Insensitive Handle — NEVER wildcards)
CREATE OR REPLACE FUNCTION public.friend_lookup_player(
  p_player_id uuid,
  p_query text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_auth_uid uuid := auth.uid();
  v_clean text;
  v_code_norm text;
  v_target RECORD;
  v_link RECORD;
  v_relation text := 'none';
BEGIN
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'friend_lookup_player: not authenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE player_id = p_player_id AND auth_uid = v_auth_uid) THEN
    RAISE EXCEPTION 'friend_lookup_player: unauthorized player_id';
  END IF;

  v_clean := trim(COALESCE(p_query, ''));
  IF length(v_clean) < 2 OR length(v_clean) > 40 THEN
    RETURN jsonb_build_object('found', false, 'reason', 'invalid_query');
  END IF;

  -- Strip leading @ if user typed @handle
  IF left(v_clean, 1) = '@' THEN
    v_clean := trim(substr(v_clean, 2));
  END IF;

  v_code_norm := upper(regexp_replace(v_clean, '[^A-Za-z0-9]', '', 'g'));
  IF length(v_code_norm) = 7 AND left(v_code_norm, 3) = 'MAP' THEN
    v_code_norm := 'MAP-' || substr(v_code_norm, 4);
  ELSIF length(v_code_norm) = 4 THEN
    v_code_norm := 'MAP-' || v_code_norm;
  ELSE
    v_code_norm := upper(v_clean);
  END IF;

  SELECT
    p.player_id, p.handle, p.country, p.avatar_face, p.avatar_svg,
    COALESCE(p.allow_friend_requests, true) AS allow_friend_requests,
    COALESCE((p.stats->'h2h'->>'rating')::int, cr.elo, 1200) AS rating,
    COALESCE((p.stats->'h2h'->>'wins')::int, cr.wins, 0) AS wins,
    COALESCE((p.stats->'h2h'->>'losses')::int, cr.losses, 0) AS losses,
    COALESCE((p.stats->'h2h'->>'ties')::int, cr.ties, 0) AS ties,
    COALESCE((p.stats->'h2h'->>'matches')::int, cr.matches_played, 0) AS matches
  INTO v_target
  FROM profiles p
  LEFT JOIN competitive_ratings cr ON cr.profile_id = p.player_id
  WHERE COALESCE(p.frozen, false) = false
    AND (
      p.friend_code = v_code_norm
      OR lower(p.handle) = lower(v_clean)
    )
  ORDER BY (p.friend_code = v_code_norm) DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false, 'reason', 'not_found');
  END IF;

  IF v_target.player_id = p_player_id THEN
    RETURN jsonb_build_object('found', false, 'reason', 'self');
  END IF;

  SELECT * INTO v_link
  FROM friend_links
  WHERE LEAST(requester_id, addressee_id) = LEAST(p_player_id, v_target.player_id)
    AND GREATEST(requester_id, addressee_id) = GREATEST(p_player_id, v_target.player_id)
  LIMIT 1;

  IF FOUND THEN
    IF v_link.status = 'blocked' THEN
      -- Silent non-discovery if target blocked caller; show blocked_by_you if caller blocked target
      IF v_link.requester_id = p_player_id THEN
        v_relation := 'blocked_by_you';
      ELSE
        RETURN jsonb_build_object('found', false, 'reason', 'not_found');
      END IF;
    ELSIF v_link.status = 'accepted' THEN
      v_relation := 'friends';
    ELSIF v_link.status = 'pending' THEN
      v_relation := CASE WHEN v_link.requester_id = p_player_id THEN 'pending_sent' ELSE 'pending_received' END;
    END IF;
  END IF;

  -- Respect privacy toggle for non-friends
  IF v_target.allow_friend_requests = false AND v_relation NOT IN ('friends', 'blocked_by_you') THEN
    RETURN jsonb_build_object('found', false, 'reason', 'not_accepting');
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'relation_status', v_relation,
    'player', jsonb_build_object(
      'player_id', v_target.player_id,
      'handle', v_target.handle,
      'country', v_target.country,
      'avatar_face', v_target.avatar_face,
      'avatar_svg', v_target.avatar_svg,
      'rating', v_target.rating,
      'wins', v_target.wins,
      'losses', v_target.losses,
      'ties', v_target.ties,
      'matches', v_target.matches,
      'allow_friend_requests', v_target.allow_friend_requests
    )
  );
END;
$func$;

-- 8. Safe Public Player Card RPC (used when clicking a Leaderboard row)
CREATE OR REPLACE FUNCTION public.friend_get_player_card(
  p_player_id uuid,
  p_target_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_auth_uid uuid := auth.uid();
  v_target RECORD;
  v_link RECORD;
  v_relation text := 'none';
BEGIN
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'friend_get_player_card: not authenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE player_id = p_player_id AND auth_uid = v_auth_uid) THEN
    RAISE EXCEPTION 'friend_get_player_card: unauthorized player_id';
  END IF;
  IF p_player_id = p_target_id THEN
    RETURN jsonb_build_object('found', false, 'reason', 'self');
  END IF;

  SELECT
    p.player_id, p.handle, p.country, p.avatar_face, p.avatar_svg,
    COALESCE(p.allow_friend_requests, true) AS allow_friend_requests,
    COALESCE((p.stats->'h2h'->>'rating')::int, cr.elo, 1200) AS rating,
    COALESCE((p.stats->'h2h'->>'wins')::int, cr.wins, 0) AS wins,
    COALESCE((p.stats->'h2h'->>'losses')::int, cr.losses, 0) AS losses,
    COALESCE((p.stats->'h2h'->>'ties')::int, cr.ties, 0) AS ties,
    COALESCE((p.stats->'h2h'->>'matches')::int, cr.matches_played, 0) AS matches
  INTO v_target
  FROM profiles p
  LEFT JOIN competitive_ratings cr ON cr.profile_id = p.player_id
  WHERE p.player_id = p_target_id AND COALESCE(p.frozen, false) = false
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false, 'reason', 'not_found');
  END IF;

  SELECT * INTO v_link
  FROM friend_links
  WHERE LEAST(requester_id, addressee_id) = LEAST(p_player_id, p_target_id)
    AND GREATEST(requester_id, addressee_id) = GREATEST(p_player_id, p_target_id)
  LIMIT 1;

  IF FOUND THEN
    IF v_link.status = 'blocked' THEN
      v_relation := CASE WHEN v_link.requester_id = p_player_id THEN 'blocked_by_you' ELSE 'blocked' END;
    ELSIF v_link.status = 'accepted' THEN
      v_relation := 'friends';
    ELSIF v_link.status = 'pending' THEN
      v_relation := CASE WHEN v_link.requester_id = p_player_id THEN 'pending_sent' ELSE 'pending_received' END;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'relation_status', v_relation,
    'can_interact', (v_relation NOT IN ('blocked', 'blocked_by_you') AND (v_relation = 'friends' OR v_target.allow_friend_requests = true)),
    'player', jsonb_build_object(
      'player_id', v_target.player_id,
      'handle', v_target.handle,
      'country', v_target.country,
      'avatar_face', v_target.avatar_face,
      'avatar_svg', v_target.avatar_svg,
      'rating', v_target.rating,
      'wins', v_target.wins,
      'losses', v_target.losses,
      'ties', v_target.ties,
      'matches', v_target.matches,
      'allow_friend_requests', v_target.allow_friend_requests
    )
  );
END;
$func$;

-- 9. Friend Request / Respond / List RPCs
CREATE OR REPLACE FUNCTION public.friend_request(
  p_player_id uuid,
  p_target_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_auth_uid uuid := auth.uid();
  v_target_allow boolean;
  v_link RECORD;
BEGIN
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'friend_request: not authenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE player_id = p_player_id AND auth_uid = v_auth_uid) THEN
    RAISE EXCEPTION 'friend_request: unauthorized player_id';
  END IF;
  IF p_player_id = p_target_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cannot_add_self');
  END IF;

  SELECT COALESCE(allow_friend_requests, true) INTO v_target_allow
  FROM profiles
  WHERE player_id = p_target_id AND COALESCE(frozen, false) = false;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  SELECT * INTO v_link
  FROM friend_links
  WHERE LEAST(requester_id, addressee_id) = LEAST(p_player_id, p_target_id)
    AND GREATEST(requester_id, addressee_id) = GREATEST(p_player_id, p_target_id)
  FOR UPDATE;

  IF FOUND THEN
    IF v_link.status = 'blocked' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'unavailable');
    ELSIF v_link.status = 'accepted' THEN
      RETURN jsonb_build_object('ok', true, 'status', 'accepted');
    ELSIF v_link.status = 'pending' THEN
      IF v_link.addressee_id = p_player_id THEN
        UPDATE friend_links SET status = 'accepted', updated_at = now() WHERE id = v_link.id;
        RETURN jsonb_build_object('ok', true, 'status', 'accepted');
      END IF;
      RETURN jsonb_build_object('ok', true, 'status', 'pending');
    END IF;
  END IF;

  IF v_target_allow = false THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_accepting');
  END IF;

  INSERT INTO friend_links (requester_id, addressee_id, status)
  VALUES (p_player_id, p_target_id, 'pending');

  RETURN jsonb_build_object('ok', true, 'status', 'pending');
END;
$func$;

CREATE OR REPLACE FUNCTION public.friend_respond(
  p_player_id uuid,
  p_other_id uuid,
  p_action text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_auth_uid uuid := auth.uid();
  v_link RECORD;
BEGIN
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'friend_respond: not authenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE player_id = p_player_id AND auth_uid = v_auth_uid) THEN
    RAISE EXCEPTION 'friend_respond: unauthorized player_id';
  END IF;
  IF p_player_id = p_other_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_target');
  END IF;

  SELECT * INTO v_link
  FROM friend_links
  WHERE LEAST(requester_id, addressee_id) = LEAST(p_player_id, p_other_id)
    AND GREATEST(requester_id, addressee_id) = GREATEST(p_player_id, p_other_id)
  FOR UPDATE;

  IF p_action = 'accept' THEN
    IF FOUND AND v_link.status = 'pending' AND v_link.addressee_id = p_player_id THEN
      UPDATE friend_links SET status = 'accepted', updated_at = now() WHERE id = v_link.id;
      RETURN jsonb_build_object('ok', true, 'status', 'accepted');
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'no_pending_request');
  ELSIF p_action IN ('decline', 'remove', 'cancel') THEN
    IF FOUND AND v_link.status <> 'blocked' THEN
      DELETE FROM friend_links WHERE id = v_link.id;
      RETURN jsonb_build_object('ok', true, 'status', 'removed');
    END IF;
    RETURN jsonb_build_object('ok', true, 'status', 'none');
  ELSIF p_action = 'block' THEN
    IF FOUND THEN
      UPDATE friend_links
      SET requester_id = p_player_id, addressee_id = p_other_id, status = 'blocked', updated_at = now()
      WHERE id = v_link.id;
    ELSE
      INSERT INTO friend_links (requester_id, addressee_id, status)
      VALUES (p_player_id, p_other_id, 'blocked');
    END IF;
    -- Cancel any open challenges between the pair
    UPDATE h2h_rooms
    SET status = 'cancelled'
    WHERE status = 'open'
      AND ((host_id = p_player_id AND target_player_id = p_other_id)
        OR (host_id = p_other_id AND target_player_id = p_player_id));
    RETURN jsonb_build_object('ok', true, 'status', 'blocked');
  ELSIF p_action = 'unblock' THEN
    IF FOUND AND v_link.status = 'blocked' AND v_link.requester_id = p_player_id THEN
      DELETE FROM friend_links WHERE id = v_link.id;
      RETURN jsonb_build_object('ok', true, 'status', 'unblocked');
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'not_blocked_by_you');
  END IF;

  RETURN jsonb_build_object('ok', false, 'error', 'unknown_action');
END;
$func$;

CREATE OR REPLACE FUNCTION public.friend_list(p_player_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_auth_uid uuid := auth.uid();
  v_code text;
  v_allow boolean;
  v_friends jsonb := '[]'::jsonb;
  v_incoming jsonb := '[]'::jsonb;
  v_outgoing jsonb := '[]'::jsonb;
  v_blocked jsonb := '[]'::jsonb;
BEGIN
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'friend_list: not authenticated';
  END IF;
  SELECT friend_code, COALESCE(allow_friend_requests, true)
  INTO v_code, v_allow
  FROM profiles
  WHERE player_id = p_player_id AND auth_uid = v_auth_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'friend_list: unauthorized player_id';
  END IF;

  IF v_code IS NULL THEN
    PERFORM set_config('mapolis.allow_friend_code_update', '1', true);
    v_code := public.generate_mapolis_friend_code();
    UPDATE profiles SET friend_code = v_code WHERE player_id = p_player_id;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'player_id', p.player_id,
    'handle', p.handle,
    'country', p.country,
    'avatar_face', p.avatar_face,
    'avatar_svg', p.avatar_svg,
    'rating', COALESCE((p.stats->'h2h'->>'rating')::int, cr.elo, 1200),
    'wins', COALESCE((p.stats->'h2h'->>'wins')::int, cr.wins, 0),
    'losses', COALESCE((p.stats->'h2h'->>'losses')::int, cr.losses, 0),
    'ties', COALESCE((p.stats->'h2h'->>'ties')::int, cr.ties, 0),
    'matches', COALESCE((p.stats->'h2h'->>'matches')::int, cr.matches_played, 0)
  ) ORDER BY lower(p.handle)), '[]'::jsonb)
  INTO v_friends
  FROM friend_links fl
  JOIN profiles p ON p.player_id = CASE WHEN fl.requester_id = p_player_id THEN fl.addressee_id ELSE fl.requester_id END
  LEFT JOIN competitive_ratings cr ON cr.profile_id = p.player_id
  WHERE fl.status = 'accepted'
    AND (fl.requester_id = p_player_id OR fl.addressee_id = p_player_id)
    AND COALESCE(p.frozen, false) = false;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'player_id', p.player_id,
    'handle', p.handle,
    'country', p.country,
    'avatar_face', p.avatar_face,
    'avatar_svg', p.avatar_svg,
    'rating', COALESCE((p.stats->'h2h'->>'rating')::int, cr.elo, 1200),
    'created_at', fl.created_at
  ) ORDER BY fl.created_at DESC), '[]'::jsonb)
  INTO v_incoming
  FROM friend_links fl
  JOIN profiles p ON p.player_id = fl.requester_id
  LEFT JOIN competitive_ratings cr ON cr.profile_id = p.player_id
  WHERE fl.status = 'pending' AND fl.addressee_id = p_player_id
    AND COALESCE(p.frozen, false) = false;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'player_id', p.player_id,
    'handle', p.handle,
    'country', p.country,
    'avatar_face', p.avatar_face,
    'avatar_svg', p.avatar_svg,
    'rating', COALESCE((p.stats->'h2h'->>'rating')::int, cr.elo, 1200),
    'created_at', fl.created_at
  ) ORDER BY fl.created_at DESC), '[]'::jsonb)
  INTO v_outgoing
  FROM friend_links fl
  JOIN profiles p ON p.player_id = fl.addressee_id
  LEFT JOIN competitive_ratings cr ON cr.profile_id = p.player_id
  WHERE fl.status = 'pending' AND fl.requester_id = p_player_id
    AND COALESCE(p.frozen, false) = false;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'player_id', p.player_id,
    'handle', p.handle,
    'avatar_face', p.avatar_face,
    'avatar_svg', p.avatar_svg
  ) ORDER BY fl.updated_at DESC), '[]'::jsonb)
  INTO v_blocked
  FROM friend_links fl
  JOIN profiles p ON p.player_id = fl.addressee_id
  WHERE fl.status = 'blocked' AND fl.requester_id = p_player_id;

  RETURN jsonb_build_object(
    'friend_code', v_code,
    'allow_friend_requests', v_allow,
    'friends', v_friends,
    'incoming', v_incoming,
    'outgoing', v_outgoing,
    'blocked', v_blocked
  );
END;
$func$;

-- 10. Private Room & Direct Challenge RPCs
CREATE OR REPLACE FUNCTION public.h2h_create_room(
  p_player_id uuid,
  p_is_ranked boolean DEFAULT false,
  p_tier int DEFAULT 6,
  p_card_sequence jsonb DEFAULT NULL,
  p_target_player_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_auth_uid uuid := auth.uid();
  v_code text;
  v_room RECORD;
  v_target_allow boolean;
  v_link_status text;
BEGIN
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'h2h_create_room: not authenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE player_id = p_player_id AND auth_uid = v_auth_uid) THEN
    RAISE EXCEPTION 'h2h_create_room: unauthorized player_id';
  END IF;

  IF p_target_player_id IS NOT NULL THEN
    IF p_target_player_id = p_player_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'cannot_challenge_self');
    END IF;
    SELECT COALESCE(allow_friend_requests, true) INTO v_target_allow
    FROM profiles WHERE player_id = p_target_player_id AND COALESCE(frozen, false) = false;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'target_not_found');
    END IF;
    SELECT status INTO v_link_status
    FROM friend_links
    WHERE LEAST(requester_id, addressee_id) = LEAST(p_player_id, p_target_player_id)
      AND GREATEST(requester_id, addressee_id) = GREATEST(p_player_id, p_target_player_id)
    LIMIT 1;
    IF v_link_status = 'blocked' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'unavailable');
    END IF;
    IF v_target_allow = false AND COALESCE(v_link_status, '') <> 'accepted' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'not_accepting');
    END IF;
  END IF;

  -- Expire/cancel any stale open room created by this host
  UPDATE h2h_rooms
  SET status = 'cancelled'
  WHERE host_id = p_player_id AND status = 'open';

  v_code := public.generate_h2h_room_code();

  INSERT INTO h2h_rooms (room_code, host_id, target_player_id, is_ranked, tier, card_sequence_json, status, expires_at)
  VALUES (v_code, p_player_id, p_target_player_id, COALESCE(p_is_ranked, false), COALESCE(p_tier, 6), p_card_sequence, 'open', now() + interval '5 minutes')
  RETURNING * INTO v_room;

  RETURN jsonb_build_object(
    'ok', true,
    'room_id', v_room.id,
    'room_code', v_room.room_code,
    'is_ranked', v_room.is_ranked,
    'target_player_id', v_room.target_player_id,
    'expires_at', v_room.expires_at
  );
END;
$func$;

CREATE OR REPLACE FUNCTION public.h2h_join_room(
  p_player_id uuid,
  p_room_code text,
  p_tier int DEFAULT 6,
  p_card_sequence jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_auth_uid uuid := auth.uid();
  v_code_norm text;
  v_room h2h_rooms%ROWTYPE;
  v_match_id uuid;
  v_tier int;
  v_seq jsonb;
  v_host RECORD;
  v_blocked boolean := false;
BEGIN
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'h2h_join_room: not authenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE player_id = p_player_id AND auth_uid = v_auth_uid) THEN
    RAISE EXCEPTION 'h2h_join_room: unauthorized player_id';
  END IF;

  v_code_norm := upper(regexp_replace(COALESCE(p_room_code, ''), '[^A-Za-z0-9]', '', 'g'));
  IF length(v_code_norm) <> 6 THEN
    RETURN jsonb_build_object('status', 'error', 'error', 'invalid_code');
  END IF;

  SELECT * INTO v_room
  FROM h2h_rooms
  WHERE room_code = v_code_norm
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'error', 'error', 'not_found');
  END IF;

  IF v_room.status <> 'open' THEN
    RETURN jsonb_build_object('status', 'error', 'error', 'room_closed');
  END IF;

  IF v_room.expires_at <= now() THEN
    UPDATE h2h_rooms SET status = 'expired' WHERE id = v_room.id;
    RETURN jsonb_build_object('status', 'error', 'error', 'room_expired');
  END IF;

  IF v_room.host_id = p_player_id THEN
    RETURN jsonb_build_object('status', 'error', 'error', 'cannot_join_own_room');
  END IF;

  IF v_room.target_player_id IS NOT NULL AND v_room.target_player_id <> p_player_id THEN
    RETURN jsonb_build_object('status', 'error', 'error', 'private_invite_only');
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM friend_links
    WHERE status = 'blocked'
      AND LEAST(requester_id, addressee_id) = LEAST(p_player_id, v_room.host_id)
      AND GREATEST(requester_id, addressee_id) = GREATEST(p_player_id, v_room.host_id)
  ) INTO v_blocked;
  IF v_blocked THEN
    RETURN jsonb_build_object('status', 'error', 'error', 'unavailable');
  END IF;

  v_tier := LEAST(COALESCE(v_room.tier, 6), COALESCE(p_tier, 6));
  v_seq := COALESCE(v_room.card_sequence_json, p_card_sequence);

  INSERT INTO matches (card_pool_tier, status, started_at, card_sequence_json, is_ranked)
  VALUES (v_tier, 'active', now(), v_seq, COALESCE(v_room.is_ranked, false))
  RETURNING id INTO v_match_id;

  INSERT INTO match_players (match_id, profile_id)
  VALUES (v_match_id, v_room.host_id), (v_match_id, p_player_id);

  UPDATE h2h_rooms
  SET status = 'matched', guest_id = p_player_id, match_id = v_match_id
  WHERE id = v_room.id;

  SELECT
    p.player_id, p.handle, p.avatar_svg, p.avatar_face, p.avatar_selections, p.stats, p.country, p.birth_year,
    COALESCE((p.stats->'h2h'->>'rating')::int, cr.elo, NULLIF(p.cr, 0), 1200) AS elo,
    COALESCE((p.stats->'h2h'->>'matches')::int, cr.matches_played, 0) AS matches,
    COALESCE((p.stats->'h2h'->>'wins')::int, cr.wins, 0) AS wins,
    COALESCE((p.stats->'h2h'->>'losses')::int, cr.losses, 0) AS losses,
    COALESCE((p.stats->'h2h'->>'ties')::int, cr.ties, 0) AS ties
  INTO v_host
  FROM profiles p
  LEFT JOIN competitive_ratings cr ON cr.profile_id = p.player_id
  WHERE p.player_id = v_room.host_id;

  RETURN jsonb_build_object(
    'status', 'matched',
    'match_id', v_match_id,
    'role', 'joiner',
    'is_ranked', COALESCE(v_room.is_ranked, false),
    'tier', v_tier,
    'card_sequence', v_seq,
    'started_at', now(),
    'opponent', jsonb_build_object(
      'player_id', v_host.player_id,
      'handle', v_host.handle,
      'avatar_svg', v_host.avatar_svg,
      'avatar_face', v_host.avatar_face,
      'avatar_selections', v_host.avatar_selections,
      'stats', v_host.stats,
      'country', v_host.country,
      'birth_year', v_host.birth_year,
      'rating', v_host.elo,
      'matches', v_host.matches,
      'wins', v_host.wins,
      'losses', v_host.losses,
      'ties', v_host.ties,
      'tier', v_tier
    )
  );
END;
$func$;

CREATE OR REPLACE FUNCTION public.h2h_poll_room(
  p_player_id uuid,
  p_room_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_auth_uid uuid := auth.uid();
  v_room h2h_rooms%ROWTYPE;
  v_match matches%ROWTYPE;
  v_guest RECORD;
BEGIN
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'h2h_poll_room: not authenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE player_id = p_player_id AND auth_uid = v_auth_uid) THEN
    RAISE EXCEPTION 'h2h_poll_room: unauthorized player_id';
  END IF;

  SELECT * INTO v_room FROM h2h_rooms WHERE id = p_room_id AND host_id = p_player_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'expired');
  END IF;

  IF v_room.status = 'open' AND v_room.expires_at <= now() THEN
    UPDATE h2h_rooms SET status = 'expired' WHERE id = v_room.id;
    RETURN jsonb_build_object('status', 'expired');
  END IF;

  IF v_room.status IN ('cancelled', 'declined', 'expired') THEN
    RETURN jsonb_build_object('status', v_room.status);
  END IF;

  IF v_room.status = 'matched' AND v_room.match_id IS NOT NULL AND v_room.guest_id IS NOT NULL THEN
    SELECT * INTO v_match FROM matches WHERE id = v_room.match_id;
    SELECT
      p.player_id, p.handle, p.avatar_svg, p.avatar_face, p.avatar_selections, p.stats, p.country, p.birth_year,
      COALESCE((p.stats->'h2h'->>'rating')::int, cr.elo, NULLIF(p.cr, 0), 1200) AS elo,
      COALESCE((p.stats->'h2h'->>'matches')::int, cr.matches_played, 0) AS matches,
      COALESCE((p.stats->'h2h'->>'wins')::int, cr.wins, 0) AS wins,
      COALESCE((p.stats->'h2h'->>'losses')::int, cr.losses, 0) AS losses,
      COALESCE((p.stats->'h2h'->>'ties')::int, cr.ties, 0) AS ties
    INTO v_guest
    FROM profiles p
    LEFT JOIN competitive_ratings cr ON cr.profile_id = p.player_id
    WHERE p.player_id = v_room.guest_id;

    RETURN jsonb_build_object(
      'status', 'matched',
      'match_id', v_room.match_id,
      'role', 'creator',
      'is_ranked', COALESCE(v_match.is_ranked, v_room.is_ranked, false),
      'tier', COALESCE(v_match.card_pool_tier, v_room.tier, 6),
      'card_sequence', COALESCE(v_match.card_sequence_json, v_room.card_sequence_json),
      'started_at', COALESCE(v_match.started_at, now()),
      'opponent', jsonb_build_object(
        'player_id', v_guest.player_id,
        'handle', v_guest.handle,
        'avatar_svg', v_guest.avatar_svg,
        'avatar_face', v_guest.avatar_face,
        'avatar_selections', v_guest.avatar_selections,
        'stats', v_guest.stats,
        'country', v_guest.country,
        'birth_year', v_guest.birth_year,
        'rating', v_guest.elo,
        'matches', v_guest.matches,
        'wins', v_guest.wins,
        'losses', v_guest.losses,
        'ties', v_guest.ties,
        'tier', COALESCE(v_match.card_pool_tier, v_room.tier, 6)
      )
    );
  END IF;

  RETURN jsonb_build_object('status', 'open', 'expires_at', v_room.expires_at);
END;
$func$;

CREATE OR REPLACE FUNCTION public.h2h_cancel_room(
  p_player_id uuid,
  p_room_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_auth_uid uuid := auth.uid();
BEGIN
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'h2h_cancel_room: not authenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE player_id = p_player_id AND auth_uid = v_auth_uid) THEN
    RAISE EXCEPTION 'h2h_cancel_room: unauthorized player_id';
  END IF;
  UPDATE h2h_rooms
  SET status = 'cancelled'
  WHERE id = p_room_id AND host_id = p_player_id AND status = 'open';
  RETURN jsonb_build_object('ok', true);
END;
$func$;

CREATE OR REPLACE FUNCTION public.h2h_list_incoming_challenges(p_player_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_auth_uid uuid := auth.uid();
  v_rows jsonb := '[]'::jsonb;
BEGIN
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'h2h_list_incoming_challenges: not authenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE player_id = p_player_id AND auth_uid = v_auth_uid) THEN
    RAISE EXCEPTION 'h2h_list_incoming_challenges: unauthorized player_id';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'room_id', r.id,
    'room_code', r.room_code,
    'is_ranked', r.is_ranked,
    'expires_at', r.expires_at,
    'created_at', r.created_at,
    'host', jsonb_build_object(
      'player_id', p.player_id,
      'handle', p.handle,
      'country', p.country,
      'avatar_face', p.avatar_face,
      'avatar_svg', p.avatar_svg,
      'rating', COALESCE((p.stats->'h2h'->>'rating')::int, cr.elo, 1200)
    )
  ) ORDER BY r.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM h2h_rooms r
  JOIN profiles p ON p.player_id = r.host_id
  LEFT JOIN competitive_ratings cr ON cr.profile_id = p.player_id
  WHERE r.target_player_id = p_player_id
    AND r.status = 'open'
    AND r.expires_at > now()
    AND COALESCE(p.frozen, false) = false
    AND NOT EXISTS (
      SELECT 1 FROM friend_links fl
      WHERE fl.status = 'blocked'
        AND LEAST(fl.requester_id, fl.addressee_id) = LEAST(p_player_id, r.host_id)
        AND GREATEST(fl.requester_id, fl.addressee_id) = GREATEST(p_player_id, r.host_id)
    );

  RETURN jsonb_build_object('challenges', v_rows);
END;
$func$;

CREATE OR REPLACE FUNCTION public.h2h_respond_challenge(
  p_player_id uuid,
  p_room_id uuid,
  p_action text,
  p_tier int DEFAULT 6,
  p_card_sequence jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_auth_uid uuid := auth.uid();
  v_room h2h_rooms%ROWTYPE;
BEGIN
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'h2h_respond_challenge: not authenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE player_id = p_player_id AND auth_uid = v_auth_uid) THEN
    RAISE EXCEPTION 'h2h_respond_challenge: unauthorized player_id';
  END IF;

  SELECT * INTO v_room
  FROM h2h_rooms
  WHERE id = p_room_id AND target_player_id = p_player_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'error', 'error', 'not_found');
  END IF;

  IF p_action = 'decline' THEN
    IF v_room.status = 'open' THEN
      UPDATE h2h_rooms SET status = 'declined' WHERE id = v_room.id;
    END IF;
    RETURN jsonb_build_object('status', 'declined');
  ELSIF p_action = 'accept' THEN
    RETURN public.h2h_join_room(p_player_id, v_room.room_code, p_tier, p_card_sequence);
  END IF;

  RETURN jsonb_build_object('status', 'error', 'error', 'unknown_action');
END;
$func$;

-- 11. Update h2h_finalize_match (preserves 3-arg signature; honors is_ranked & 3/day per-pair ELO cap)
CREATE OR REPLACE FUNCTION public.h2h_finalize_match(
  p_match_id uuid,
  p_player_id uuid,
  p_final_score numeric
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $func$
DECLARE
  v_auth_uid uuid := auth.uid();
  v_match matches%ROWTYPE;
  v_existing_result match_results%ROWTYPE;
  v_me match_players%ROWTYPE;
  v_opp match_players%ROWTYPE;
  v_my_elo int := 1200;
  v_my_matches int := 0;
  v_my_wins int := 0;
  v_my_losses int := 0;
  v_my_ties int := 0;
  v_opp_elo int := 1200;
  v_opp_matches int := 0;
  v_opp_wins int := 0;
  v_opp_losses int := 0;
  v_opp_ties int := 0;
  v_opp_correct int := 0;
  v_opp_wrong int := 0;
  v_my_score_float float;
  v_my_expected float;
  v_my_delta int := 0;
  v_opp_delta int := 0;
  v_winner uuid := NULL;
  v_outcome text;
  v_is_ranked boolean := true;
  v_pair_ranked_24h int := 0;
  v_elo_capped boolean := false;
BEGIN
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'h2h_finalize_match: not authenticated';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM profiles WHERE player_id = p_player_id AND auth_uid = v_auth_uid) THEN
    RAISE EXCEPTION 'h2h_finalize_match: unauthorized player_id';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM match_players WHERE match_id = p_match_id AND profile_id = p_player_id) THEN
    RAISE EXCEPTION 'h2h_finalize_match: not a participant in match';
  END IF;

  UPDATE match_players
  SET final_score = p_final_score,
      finished_at = COALESCE(finished_at, now())
  WHERE match_id = p_match_id AND profile_id = p_player_id;

  SELECT * INTO v_match FROM matches WHERE id = p_match_id FOR UPDATE;
  SELECT * INTO v_me FROM match_players WHERE match_id = p_match_id AND profile_id = p_player_id;
  SELECT * INTO v_opp FROM match_players WHERE match_id = p_match_id AND profile_id != p_player_id;

  v_is_ranked := COALESCE(v_match.is_ranked, true);

  SELECT
    COALESCE(cr.elo, (p.stats->'h2h'->>'rating')::int, NULLIF(p.cr, 0), 1200),
    COALESCE(cr.matches_played, (p.stats->'h2h'->>'matches')::int, ((COALESCE((p.stats->'h2h'->>'wins')::int, 0) + COALESCE((p.stats->'h2h'->>'losses')::int, 0) + COALESCE((p.stats->'h2h'->>'ties')::int, 0))), 0),
    COALESCE(cr.wins, (p.stats->'h2h'->>'wins')::int, 0),
    COALESCE(cr.losses, (p.stats->'h2h'->>'losses')::int, 0),
    COALESCE(cr.ties, (p.stats->'h2h'->>'ties')::int, 0)
  INTO v_my_elo, v_my_matches, v_my_wins, v_my_losses, v_my_ties
  FROM profiles p
  LEFT JOIN competitive_ratings cr ON cr.profile_id = p.player_id
  WHERE p.player_id = p_player_id;

  SELECT
    COALESCE(cr.elo, (p.stats->'h2h'->>'rating')::int, NULLIF(p.cr, 0), 1200),
    COALESCE(cr.matches_played, (p.stats->'h2h'->>'matches')::int, ((COALESCE((p.stats->'h2h'->>'wins')::int, 0) + COALESCE((p.stats->'h2h'->>'losses')::int, 0) + COALESCE((p.stats->'h2h'->>'ties')::int, 0))), 0),
    COALESCE(cr.wins, (p.stats->'h2h'->>'wins')::int, 0),
    COALESCE(cr.losses, (p.stats->'h2h'->>'losses')::int, 0),
    COALESCE(cr.ties, (p.stats->'h2h'->>'ties')::int, 0)
  INTO v_opp_elo, v_opp_matches, v_opp_wins, v_opp_losses, v_opp_ties
  FROM profiles p
  LEFT JOIN competitive_ratings cr ON cr.profile_id = p.player_id
  WHERE p.player_id = v_opp.profile_id;

  SELECT
    COALESCE(count(*) FILTER (WHERE correct = true), 0),
    COALESCE(count(*) FILTER (WHERE correct = false), 0)
  INTO v_opp_correct, v_opp_wrong
  FROM match_events
  WHERE match_id = p_match_id AND profile_id = v_opp.profile_id;

  IF v_match.status = 'finished' THEN
    SELECT * INTO v_existing_result
    FROM match_results
    WHERE match_id = p_match_id AND profile_id = p_player_id
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'outcome', v_existing_result.outcome,
        'is_ranked', v_is_ranked,
        'elo_capped', (v_is_ranked AND v_existing_result.score_delta = 0 AND v_existing_result.outcome <> 'tie'),
        'elo_before', v_existing_result.elo_before,
        'elo_after', v_existing_result.elo_after,
        'rating_delta', v_existing_result.score_delta,
        'your_score', v_existing_result.score,
        'opp_score', v_existing_result.opponent_score,
        'opp_elo_before', v_opp_elo,
        'opp_elo_after', v_opp_elo,
        'opp_rating_delta', -v_existing_result.score_delta,
        'opp_matches', v_opp_matches,
        'opp_wins', v_opp_wins,
        'opp_losses', v_opp_losses,
        'opp_ties', v_opp_ties,
        'opp_correct', v_opp_correct,
        'opp_wrong', v_opp_wrong
      );
    END IF;
  END IF;

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

  -- Server-side anti-boosting cap: max 3 ranked ELO matches per 24h between the exact same pair
  IF v_is_ranked AND v_opp.profile_id IS NOT NULL THEN
    SELECT count(*) INTO v_pair_ranked_24h
    FROM matches m
    JOIN match_players mp1 ON mp1.match_id = m.id AND mp1.profile_id = p_player_id
    JOIN match_players mp2 ON mp2.match_id = m.id AND mp2.profile_id = v_opp.profile_id
    WHERE m.id <> p_match_id
      AND m.status = 'finished'
      AND COALESCE(m.is_ranked, true) = true
      AND m.ended_at > now() - interval '24 hours';

    IF v_pair_ranked_24h >= 3 THEN
      v_elo_capped := true;
    END IF;
  END IF;

  IF v_is_ranked AND NOT v_elo_capped THEN
    v_my_expected := 1.0 / (1.0 + power(10.0, (v_opp_elo - v_my_elo)::float / 400.0));
    v_my_delta := round(32.0 * (v_my_score_float - v_my_expected))::int;
    v_opp_delta := -v_my_delta;
  ELSE
    v_my_delta := 0;
    v_opp_delta := 0;
  END IF;

  UPDATE matches
  SET status = 'finished', ended_at = now(), winner_id = v_winner
  WHERE id = p_match_id;

  UPDATE match_players
  SET finished_at = COALESCE(finished_at, now())
  WHERE match_id = p_match_id AND profile_id = v_opp.profile_id AND finished_at IS NULL;

  IF v_is_ranked AND NOT v_elo_capped THEN
    INSERT INTO competitive_ratings (profile_id, elo, updated_at, matches_played, wins, losses, ties)
    VALUES (
      p_player_id,
      GREATEST(0, v_my_elo + v_my_delta),
      now(),
      v_my_matches + 1,
      v_my_wins + (CASE WHEN v_outcome = 'win' THEN 1 ELSE 0 END),
      v_my_losses + (CASE WHEN v_outcome = 'loss' THEN 1 ELSE 0 END),
      v_my_ties + (CASE WHEN v_outcome = 'tie' THEN 1 ELSE 0 END)
    )
    ON CONFLICT (profile_id) DO UPDATE SET
      elo = GREATEST(0, competitive_ratings.elo + v_my_delta),
      updated_at = now(),
      matches_played = COALESCE(competitive_ratings.matches_played, v_my_matches) + 1,
      wins = COALESCE(competitive_ratings.wins, v_my_wins) + (CASE WHEN v_outcome = 'win' THEN 1 ELSE 0 END),
      losses = COALESCE(competitive_ratings.losses, v_my_losses) + (CASE WHEN v_outcome = 'loss' THEN 1 ELSE 0 END),
      ties = COALESCE(competitive_ratings.ties, v_my_ties) + (CASE WHEN v_outcome = 'tie' THEN 1 ELSE 0 END);

    INSERT INTO competitive_ratings (profile_id, elo, updated_at, matches_played, wins, losses, ties)
    VALUES (
      v_opp.profile_id,
      GREATEST(0, v_opp_elo + v_opp_delta),
      now(),
      v_opp_matches + 1,
      v_opp_wins + (CASE WHEN v_outcome = 'loss' THEN 1 ELSE 0 END),
      v_opp_losses + (CASE WHEN v_outcome = 'win' THEN 1 ELSE 0 END),
      v_opp_ties + (CASE WHEN v_outcome = 'tie' THEN 1 ELSE 0 END)
    )
    ON CONFLICT (profile_id) DO UPDATE SET
      elo = GREATEST(0, competitive_ratings.elo + v_opp_delta),
      updated_at = now(),
      matches_played = COALESCE(competitive_ratings.matches_played, v_opp_matches) + 1,
      wins = COALESCE(competitive_ratings.wins, v_opp_wins) + (CASE WHEN v_outcome = 'loss' THEN 1 ELSE 0 END),
      losses = COALESCE(competitive_ratings.losses, v_opp_losses) + (CASE WHEN v_outcome = 'win' THEN 1 ELSE 0 END),
      ties = COALESCE(competitive_ratings.ties, v_opp_ties) + (CASE WHEN v_outcome = 'tie' THEN 1 ELSE 0 END);

    UPDATE profiles
    SET stats = jsonb_set(
      COALESCE(stats, '{}'::jsonb),
      '{h2h}',
      COALESCE(stats->'h2h', '{}'::jsonb) || jsonb_build_object(
        'rating', GREATEST(0, v_my_elo + v_my_delta),
        'matches', v_my_matches + 1,
        'wins', v_my_wins + (CASE WHEN v_outcome = 'win' THEN 1 ELSE 0 END),
        'losses', v_my_losses + (CASE WHEN v_outcome = 'loss' THEN 1 ELSE 0 END),
        'ties', v_my_ties + (CASE WHEN v_outcome = 'tie' THEN 1 ELSE 0 END)
      ),
      true
    )
    WHERE player_id = p_player_id;

    UPDATE profiles
    SET stats = jsonb_set(
      COALESCE(stats, '{}'::jsonb),
      '{h2h}',
      COALESCE(stats->'h2h', '{}'::jsonb) || jsonb_build_object(
        'rating', GREATEST(0, v_opp_elo + v_opp_delta),
        'matches', v_opp_matches + 1,
        'wins', v_opp_wins + (CASE WHEN v_outcome = 'loss' THEN 1 ELSE 0 END),
        'losses', v_opp_losses + (CASE WHEN v_outcome = 'win' THEN 1 ELSE 0 END),
        'ties', v_opp_ties + (CASE WHEN v_outcome = 'tie' THEN 1 ELSE 0 END)
      ),
      true
    )
    WHERE player_id = v_opp.profile_id;
  END IF;

  INSERT INTO match_results (match_id, profile_id, outcome, elo_before, elo_after, score_delta, score, opponent_score)
  VALUES
    (p_match_id, p_player_id, v_outcome, v_my_elo, GREATEST(0, v_my_elo + v_my_delta), v_my_delta, v_me.final_score, v_opp.final_score),
    (p_match_id, v_opp.profile_id, CASE WHEN v_outcome = 'win' THEN 'loss' WHEN v_outcome = 'loss' THEN 'win' ELSE 'tie' END, v_opp_elo, GREATEST(0, v_opp_elo + v_opp_delta), v_opp_delta, v_opp.final_score, v_me.final_score);

  RETURN jsonb_build_object(
    'outcome', v_outcome,
    'is_ranked', (v_is_ranked AND NOT v_elo_capped),
    'elo_capped', v_elo_capped,
    'elo_before', v_my_elo,
    'elo_after', GREATEST(0, v_my_elo + v_my_delta),
    'rating_delta', v_my_delta,
    'your_score', v_me.final_score,
    'opp_score', v_opp.final_score,
    'opp_elo_before', v_opp_elo,
    'opp_elo_after', GREATEST(0, v_opp_elo + v_opp_delta),
    'opp_rating_delta', v_opp_delta,
    'opp_matches', CASE WHEN (v_is_ranked AND NOT v_elo_capped) THEN v_opp_matches + 1 ELSE v_opp_matches END,
    'opp_wins', CASE WHEN (v_is_ranked AND NOT v_elo_capped) THEN v_opp_wins + (CASE WHEN v_outcome = 'loss' THEN 1 ELSE 0 END) ELSE v_opp_wins END,
    'opp_losses', CASE WHEN (v_is_ranked AND NOT v_elo_capped) THEN v_opp_losses + (CASE WHEN v_outcome = 'win' THEN 1 ELSE 0 END) ELSE v_opp_losses END,
    'opp_ties', CASE WHEN (v_is_ranked AND NOT v_elo_capped) THEN v_opp_ties + (CASE WHEN v_outcome = 'tie' THEN 1 ELSE 0 END) ELSE v_opp_ties END,
    'opp_correct', v_opp_correct,
    'opp_wrong', v_opp_wrong
  );
END;
$func$;

GRANT EXECUTE ON FUNCTION public.friend_get_my_code(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.friend_rotate_code(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.friend_set_privacy(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.friend_lookup_player(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.friend_get_player_card(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.friend_request(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.friend_respond(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.friend_list(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.h2h_create_room(uuid, boolean, int, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.h2h_join_room(uuid, text, int, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.h2h_poll_room(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.h2h_cancel_room(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.h2h_list_incoming_challenges(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.h2h_respond_challenge(uuid, uuid, text, int, jsonb) TO authenticated;

-- NOTE: Post-production cutover (run AFTER pre-beta6 is merged to main AND an admin Supabase user has is_admin=true):
-- DROP POLICY IF EXISTS "Anyone can read profiles" ON profiles;
-- CREATE POLICY "Users can read own profile" ON profiles FOR SELECT USING (auth_uid = auth.uid() OR auth_is_admin());
-- DROP POLICY IF EXISTS "Allow anon select player_notes" ON player_notes;
-- DROP POLICY IF EXISTS "Allow anon insert player_notes" ON player_notes;
-- DROP POLICY IF EXISTS "Allow anon update player_notes" ON player_notes;
-- DROP POLICY IF EXISTS "Allow anon delete player_notes" ON player_notes;




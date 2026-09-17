-- Mapolis Database Schema & RLS Policies
-- Designed for COPPA/FERPA compliance

-- 1. Profiles
CREATE TABLE profiles (
    player_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_uid UUID REFERENCES auth.users(id) NOT NULL UNIQUE,
    handle TEXT UNIQUE NOT NULL,
    country TEXT,
    birth_year INT,
    is_admin BOOLEAN DEFAULT false,
    is_educator BOOLEAN DEFAULT false,
    frozen BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Classrooms
CREATE TABLE classrooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID REFERENCES auth.users(id) NOT NULL,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Classroom Members
CREATE TABLE classroom_members (
    classroom_id UUID REFERENCES classrooms(id) ON DELETE CASCADE,
    profile_id UUID REFERENCES profiles(player_id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (classroom_id, profile_id)
);

-- 4. Sessions (Game Rounds)
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id UUID REFERENCES profiles(player_id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ NOT NULL,
    mode TEXT NOT NULL,
    tier INT,
    category TEXT,
    final_score INT DEFAULT 0,
    cards_answered INT DEFAULT 0,
    cards_correct INT DEFAULT 0
);

-- 5. Card Attempts
CREATE TABLE card_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
    player_id UUID REFERENCES profiles(player_id) ON DELETE CASCADE,
    card_id TEXT NOT NULL,
    category TEXT,
    correct BOOLEAN NOT NULL,
    time_ms INT,
    answered_at TIMESTAMPTZ DEFAULT now()
);

-- 6. Matches (Head-to-Head)
CREATE TABLE matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 7. Match Players
CREATE TABLE match_players (
    match_id UUID REFERENCES matches(id) ON DELETE CASCADE,
    profile_id UUID REFERENCES profiles(player_id) ON DELETE CASCADE,
    PRIMARY KEY (match_id, profile_id)
);

-- 8. Match Events
CREATE TABLE match_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id UUID REFERENCES matches(id) ON DELETE CASCADE,
    profile_id UUID REFERENCES profiles(player_id) ON DELETE CASCADE,
    card_id TEXT NOT NULL,
    correct BOOLEAN NOT NULL,
    score_delta INT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 9. Competitive Ratings
CREATE TABLE competitive_ratings (
    profile_id UUID PRIMARY KEY REFERENCES profiles(player_id) ON DELETE CASCADE,
    elo INT DEFAULT 1000,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE classrooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE classroom_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE card_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitive_ratings ENABLE ROW LEVEL SECURITY;

-- Security Policies (RLS)

-- Profiles: Users can read their own. Admins can read all.
CREATE POLICY "Users can read own profile" ON profiles
    FOR SELECT USING (auth_uid = auth.uid());
CREATE POLICY "Admins can read all profiles" ON profiles
    FOR ALL USING (EXISTS (SELECT 1 FROM profiles WHERE auth_uid = auth.uid() AND is_admin = true));

-- Sessions: Users can read own. Educators can read their students'. Admins read all.
-- Insert is disabled directly (handled via submit_round RPC).
CREATE POLICY "Users can read own sessions" ON sessions
    FOR SELECT USING (player_id IN (SELECT player_id FROM profiles WHERE auth_uid = auth.uid()));
    
-- Card Attempts: Users can read own. Educators read their students'.
-- Insert disabled directly.
CREATE POLICY "Users can read own card attempts" ON card_attempts
    FOR SELECT USING (player_id IN (SELECT player_id FROM profiles WHERE auth_uid = auth.uid()));
CREATE POLICY "Educators can read students card attempts" ON card_attempts
    FOR SELECT USING (
        player_id IN (
            SELECT cm.profile_id FROM classroom_members cm
            JOIN classrooms c ON c.id = cm.classroom_id
            WHERE c.owner_id = auth.uid()
        )
    );

-- Matches & Events
CREATE POLICY "Players can read their matches" ON matches
    FOR SELECT USING (
        id IN (
            SELECT match_id FROM match_players mp
            JOIN profiles p ON p.player_id = mp.profile_id
            WHERE p.auth_uid = auth.uid()
        )
    );

-- Competitive Ratings: Publicly readable for leaderboards
CREATE POLICY "Competitive ratings are public" ON competitive_ratings
    FOR SELECT USING (true);

-- RPC: submit_round
CREATE OR REPLACE FUNCTION submit_round(
    session_data jsonb,
    card_attempts_data jsonb,
    star_events_data jsonb,
    progress_updates_data jsonb
) RETURNS uuid AS $$
DECLARE
    v_player_id uuid;
    v_auth_uid uuid;
    v_session_id uuid;
BEGIN
    -- Verify auth
    v_auth_uid := auth.uid();
    IF v_auth_uid IS NULL THEN
        RAISE EXCEPTION 'submit_round: not authenticated';
    END IF;
    
    v_player_id := (session_data->>'player_id')::uuid;
    
    -- Ensure player_id matches the authenticated user
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE player_id = v_player_id AND auth_uid = v_auth_uid) THEN
        RAISE EXCEPTION 'submit_round: auth mismatch';
    END IF;
    
    -- Insert session
    v_session_id := (session_data->>'id')::uuid;
    INSERT INTO sessions (id, player_id, started_at, ended_at, mode, tier, category, final_score, cards_answered, cards_correct)
    VALUES (
        v_session_id,
        v_player_id,
        (session_data->>'started_at')::timestamptz,
        (session_data->>'ended_at')::timestamptz,
        session_data->>'mode',
        (session_data->>'tier')::int,
        session_data->>'category',
        (session_data->>'final_score')::int,
        (session_data->>'cards_answered')::int,
        (session_data->>'cards_correct')::int
    );
    
    -- Insert card attempts
    -- (Logic to unnest and insert jsonb array elements here)
    -- ...
    
    RETURN v_session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION restore_profile(
  p_handle text,
  p_password_hash text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
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

  -- Take ownership of the profile for the current device session
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

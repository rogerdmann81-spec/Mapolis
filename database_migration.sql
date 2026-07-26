-- 1. Add missing columns to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_selections JSONB;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_svg TEXT;
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

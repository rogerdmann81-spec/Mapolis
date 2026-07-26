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
  WHERE player_id = v_profile.player_id;

  RETURN row_to_json(v_profile)::jsonb;
END;
$$;

-- Also we need an RPC for parent email restore (if needed):
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

  -- Note: If multiple profiles share an email, this will just return the first one.
  -- A better implementation would send a verification email, but for the sandbox:
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
  WHERE player_id = v_profile.player_id;

  RETURN row_to_json(v_profile)::jsonb;
END;
$$;

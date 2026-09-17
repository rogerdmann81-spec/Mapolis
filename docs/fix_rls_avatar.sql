-- Allow users to update their own profile so avatars and stats can sync
CREATE POLICY "Users can update own profile" ON profiles
    FOR UPDATE USING (auth_uid = auth.uid());

-- Allow upserts (merge-duplicates requires INSERT permission too)
CREATE POLICY "Users can insert own profile" ON profiles
    FOR INSERT WITH CHECK (auth_uid = auth.uid());

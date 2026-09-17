CREATE POLICY "Users can update own profile" ON profiles
    FOR UPDATE USING (auth_uid = auth.uid());

CREATE POLICY "Users can insert own profile" ON profiles
    FOR INSERT WITH CHECK (auth_uid = auth.uid());

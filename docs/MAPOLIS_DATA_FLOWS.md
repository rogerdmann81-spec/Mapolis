# Mapolis Architecture & Data Flow Guide

This document visualizes and explains the authentication, profile management, and account recovery architecture for **Mapolis**. It is designed to be easily shared with developers, stakeholders, and compliance auditors.

---

## 1. High-Level Architecture Overview

Mapolis uses an **Anonymous Auth + Custom Profile Layer** pattern. This ensures strict **COPPA / FERPA** compliance for student privacy:
* **No personal identifying accounts are forced upfront**: Students play under an anonymous cryptographic session.
* **Credentials never travel in plaintext**: Passwords are mathematically hashed (`SHA-256`) client-side before touching the network.
* **Row-Level Security (RLS) & RPCs**: Direct database access is locked down. Profile creation and cross-device recovery happen strictly via security-definer Remote Procedure Calls (RPCs).

```
+----------------------------------------------------------------------------------------------------+
|                                         CLIENT (Browser)                                           |
|                                                                                                    |
|  [ localStorage ] <---> [ syncStore Data Layer ] <---> [ UI: Solo Game, H2H, Profile, Restore ]    |
|   (Fast offline          (Queuing, deduping,            (Client-side SHA-256 hashing, UI state)    |
|    cache & queue)         session handling)                                                        |
+------------------------------------------+---------------------------------------------------------+
                                           |
                              HTTPS / REST | (Bearer Token + Anon Key)
                                           v
+----------------------------------------------------------------------------------------------------+
|                                    SUPABASE BACKEND                                                |
|                                                                                                    |
|   [ Supabase Auth (GoTrue) ]          [ Postgres Database ]                                        |
|   - Anonymous session generation      - Table: `profiles` (RLS protected)                          |
|   - Issues JWT token (`auth.uid()`)   - Stored: `auth_uid`, `handle`, `password_hash`, `stats`     |
|                                       - Stored: `parent_email` (optional for recovery)             |
|                                                                                                    |
|                                       [ Security-Definer RPCs ]                                    |
|                                       - `create_profile(...)`                                      |
|                                       - `restore_profile(...)`                                     |
|                                       - `restore_profile_by_email(...)`                            |
+----------------------------------------------------------------------------------------------------+
```

---

## 2. Flow 1: First Launch & Anonymous Session

When a player opens Mapolis on any device for the first time, an anonymous auth token is issued automatically in the background.

```mermaid
sequenceDiagram
    autonumber
    actor Player as 🎮 Player / Student
    participant App as 📱 Mapolis Client (Browser)
    participant Auth as 🔐 Supabase Auth
    participant DB as 🗄️ Supabase Postgres

    Player->>App: Opens Mapolis (play.mapolis.app)
    App->>App: Check localStorage for existing session
    alt No active session
        App->>Auth: POST /auth/v1/signup (Empty payload: anonymous signup)
        Auth-->>App: Returns JWT Session (access_token, refresh_token, user.id = auth_uid)
        App->>App: Save session to localStorage
    else Valid session exists
        App->>App: Reuse existing token (or auto-refresh if expiring)
    end
    App-->>Player: Title Screen & Globe ready instantly
```

---

## 3. Flow 2: Creating a Profile (Zero-Knowledge Passwords)

When a player creates a profile, the password is never sent across the internet as plain text. The browser hashes it using standard Web Crypto API (`SHA-256`), and the profile is linked to the player's anonymous `auth_uid`.

```mermaid
sequenceDiagram
    autonumber
    actor Player as 🎮 Player
    participant UI as 📱 Mapolis UI
    participant Crypto as 🔒 Web Crypto (Browser)
    participant RPC as 🛡️ Supabase RPC (`create_profile`)
    participant DB as 🗄️ Database (`profiles`)

    Player->>UI: Enters Handle: "ExplorerAlex"<br/>Password: "Secret123!"<br/>Optional Parent Email: "parent@example.com"
    UI->>Crypto: window.crypto.subtle.digest('SHA-256', "Secret123!")
    Crypto-->>UI: Returns hex hash: "a4d13e9a7e80f0c0..."
    
    UI->>RPC: POST /rpc/create_profile<br/>Headers: Authorization: Bearer <auth_token><br/>Payload: { p_handle, p_password_hash, p_parent_email, ... }
    
    Note over RPC: RPC verifies caller is authenticated (auth.uid() IS NOT NULL)<br/>Checks handle uniqueness case-insensitively
    
    RPC->>DB: INSERT INTO profiles (auth_uid, handle, password_hash, parent_email, ...)<br/>VALUES (auth.uid(), "ExplorerAlex", "a4d13e9...", ...)
    DB-->>RPC: Success (player_id UUID)
    RPC-->>UI: Returns player UUID
    UI->>UI: Save profile to localStorage (Instant offline ready)
    UI-->>Player: "Profile Created! Welcome ExplorerAlex 🚀"
```

---

## 4. Flow 3: Restoring a Profile on a New Device (Handle + Password)

This is the flow that was just successfully verified on Safari. When a player moves from a school Chromebook to a home iPad:

```mermaid
sequenceDiagram
    autonumber
    actor Player as 🎮 Player on New Device (e.g. iPad)
    participant Client as 📱 Mapolis Client (New Device)
    participant Auth as 🔐 Supabase Auth
    participant RPC as 🛡️ Supabase RPC (`restore_profile`)
    participant DB as 🗄️ Database (`profiles`)

    Note over Client: Client automatically has a NEW anonymous auth_uid on this device
    Player->>Client: Clicks "Restore Profile"<br/>Inputs: Handle "ExplorerAlex" + Password "Secret123!"
    Client->>Client: Hash password client-side: "a4d13e9a7e80f0c0..."
    
    Client->>RPC: POST /rpc/restore_profile<br/>Headers: Bearer <New_Device_Token><br/>Payload: { p_handle: "ExplorerAlex", p_password_hash: "a4d13e9..." }
    
    activate RPC
    RPC->>DB: SELECT * FROM profiles WHERE lower(handle) = lower('ExplorerAlex') AND password_hash = 'a4d13e9...'
    alt Incorrect Password or Handle Not Found
        DB-->>RPC: No match
        RPC-->>Client: 400 Bad Request ("Invalid handle or password")
        Client-->>Player: Shows error: "Invalid handle or password"
    else Match Found!
        DB-->>RPC: Returns profile row
        Note over RPC: Security Definer re-binds profile ownership:<br/>UPDATE profiles SET auth_uid = v_auth_uid (New Device)
        RPC->>DB: UPDATE profiles SET auth_uid = auth.uid() WHERE id = v_profile.id
        DB-->>RPC: Updated
        RPC-->>Client: Returns full profile JSON (stats, unlocked accessories, handle)
        deactivate RPC
        Client->>Client: _mapRowToProfile(data) -> Save to local cache
        Client-->>Player: "Profile Restored! Welcome back ExplorerAlex 🎉"
    end
```

---

## 5. Flow 4: Planned Email & Forgotten Credentials Flow (OTP)

Below is the visual blueprint for the upcoming **Pre-Beta 1** email recovery and forgotten password workflow.

```mermaid
sequenceDiagram
    autonumber
    actor Parent as 🧑‍💼 Parent / Student
    participant App as 📱 Mapolis UI
    participant Edge as ⚡ Supabase Edge Function
    participant Mail as ✉️ Email Provider (e.g. Resend)
    participant DB as 🗄️ Database (profiles & recovery_codes)

    rect rgb(240, 245, 255)
    Note over Parent,DB: Step 1: Request Recovery Code
    Parent->>App: Selects "Forgot Password / Handle"<br/>Enters email: "parent@example.com"
    App->>Edge: POST /request-recovery-code { email: "parent@example.com" }
    Edge->>DB: Lookup profiles by parent_email
    alt Email exists
        Edge->>DB: Generate 6-digit OTP ("849201") -> Save with 15-minute expiry
        Edge->>Mail: Send email: "Your Mapolis recovery code is 849201"
        Mail-->>Parent: Delivers email with OTP code
    end
    Edge-->>App: "If this email is registered, a code has been sent." (Never leaks user existence)
    end

    rect rgb(245, 255, 245)
    Note over Parent,DB: Step 2: Verify Code & Reveal Handle
    Parent->>App: Enters 6-digit code: "849201"
    App->>Edge: POST /verify-recovery-code { email: "parent@example.com", code: "849201" }
    Edge->>DB: Verify code, expiry, and mark used
    DB-->>Edge: Valid
    Edge-->>App: Returns temporary Reset Token + Student's Handle ("ExplorerAlex")
    App-->>Parent: Displays: "Found Profile: ExplorerAlex"<br/>Prompts: "Enter your new password"
    end

    rect rgb(255, 250, 240)
    Note over Parent,DB: Step 3: Reset Password & Auto-Login
    Parent->>App: Types new password ("NewSecret456!")
    App->>App: Hashes new password client-side
    App->>DB: POST /rpc/reset_password_with_token { reset_token, new_password_hash }
    DB->>DB: Updates password_hash & claims auth_uid for this device
    DB-->>App: Profile restored successfully
    App-->>Parent: Logged into game!
    end
```

---

## 6. Summary of Key Security & Architecture Principles

| Feature | How Mapolis Implements It | Benefit |
| :--- | :--- | :--- |
| **COPPA / FERPA Compliance** | Anonymous UUID sessions, minimal PII, optional parent email | Student identities and browsing habits cannot be tracked or sold |
| **Password Security** | Client-side `SHA-256` hashing before transmission | Zero-knowledge storage. Mapolis servers never see or store plain text passwords |
| **Row-Level Security (RLS)** | PostgreSQL RLS enabled on all sensitive tables | Users can only view or modify their own data directly |
| **Cross-Device Handoff** | Security-Definer RPCs (`restore_profile`) | Players can migrate progress seamlessly between school and home devices |
| **Network Resilience** | `localStorage` fallback + background sync queues | Works smoothly offline, buffering progress until a connection returns |

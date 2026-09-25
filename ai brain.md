MAPOLIS (currently working in "modularization" branch) - AI BRAIN & SOURCE OF TRUTH
1. Project Overview
Name: Mapolis
Description: A feature-rich, interactive educational geography game.
Target Audience: Students and Educators.
Security & Compliance: VERY STRICT. Must adhere to COPPA and FERPA.
No third-party tracking (no Google Fonts, no external CDNs).
Strict Content Security Policy (CSP).
Handle sanitization (no real names, no profanity).

2. The Tech Stack
Frontend: Pure HTML, CSS, and Vanilla JavaScript (No frameworks like React).
Map Rendering: D3.js and TopoJSON.
Backend: Currently using localStorage. Preparing for Supabase backend integration (Phase B).
Assets: Self-hosted Base64 embedded assets for security.

3. Current Architecture & File Structure
(We are currently modularizing the massive index.html file into separate concerns)


admin
assets
index.html
assets
shared.js
PHASE_B_BLUEPRINT.md
STEP_1_HANDOFF.md
STEP_CURRENT_HANDOFF.md
play
assets
shared.js
avatar assets
fonts.css
index.html
map data
.env.example
.gitignore
README.md
RLS_TESTS.sql
index.html

4. AI Rules for Interaction
The User (Roger): Is not a coder, but is actively learning systems architecture.
The AI Must: Explain the "Why" (architecture/concept) and the "How" (the exact syntax) for every step.
Code Rules: Do NOT use HTML tags inside CSS files. Do not introduce third-party libraries without permission. Keep everything modular (Separation of Concerns).
Ai never makes changes to the code, when ai engages any file it can READ ONLY.  The user will cut and paiste all code alterations.  
5. Current Task / Where We Left Off
We just successfully moved the Base64 fonts out of index.html and into fonts.css.
We learned about Caching, Content Security Policy (CSP), and why HTML <style> tags don't belong in .css files.


brain update #1
----------------------------------------------------------------------------------------------------------
MAPOLIS (currently working in "modularization" branch) - AI BRAIN & SOURCE OF TRUTH
1. Project Overview
Name: Mapolis
Description: A feature-rich, interactive educational geography game.
Target Audience: Students and Educators.
Security & Compliance: VERY STRICT. Must adhere to COPPA and FERPA.
No third-party tracking (no Google Fonts, no external CDNs).
Strict Content Security Policy (CSP).
Handle sanitization (no real names, no profanity).

NOTE: The "no external CDNs" rule above is a target, not current reality — see
§3 "Known Compliance Gaps" for what index.html actually loads today.

2. The Tech Stack
Frontend: Pure HTML, CSS, and Vanilla JavaScript (No frameworks like React).
Map Rendering: D3.js and TopoJSON.
Backend: Currently using localStorage. Preparing for Supabase backend integration (Phase B).
Assets: Self-hosted Base64 embedded assets for security.

3. Current Architecture & File Structure

play/index.html          ← Main SPA shell (16,604 lines total)
├── HTML Skeleton         ← 23 screen divs, body starts at line ~1864
├── Inline CSS            ← <style> block in <head>, ~1,801 lines, ~58KB
│   ├── Core theme        ← CSS variables, base layout
│   ├── Screen styles     ← Per-screen layouts (title, game, edu, admin)
│   ├── Component styles  ← Cards, buttons, toggles, chips, modals
│   └── Animations        ← Keyframes for confetti, pulses, transitions
├── Inline Scripts (2)    ←
│   ├── Title Globe       ← 128 lines, D3 orthographic spinning globe
│   └── MAIN LOGIC        ← 14,050 lines, ~588KB (THE MONOLITH)
│       └── Includes registerSW() — the PWA service worker registration
│           is a function INSIDE the monolith (called once near the top),
│           not a separate <script> block.
└── External refs         ←
    ├── D3 v7 (CDN)                ← https://cdnjs.cloudflare.com/ajax/libs/d3/7.8.5/d3.min.js
    ├── TopoJSON v3 (CDN)          ← https://cdnjs.cloudflare.com/ajax/libs/topojson/3.0.2/topojson.min.js
    ├── world-atlas country data   ← https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json
    ├── Fluent Emoji 3D icons      ← https://unpkg.com/@lobehub/fluent-emoji-3d (avatar art)
    ├── DiceBear avatar SVGs       ← https://api.dicebear.com
    ├── /assets/shared.js          ← ALREADY EXTRACTED & external (433 lines), loaded via
    │                                <script src="/assets/shared.js">. Contains Supabase
    │                                client setup (SUPABASE_URL/KEY constants), getSupabase(),
    │                                signInAnonymous(), session helpers, sync-queue keys.
    │                                Hardcodes the Supabase project URL and a "publishable"
    │                                (anon-safe) key directly in source — normal for a
    │                                client-side Supabase key, but not pulled from an env var.
    ├── avatar-assets.js           ← Avatar SVG data & config (EXTRACTED ✓, 3,357 lines / 1.2MB)
    ├── map-data.js                ← Geographic coordinates & topoJSON helpers (EXTRACTED ✓, 8,477 lines / 1.9MB)
    └── fonts.css                  ← @font-face rules & Base64 font data (EXTRACTED ✓, linked
                                      via <link rel="stylesheet">, 37 lines / ~98KB)

admin/index.html (1,519 lines, also loads ../assets/shared.js) is a separate file and has
NOT been touched by this modularization pass — everything above is about play/index.html only.

CSP Policy: Strict CSP enforced via meta tag. Currently allows 'unsafe-inline' for
scripts/styles (required because everything is inline). Supabase, cdnjs, and jsdelivr
domains are pre-authorized in the CSP's connect-src/script-src; unpkg and dicebear are
used by the code but should be double-checked against the CSP allowlist.

Known Compliance Gaps:
- 25 inline onclick="" handlers and 739 inline style="" attributes exist in play/index.html,
  despite the "keep things modular / no inline styles" intent.
- The §1 rule "no external CDNs" does not match current code: play/index.html loads from
  4 external CDN domains (cdnjs, jsdelivr, unpkg, dicebear) in addition to Supabase.

4. AI Rules for Interaction
The User (Roger): Is not a coder, but is actively learning systems architecture.
The AI Must: Explain the "Why" (architecture/concept) and the "How" (the exact syntax) for every step.
Code Rules: Do NOT use HTML tags inside CSS files. Do not introduce third-party libraries without permission. Keep everything modular (Separation of Concerns).
Ai never makes changes to the code, when ai engages any file it can READ ONLY.  The user will cut and paiste all code alterations.  

5. Current Task / Where We Left Off
Completed:
✅ Extracted avatar-assets.js (avatar SVG definitions & config arrays)
✅ Extracted map-data.js (geographic coordinate data, continent constants)
✅ Extracted fonts.css (@font-face rules & Base64 font data)
✅ Learned that <script> tags cannot be nested inside existing <script> blocks

Current State of the Monolith (main inline script, 14,050 lines):

Module                                          | Status       | Notes
-------------------------------------------------|--------------|----------------------------------------
Audio/Music (AudioMgr, MusicMgr)                  | 🔒 In monolith | Self-contained, low priority
SPA Navigation (go, goBack)                       | 🔒 In monolith | Core dependency for all screens
Profile CRUD (create, load, save, grid)           | 🔒 In monolith | Has Supabase stubs (createProfile, syncStore)
Avatar Builder (initAvatarBuilder)                | 🔒 In monolith | Reads from extracted avatar-assets.js
Map Rendering (renderMap, renderMiniMap)          | 🔒 In monolith | Reads from extracted map-data.js
Solo Game Loop (initGameScreen, handleGameClick)  | 🔒 In monolith | Core gameplay
H2H System (H2HStub, queue, match, results)       | 🔒 In monolith | Stub opponent AI, Elo rating, deck composer
Educator Dashboard (7 screens, messaging, comps)  | 🔒 In monolith | Largest module by line count
Master Admin (password gate, impersonation, notes)| 🔒 In monolith | Security-critical
Security/Compliance (handle validation, hashing)  | 🔒 In monolith | SECURITY_CONFIG, validateHandle, hashPassword
PWA SW Registration (registerSW)                  | 🔒 In monolith | Small function near the top of the monolith, not a separate script

Next Immediate Step: Extract the inline <style> block to styles.css (~1,801 lines). This is
the lowest-risk extraction because:
- CSS has no runtime dependencies on JS execution order
- Can validate by visual regression (screenshots)
- Reduces HTML file size by ~58KB

Note: /assets/shared.js is NOT a blocker for further JS extraction — it's already a
separate, readable file (not embedded in index.html), and its contents (Supabase client,
auth functions, syncStore) are known. The real remaining work is finishing the modularization process (including by determining at what granularity the index file should be split) and connecting supabase so that users can create and log into their profile.  we also need to talk about what our plan is to close the compliance gap.

brain update #2
----------------------------------------------------------------------------------------------------------
1. Completed Task: CSS Consolidation & CSP Preparation
Status: ✅ Complete
Target: `play/index.html` -> `play/styles.css`

We successfully extracted approximately 1,900 lines of CSS scattered across Mapolis into a single, unified `styles.css` file.

Crucial Discoveries During Extraction:
- **Dynamic CSS Injection:** We discovered that the original developer used an "IKEA flat-pack" pattern for the UI. JavaScript functions (`renderH2HQueue`, `renderH2HResults`, `renderGlobePage`) were manually building `<style>` tags via string concatenation (`html += '<style>...'`) and injecting them into the DOM at runtime.
- **The Fix:** We stripped the CSS out of the JavaScript variables, moved it to `styles.css`, and safely re-wired the JavaScript to only build the structural HTML `divs`.

Architectural Wins:
- **Performance:** Browsers now download and cache Mapolis styling once per session, preventing lag spikes when opening new screens. Eliminates FOUC (Flash of Unstyled Content).
- **Security (CSP):** By removing JavaScript's ability to inject raw `<style>` tags, we are systematically closing vulnerabilities to prepare for strict COPPA/FERPA Content Security Policy enforcement.

Key Technical Rules Learned:
1. **Never use HTML inside CSS:** `<style>` is an HTML tag and does not belong in a `.css` file — a CSS parser will fail to parse it correctly.
2. **CSS Comments:** Never use JavaScript `//` comments in a CSS file. Use only block comments `/* ... */`.
3. **Variable Initialization:** When building strings in JavaScript, always initialize the variable (`var html = '';`) before appending to it (`html += '...';`) to prevent `undefined` errors.

----------------------------------------------------------------------------------------------------------
2. Strategic Roadmap (What Lies Ahead)

To achieve COPPA/FERPA compliance, robust state management, and seamless offline-play, we will execute the following three phases in strict order:

### Phase A: Closing the Third-Party Compliance Gap (Immediate Next Step)
*   **The Problem:** The app currently loads libraries (D3.js, TopoJSON) and external APIs (DiceBear, Fluent Emojis) from third-party CDNs. This leaks student IP addresses and browser fingerprints, violating strict privacy constraints.
*   **The Fix:** We will determine if any of the information being used from these third-party CDNs is already available in our data files (map-data.js, avatar-assets.js, fonts.css, and styles.css), then download all missing external JavaScript and JSON dependencies into an `/assets/vendor/` directory. We will rip out the external DiceBear API entirely and replace it with local avatar generation using the previously extracted `avatar-assets.js`.
*   **Scoping note:** DiceBear is used in exactly one place — a seed-based procedural avatar generator (`.../svg?seed=...`). `avatar-assets.js` is already structured the right way to replace it (composable SVG part functions, e.g. multiple named eye/mouth/hair variants), but it was not built for deterministic seed→avatar generation the way DiceBear does it. This is not a simple URL swap — it requires writing a new seed-to-parts mapping function on top of the existing asset data.

### Phase B: Slicing the JS Monolith (Modularisation)
*   **The Problem:** A 14,050-line JavaScript monolith is an architectural liability. Furthermore, it contains inline `style=""` and `onclick=""` handlers that violate Strict CSP. (These are separate from the `<style>` block tags removed in Step 1 — 739 inline `style=""` attributes and 25 `onclick=""` handlers remain scattered through the monolith's HTML-generation code.)
*   **The Fix:** We will systematically slice the monolith into a new `/play/js/` directory using domain-driven Separation of Concerns. Extraction order:
    1.  `app.js` (Bootstrapping, PWA Service Worker)
    2.  `router.js` (SPA Navigation)
    3.  `audio.js` (Audio/Music Managers)
    4.  `security.js` (Compliance validation, hashing)
    5.  `profile.js` (User state CRUD)
    6.  `map.js` (D3/TopoJSON rendering)
    7.  `game.js` (Solo loop)
    8.  `h2h.js` (Multiplayer stub)
    9.  `dashboard.js` (Educator admin panels)
*   *Note:* During extraction, inline HTML handlers (`onclick`) will be converted to safe JavaScript Event Listeners (`addEventListener`).

### Phase C: Supabase Integration (Offline-First Source of Truth)
*   **The Problem:** `localStorage` is vulnerable to being cleared and does not persist across devices (e.g., school Chromebook vs. home iPad). Today's `loadProfiles()` reads only from `localStorage` with no network check at all, so a profile edited on one device can silently show stale data on another.
*   **The Fix:** Implement an **Offline-First Synchronization Pattern**.
    *   *Read Path:* On load, authenticate via session token and fetch the latest profile/progress from Supabase (source of truth). Only serve the cached `localStorage` copy if that fetch fails (offline or network error) — never assume the local cache is current when the network is available.
    *   *Write Path:* Update `localStorage` immediately (for zero-latency UI updates), then silently push the state to Supabase in the background via the existing `syncStore` queue logic found in `shared.js`.
*   **Scoping note:** No localStorage encryption exists yet anywhere in the current code — today's app only does password hashing (`crypto.subtle.digest('SHA-256', ...)`) and UUID generation via Web Crypto. The "encrypted localStorage" piece is genuinely new work, though the existing use of `crypto.subtle` means the browser APIs needed (e.g. `crypto.subtle.encrypt`) are readily available to build on.
----------------------------------------------------------------------------------------------------------
3. Completed Task: Supabase Account Recovery & Schema Verification
Status: ✅ Complete
Target: `database_migration.sql` -> Supabase Database

We successfully verified and restored access to profiles stored in the Supabase database that were NOT present in the local cache (`localStorage`), proving that our Supabase backend can act as the offline-first Source of Truth and successfully recover accounts across devices.

Crucial Technical Steps Taken:
- **Bypassed Connection Pooler/IPv4 Restrictions:** When standard Postgres connection methods were blocked by the lack of a paid IPv4 add-on and pooler, we successfully established a direct connection using the **Supabase Management API** (`https://api.supabase.com/v1/projects/.../database/query`) authorized by a Personal Access Token (PAT).
- **Schema Validation & Migration:** We ran `database_migration.sql` via the Management API to:
  1. Add missing recovery columns (`password_hash`, `parent_email`, `frozen`, `recovery_created_at`) and others (`stats`, `avatar_svg`, `link_code`).
  2. Fix an infinite recursion error in the RLS Admin policy (using a Security Definer function `auth_is_admin()`).
  3. Deploy the `restore_profile` and `restore_profile_by_email` RPCs (Remote Procedure Calls).
- **Data Cleansing:** We identified and deleted 2 unrecoverable profile records from the database that lacked both a password hash and a parent email, keeping the database COPPA/FERPA compliant by ensuring only legitimately recoverable and consented accounts exist.

Architectural Wins:
- **Cross-Device Recovery:** The RPCs allow a client to securely claim a profile based on credentials (password or parent email) and link it to their current `auth_uid` without violating RLS.
- **COPPA Compliance:** Enforcing that a recovered profile does not bypass RLS policies prevents unauthorized access to student profiles.

----------------------------------------------------------------------------------------------------------
4. Completed Task: Full Profile Recovery & Branch Cleanup
Status: ✅ Complete
Target: `play/index.html` & `assets/shared.js`

We successfully identified and resolved a critical bug blocking cross-device profile recovery on production. The UI now fully supports restoring a profile by Handle + Password, seamlessly synchronizing the Supabase database with the user's new local session.

Crucial Discoveries During Debugging (The Netlify vs. AI Studio Quirks):
- **Duplicate Files:** The repository contained identical copies of `shared.js` in `/assets/`, `/play/assets/`, and `/admin/assets/`. While the AI Studio preview environment automatically referenced the correct root `assets/shared.js` due to its node server configuration, Netlify's production build correctly loaded the duplicate `play/assets/shared.js` relative to the HTML file. Because the duplicate was missing the new `_mapRowToProfile()` function, profile recovery crashed only in production.
- **The Fix:** We ran a synchronization script that synced the updated `shared.js` across all directories, standardizing the application logic. 
- **Environment Variables in Production:** We transitioned from hardcoded Supabase keys to a dynamic `window.ENV` pattern (served via `/env.js`), ensuring environment variables are securely and reliably injected on both Netlify and the AI Studio preview server.
- **Clean Slate:** After fixing the issue, we completely sanitized the `main` branch, removing over 150 temporary test files, SQL patches, and backup directories generated during debugging. The `wiring-supabase` branch was hard-reset to mirror `main`.

Architectural Wins:
- **Resilient Delivery:** The application can now safely recover missing profiles in any environment (local, AI Studio preview, or Netlify production) with identical behavior.
- **Improved Security Posture:** Environment variables are properly separated from source code.


----------------------------------------------------------------------------------------------------------
5. Completed Task: Two-Way Profile Data Synchronization & Idempotent Session Tracking
Status: Complete
Target: assets/shared.js, play/index.html, and synced mirrors (play/assets/shared.js, admin/assets/shared.js)
Branch: pre-beta1

We resolved the cross-device state-overwriting problem (e.g., student plays offline on an iPad, then loads their account on a school Chromebook). Previously, naive last-write-wins (LWW) or simple property replacement ({ ...local, ...remote }) would overwrite stars, stats, or cosmetics earned on one device with stale data from another.

Core Logic Changes & Problem Solved:
1. The Stale Overwrite Hazard:
   - If Device A earned +20 stars offline and synced, and Device B later synced, Device B could either wipe Device A new stars or double-count sessions if naively summed.
2. Idempotent Session Replay with Unique Session IDs (processedSessions):
   - Every completed solo/round session now generates a unique UUID sessionId and logs an entry in profile.stats.processedSessions[sessionId] = { starsDelta, scoreDelta, questionsAnswered, timestamp }.
   - When synchronizing profiles across devices or between local cache and Supabase, the reconciliation logic inspects session IDs. Any session already incorporated on either device is accounted for exactly once, preventing double-counting or star loss.
3. Additive vs. Monotonic vs. Union Attribute Reconciler (mergeProfiles):
   - Stars & Rating (stats.cr): Reconciled using a baseline offset plus the unique symmetric union of all unmerged session deltas from both devices, with monotonic floor (Math.max).
   - Aggregate Stats (totalAnswered, totalCorrect): Summed based on unique session logs to prevent data loss.
   - Per-Mode Best Scores: Reconciled monotonically using Math.max(local, remote).
   - Badges, Cosmetics & Store Unlocks (badges, accessories, unlockedAvatar): Merged using Set union. If an item was unlocked on either device, it remains unlocked everywhere.
   - Timestamps & Metadata (updatedAt): Uses the most recent ISO timestamp; scalar attributes (handle, country, avatar selections) resolve in favor of the newer timestamp unless one is empty/null.

How It Is Accomplished in the Code:
1. assets/shared.js -> mergeProfiles(local, remote):
   - Added a dedicated pure reconciliation function that accepts local and remote profile objects.
   - Compares timestamps (local.updatedAt vs remote.updatedAt).
   - Merges local.stats.processedSessions and remote.stats.processedSessions into a combined dictionary.
   - Re-computes stars (cr) and stats based on newly resolved sessions without modifying the Supabase database schema (leverages PostgreSQL JSONB flexibility for backward compatibility).
   - Exported to both window.mergeProfiles (for browser runtime) and module.exports (for automated Node/Jest testing).
2. assets/shared.js -> syncStore._buildProfileRow(p):
   - Encapsulates stats (including processedSessions), badges, accessories, and avatar configurations into the Supabase-compatible payload with an updated ISO timestamp.
3. play/index.html -> Profile Loading & Recovery Flow:
   - Updated profile hydration paths: when remote data is fetched from Supabase, the application runs mergeProfiles(cachedProfile, remoteProfile) before writing to localStorage and refreshing the active in-game state.
   - During session completion (endRound / saveSession), the session logger generates sessionId and updates processedSessions before queuing the background sync.

----------------------------------------------------------------------------------------------------------
6. Completed Task: Direct Ledger Synchronization & Gameplay Event Accumulator (submit_round RPC)
Status: ✅ Complete
Target: assets/shared.js, play/index.html, index.html, and synced mirrors
Branch: pre-beta1

We wired the live gameplay loop directly into the Phase B gameplay ledger architecture, establishing Supabase as the source of truth for immutable gameplay history.

Core Architecture & Mechanics:
1. Client-Side Round Data Accumulator (currentRoundData):
   - When a game begins (initGameScreen / startGame), an in-memory accumulator currentRoundData is instantiated:
     {
       session: { id: mapolisUUID(), player_id, started_at, ended_at, mode, tier, category, final_score, cards_answered, cards_correct },
       card_attempts: [],
       star_events: [],
       progress_updates: []
     }
2. Per-Interaction Event Capture:
   - In handleGameClick, every card answered appends an item to currentRoundData.card_attempts with card_id, category, correct. (Unused time_ms and answered_at fields pruned to optimize payload size and ledger storage).
   - Every star awarded appends to currentRoundData.star_events with amount, reason ('correct_answer'), earned_at.
3. Transactional Submission via submit_round RPC:
   - When the round concludes (endGame -> renderResults), the entire accumulated payload is finalized and transmitted via submitRound(payload) calling the PostgreSQL RPC submit_round.
   - The RPC executes an idempotent insert (ON CONFLICT (id) DO NOTHING) on sessions, card_attempts, star_events, and updates progress.
4. Resilient Offline-First Caching:
   - If offline or if the RPC call encounters network failure, the full payload is preserved in localStorage under mapolis_pending_rounds.
   - Automatic retry and cache eviction via flushPendingRounds occur upon reconnection and successful submission.

----------------------------------------------------------------------------------------------------------
7. Completed Task: Card Attempts Payload & Schema Streamlining
Status: ✅ Complete
Target: Supabase Database, play/index.html, index.html, docs/
Branch: pre-beta1

We safely removed unused per-question telemetry (`time_ms` and `answered_at`) across both the database schema and application code.

Key Changes:
1. Supabase Database Migration:
   - Dropped `time_ms` and `answered_at` columns from `card_attempts` table.
   - Updated `submit_round(payload jsonb)` RPC to insert only `(id, session_id, player_id, card_id, category, correct)`.
2. Application Code (`play/index.html` & `index.html`):
   - Streamlined `currentRoundData.card_attempts.push(...)` in `handleGameClick` to record `card_id`, `category`, and `correct`.
   - Reduced client JSON payload size during active gameplay and batch transmission.
3. Verified Zero Regressions:
   - Tested live `submit_round` RPC execution against Supabase: verified 204 status and valid insertion in `card_attempts` & `star_events`.
   - Verified that all student and educator dashboards, profile readouts, and results screens function normally.
4. Deployed to Test URL:
   - Deployed to Netlify test alias: https://test-ledger--mapolis-play.netlify.app/play/

----------------------------------------------------------------------------------------------------------
8. Completed Task: Durable Cloud-as-Ledger Profile Sync & Multi-Device State Reconciliation
Status: ✅ Complete
Target: assets/shared.js, play/index.html, index.html, server.js, build-env.js, and synced mirrors
Branch: pre-beta1

We upgraded the profile synchronization layer to treat Supabase as the authoritative, durable ledger across all devices, anonymous session boundaries, and network states.

1. What It Is:
   - Cross-Device Identity Bridging: Allows devices with distinct anonymous Supabase Auth UIDs to fetch and synchronize profiles using composite queries matching either the session auth UID or known local player IDs.
   - Freshness on Profile Selection: When tapping a profile card, the client queries Supabase in real-time (`fetchProfileById`) and applies conflict-free reconciliation (`mergeProfiles`) before entering the setup/gameplay screen.
   - Background Cloud Sync: Background re-fetch (`refreshProfilesFromCloud`) executed on opening the profile selection screen (`s-profiles`), ensuring cards, avatars, and streak indicators reflect the latest cloud state.
   - Hardened Profile Recovery: Resilient Handle/Password and Parent Email restore RPC workflows (`restore_profile` and `restore_profile_by_email`) with automated pre-flight session guarantees, URL sanitization, and user-friendly error translations.

2. Why We Chose It:
   - Cross-Device Anon Auth Divergence: Supabase anonymous auth assigns distinct `auth.uid()` values to each browser/device. Device B was previously blind to updates pushed by Device A even though Device B had the student's `player_id`.
   - Stale Local Cache: Selecting a profile previously pulled exclusively from local memory/localStorage, meaning cosmetic changes or score gains from another device were ignored until an explicit recovery operation.
   - Mobile Restoration Failures: Raw JSON errors and PostgREST path collisions (`/rest/v1//rest/v1/...`) caused confusing, unformatted error strings on mobile browsers (e.g., iPhone) during profile restoration.
   - Ledger Integrity: Ensures all player state—including store purchases (such as reservation animals like the hedgehog), star balances (CR), and badges—persists reliably in Supabase and synchronizes deterministically.

3. How We Achieved It:
   - `assets/shared.js`:
     - Added `fetchProfileById(playerId)` to fetch single profiles directly by ID with authenticated headers.
     - Enhanced `fetchProfiles(authUid, localProfileIds)` with PostgREST composite filter: `?or=(auth_uid.eq.<uid>,player_id.in.(<id1>,<id2>,...))`.
     - Added `_sanitizeSupabaseUrl()` to automatically strip redundant `/rest/v1` prefixes and trailing slashes across all runtime environments.
     - Implemented `ensureAuthSession()` to ensure an active anonymous session token is present prior to invoking RPC endpoints requiring `auth.uid()`.
   - `play/index.html` & `index.html`:
     - Updated `selectProfile(index)` to query `syncStore.fetchProfileById` with a network timeout fallback and apply `mergeProfiles` on return.
     - Added `refreshProfilesFromCloud()` hooked into the `go()` screen transition for `s-profiles`.
     - Wrapped restore forms (`restore-pw-submit` and `restore-email-submit`) with `ensureAuthSession()`, visual button loading states (`Restoring...`), and human-friendly toast messages.
     - Verified live durability: successfully checked and confirmed real gameplay session stats and animal store purchases (`["a_hedgehog"]`) in Supabase for the `Cc` test profile.

----------------------------------------------------------------------------------------------------------
9. Completed Task: Instant Avatar Edit Responsiveness & Screen Lifecycle Refresh
Status: ✅ Complete
Target: play/index.html, index.html, and synced mirrors
Branch: pre-beta1

We eliminated avatar rendering latency so changes made in the Avatar Builder immediately appear on whichever screen the user returns to, without requiring a manual page refresh or transition.

1. What It Is:
   - Zero-latency avatar rendering and screen lifecycle re-execution when saving an avatar customization.
   - Whether returning to the Profile page (`s-profile`), Setup (`s-setup`), or Profile Selection (`s-profiles`), the updated avatar displays immediately.

2. Why We Chose It:
   - Broken User Feedback Loop: Previously, after finishing an avatar edit, `goBack()` returned to the previous screen by simply toggling CSS classes. Because the screen renderer (e.g. `renderProfile()`) was not re-executed, the screen continued displaying the old avatar until the user navigated away to another page and back.
   - User Trust: Delay or lack of visual feedback gave users the impression that their customization had failed or was lost.

3. How We Achieved It:
   - Screen Lifecycle Dispatcher on Back Navigation (`triggerScreenRefresh` in `goBack()`):
     - Added `triggerScreenRefresh(screenId)` to `goBack()` in `play/index.html`. Returning to a screen automatically calls its renderer (`renderProfile()`, `renderProfileGrid()`, `initSetupScreen()`, etc.) and triggers `updateAvatarBars()`.
   - Synchronous In-Memory Cache & Pre-Transition Render:
     - In `_avFinishAndSave()`, updated the in-memory `allProfiles` collection alongside `activeProfile`, stamped a fresh `updatedAt` ISO timestamp, and called `renderProfile()`, `renderProfileGrid()`, and `updateAvatarBars()` immediately before invoking navigation.
   - Comprehensive Avatar Container Targeting (`updateAvatarBars()`):
     - Expanded DOM selectors to target all avatar wrappers across the app: `.setup-ava-btn`, `#setup-ava`, `.setup-hero-ava`, `#setup-hero-ava`, `#edu-dash-hero-ava`, `.gp-ava`, `#gp-ava`, `.fb-ava`, `#fb-ava`.
     - Cleanly handles SVG images, data URLs, and emoji fallbacks with circular clipping and overflow management.
   - Preserved Navigation History Context:
     - Ensured `shouldGoBack` detects when the avatar builder was opened from `s-profile`, returning directly to the profile view with the updated avatar instantly visible.



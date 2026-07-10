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
docs
DATA_FLOWS.md
H2H_BUILD_HANDOFF.md
PATH_TO_LLC.md
PHASE_5_HANDOFF.md
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
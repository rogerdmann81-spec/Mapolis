# Mapolis — Phase B Blueprint
## Web Beta Publish Checklist

**Purpose:** Take the current `mapolis_v4.html` from a localStorage-only single file to a live, multi-user web beta at a public URL with: admin extracted, Supabase backend, educator/classroom model, and a working debug plan. This is the foundation that Phases C (iOS) and D (Android) will sit on top of.

**Mental model:** One game file. One admin file. One Supabase backend. Two URLs (`play.` and `admin.`). Everything in this document is web-only. iOS/Android come later and reuse this work — they do not duplicate it.

**How to use this document:** Work top to bottom. Do not skip verification gates. Each step has an exit criterion — if it isn't met, stop and fix before moving on. Mark steps complete as you go.

**Phase 1 status (April 2026):** Handle moderation, student messaging restrictions, account recovery scaffolding, and compliance-age controls are already implemented in `mapolis_v4.html`. See the **"Phase 1 Completion Summary"** section. Several downstream sections in this document have been annotated to reflect those changes — look for **"⚠ PHASE 1 CHANGE"** callouts.

**Beta scope status (April 9, 2026):** The Phase B push has been scoped down to an **invite-only beta** focused on testing the game in its intended environment. Monetization, parental purchase flow, privacy policy/ToS finalization, and LLC formation have been deferred — they reactivate before the public launch. Look for **"⚠ BETA SCOPE CHANGE"** callouts throughout this document marking what's deferred and what stays in scope. The full deferral list and the locked architectural decisions for the trimmed scope are documented in **§0.8** below.

---

## 0. Pre-Flight Decisions (Lock These Before Any Code)

These are decisions that ripple through everything downstream. Locking them now prevents painful refactors later.

- [ ] **0.1 — App Store category committed:** Education / 4+ rating / ads allowed. *(Already decided. Note: ads themselves are deferred per §0.8 — only the category designation persists.)*
- [ ] **0.2 — Account model committed:** Educator-owned classrooms; students join with a code; no student PII. *(Already decided.)*
- [ ] **0.3 — Domain names chosen.** ✅ **`play.mapolis.app` and `admin.mapolis.app`.** Note: `mapolis.com` is owned by mapolis AG (a German B2B real estate platform — different category, no legal conflict, but the `.com` is unavailable). The `.app` TLD is the primary; defensive registration of `mapolis.io`, `getmapolis.app`, and `playmapolis.app` recommended.
- [ ] **0.4 — Legal entity confirmed.** ⚠ **BETA SCOPE CHANGE:** LLC formation is **deferred** for the invite-only beta. The full path to formation is documented in `PATH_TO_LLC.md`; that document remains canonical and will be executed before the public launch. For the invite-only beta, the domain is registered in the operator's personal name as a tracked TODO to transfer when the LLC forms.
- [ ] **0.5 — Privacy policy and Terms of Service drafted.** ⚠ **BETA SCOPE CHANGE:** **Deferred for the invite-only beta.** The site is not collecting payments, the user pool is small, known, and consented to participate, and there are no third-party trackers. The privacy policy and ToS are still required before the URL becomes truly public — they reactivate as a hard gate on §10 before the public launch. For the invite-only push, beta testers receive plain-language disclosure in the invite email.
- [ ] **0.6 — Beta tester list finalized.** Names, emails, and which testers are educators vs. students. This determines what test data we seed. **For the invite-only beta:** also documents who has accepted invitation terms.
- [x] **0.7 — Head-to-head mode committed for beta.** ✅ **BUILT AND PLAYABLE (April 2026).** Networked 1v1, 60-second rounds, +1 correct / −0.5 incorrect, no tier matching for beta (anyone vs anyone), shared card pool drawn from the **lower-ranked player's tier** (`min(yourGrade, oppGrade)` floored, via `getTierCeiling(grade, 'medium')`). Elo-style competitive rating as a second leaderboard category alongside the existing engagement-based Star Bank. Entry from continent selection screen. All three UI mockups approved and shipped:
    - **Queue screen with spinning globe — APPROVED & SHIPPED.** Spec in 6.5.2.
    - **In-match dual-score HUD (Mockup B) — APPROVED & SHIPPED.** Reuses `s-game` with a mode flag.
    - **Results screen (v5) — APPROVED & SHIPPED.** Clean avatars, three Rematch states, columned W/L/T record.
    - Current implementation runs against a local `H2HStub` module so the flow is fully playable against a bot. Swap to Supabase Realtime in Section 6.5 is the remaining work for this item.

**Verification gate 0:** All seven items checked (with the deferred ones explicitly marked deferred). Domain names recorded:

> **Public game URL:** play.mapolis.app
> **Admin URL:** admin.mapolis.app
> **Privacy policy URL:** mapolis.app/privacy *(deferred — see §10)*
> **Terms of Service URL:** mapolis.app/terms *(deferred — see §10)*

---

## 0.8. ⚠ BETA SCOPE CHANGE — Invite-Only Beta Decisions (April 9, 2026)

**Why this section exists:** The Phase B build was originally scoped to ship a fully-monetized public web beta with parental purchase flows, ad infrastructure, finalized legal docs, and an LLC behind it. Mid-planning, the goal was clarified: **what we actually need first is to test how the game works in its intended environment with real users on real devices.** Building the monetization and legal stack before learning whether the game itself holds up is the wrong order.

This section documents the trimmed scope, the items deferred, and the architectural decisions locked in for the trimmed scope. Every later section in this document carries a **⚠ BETA SCOPE CHANGE** callout where the trimming affects it.

### What ships in the invite-only beta

| Section | Scope |
|---|---|
| §1 Repo + Netlify | **In** — full scope |
| §2 Admin extract + `shared.js` | **In** — full scope |
| §3 Data flow doc | **In** — written inline in this document, not a separate file |
| §4 Supabase schema + RLS | **In** — full scope, with the architectural changes in this section |
| §5 Auth wiring | **In** — full scope |
| §6 Game write paths | **In** — replaced with end-of-round batching strategy (see below) |
| §6.5 H2H backend swap | **In** — full scope |
| §7 Admin reads + educator views | **In** — adds per-student card-attempt view as the headline new feature |
| §8 Monetization scaffolding | **DEFERRED** — no ad slots, no provider abstraction |
| §9 Stripe / parental purchase | **DEFERRED** — no payments at all |
| §10 Privacy policy / ToS | **DEFERRED** — replaced by plain-language disclosure in invite emails |
| §11 Smoke test + invite | **In** — invites limited to a known, capped tester list |

### What gets deferred

- **Monetization (§8):** No `MonetizationProvider` interface, no ad slots in the UI, no AdMob integration, no educator/classroom bypass logic (because there's nothing to bypass). All ad-related code stays out of the build.
- **Stripe / Parental Purchase (§9):** No Stripe account, no parental verification email flow, no `purchase_requests` or `purchases` tables, no Edge Function for webhook handling. The corresponding columns on `profiles` (`ads_removed`, `educatorSubscription`) are not added.
- **Parental Gate Component:** The math-problem modal that gates external links and purchases is not built — there are no purchases to gate and the invite-only audience is not browsing external links from inside the app.
- **Privacy Policy + ToS (§10):** Not finalized, not linked from the app footer. Beta testers receive plain-language disclosure in the invitation email instead. The full policy reactivates as a hard gate before public launch.
- **LLC Formation (§0.4):** `PATH_TO_LLC.md` remains canonical, but the formation work is sequenced after the beta validates the game. Domain registered personally for now.

### What this enables

- **Faster ship.** Cutting four sections of work means the beta can stand up in roughly half the time of the full Phase B push.
- **Cleaner debugging.** Fewer moving parts in the data layer (no purchase webhooks, no ad slot lifecycle, no `ads_removed` flag) means fewer surfaces where something can break during testing.
- **Honest scope.** Building monetization before validating the product is putting the cart before the horse. Building legal infrastructure for a product with three known testers is overengineering.

### Locked architectural decisions for the trimmed scope

These five decisions were locked during the planning session that produced this scope cut. They are inputs to all later sections; they are not topics for re-litigation during execution.

#### Decision 1 — Schema shape: NORMALIZED

Separate tables for `profiles`, `sessions`, `card_attempts`, `star_events`, `progress`. H2H tables (`matches`, `match_players`, `match_events`, `competitive_ratings`, `match_results`) also normalized per the original §6.5 design.

**Why:** The educator product's core value proposition is "the educator can see which students are getting which questions wrong." That capability requires per-card-attempt rows with `(student_id, card_id, correct, timestamp)` — it cannot be served by aggregate columns on `profiles`. Normalizing now prevents a forced migration mid-beta the first time an educator asks "which countries is my class struggling with."

**What it means downstream:** §4 schema is the full normalized version. §6 game write paths split into multiple builder functions. §7 gains the educator card-attempt view as a headline new feature.

#### Decision 2 — Player ID: DUAL-KEY with `auth_uid`

Local profile keeps its `crypto.randomUUID()`-generated `id` as `player_id` (primary key in Supabase). The Supabase `profiles` row also carries an `auth_uid` column populated from the anonymous-auth `auth.uid()`. RLS uses `WHERE auth_uid = auth.uid()`.

**Why:** The current game's profile picker UI lets one device host multiple local profiles (kid, sibling, parent, classroom shared device). Anonymous Supabase auth gives each device exactly one `auth.uid()`. A single-key approach (where `profile.id` becomes `auth.uid()`) would silently break the multi-profile-per-device pattern. Dual-key handles the family-shared-device case naturally: one device → one `auth_uid` → multiple `player_id` rows in Supabase, all readable/writable by that auth user.

**What it means downstream:** §4 schema gains an `auth_uid` column with index on every owned table. §5 auth wiring writes `auth.uid()` back to local profiles on first sign-in. RLS policies are slightly less idiomatic (one extra column reference) but handle multi-profile correctly.

#### Decision 3 — Solo write strategy: END-OF-ROUND TRANSACTIONAL BATCH

During gameplay, every card answer / star earned / progress event accumulates in an in-memory `roundData` object. Nothing touches Supabase mid-round. At round-end, one HTTP call invokes a Postgres RPC `submit_round` that splits the payload into the right tables in a single transaction.

```js
roundData = {
  session: { id, player_id, started_at, ended_at, mode, tier, category,
             final_score, cards_answered, cards_correct },
  card_attempts: [ { card_id, category, correct, time_ms, answered_at }, ... ],
  star_events:   [ { amount, reason, earned_at }, ... ],
  progress_updates: [ { screen_id, state_json, updated_at }, ... ]
}

await supabase.rpc('submit_round', { payload: roundData });
```

**Why:** End-of-round batching sidesteps three problems with mid-round per-event writes: (1) mid-round network failures create partial sessions, (2) sync queue logic gets complicated when items batch differently across tables, (3) network chatter during gameplay competes with the player's responsiveness budget. With end-of-round batching, the round either lands fully or doesn't land at all, there's no queue logic at all (the round object IS the batch), and the network call happens during the results screen when nobody's watching.

**Failure handling:** If the RPC fails, cache the entire `roundData` object in localStorage under a `pending_rounds` key. Flush on next round-end and on next app open. Idempotent because the session_id is client-generated — the server can `ON CONFLICT DO NOTHING` if the round already landed.

**RLS implication:** The `submit_round` RPC runs as `SECURITY DEFINER` and checks at the top of the function that the payload's `player_id` belongs to a profile owned by `auth.uid()`. Write-path RLS on `sessions`, `card_attempts`, `star_events`, `progress` becomes "no direct INSERT allowed, only the RPC writes" — simpler than per-table write policies. Read RLS still applies normally for the educator dashboard queries.

**What it means downstream:** §6 replaces the originally-planned per-event sync queue with the `roundData` accumulator + `submitRound()` flow. Sync queue infrastructure gets simpler, not more complex.

#### Decision 4 — H2H write strategy: PER-EVENT REALTIME (unchanged) + `finalize_match` RPC

H2H is the exception to Decision 3. H2H matches need *live* score updates flowing between two players during the match — that's what makes the dual-score HUD work and what makes the gameplay feel competitive. Live score updates require Realtime broadcasts, not batch-at-end.

So H2H keeps its original §6.5 design: `match_events` rows insert per-card mid-match, `match:<match_id>` Realtime channel broadcasts to both clients. Match finalization (Elo update, `match_results` insert, status flip to `finished`) gets the same RPC pattern as solo via a `finalize_match` Edge Function — one transactional call at match-end that does all the cleanup.

**What it means downstream:** §6.5 backend swap is unchanged from the original blueprint design. Two write paths exist in the system: solo via `submit_round`, H2H via per-event broadcasts + `finalize_match`. They write to disjoint sets of tables.

#### Decision 5 — Backfill: NONE

No profiles in Supabase yet. All existing data is local and discardable. Beta starts clean.

**Why:** The user-base for the beta is the operator + a few invitees. Pre-existing localStorage data on the operator's dev devices is throwaway test data. Nothing needs to migrate from local to server.

**What it means downstream:** §4 schema is whatever shape we want on day one with no historical-data constraints. §6 client refactor doesn't need backfill logic. The "synthesize fake card_attempts from aggregate stats" problem that would have made normalization expensive disappears entirely.

### Reactivation triggers (when these come back)

The deferred items reactivate on these triggers, not on a calendar date:

| Deferred item | Reactivation trigger |
|---|---|
| Privacy policy + ToS (§10) | Before any URL becomes public-link-shareable beyond the invite list |
| LLC formation (§0.4) | Before any commercial transaction (Stripe account, App Store enrollment, business bank account) |
| Monetization (§8) | Before public launch — needs to be in place before the App Store submission |
| Stripe / parental purchase (§9) | Same as monetization |
| Parental gate component | Same as monetization |

When any of these triggers fire, return to the corresponding section of this document and execute it as originally written.

---

## 0.5. Phase 1 Completion Summary (April 2026 — Already Shipped)

**Status:** Complete in `mapolis_v4.html`. No further client work required on these items for Phase B beta launch; the notes here exist so whoever wires the backend knows what to expect and what fields to provision.

Phase 1 was the pre-publish compliance hardening pass. It closed four categories of risk that would have blocked App Store review or created COPPA / GDPR-K / state-law exposure at the website level:

### What shipped

**Handle moderation system** — `validateHandle()`, `looksLikeRealName()`, `containsProfanity()`, auto-suggest-safe-handle fallback via `generateSafeHandle()`. Enforced on the profile creation flow AND on the new rename flow. Matches against ~772 common US first names and ~743 common US surnames; blocks "firstname lastname" combinations, single surnames (while allowing single first names like "Dale"), and a curated ~60-word profanity list including simple leetspeak normalization. The lists are marked as editable constants near the top of the script block.

**Student messaging hardening** — free-text message composition is disabled for any profile whose `isEducator` flag is false. Student compose UI renders a fixed set of templates (`STUDENT_MSG_TEMPLATES`, 8 starter templates: "I finished the assignment," "I have a question," "Can you help me?," etc.) that are the only strings a student can send to an educator. `sendMessage()` now accepts an optional `templateId` parameter for analytics attribution later. Educator compose UI still allows free text (educators are adults, different rules).

**Age-branched account recovery** — user-picked handles (not auto-generated) combined with optional recovery data collected at signup, branched on age:
- **Age ≥ 18:** optional password (min 8 characters). Password is SHA-256 hashed via Web Crypto and stored as `passwordHash` on the profile. Used with their handle to restore the profile if browser storage is cleared.
- **Age < 18:** optional parent/guardian email stored as `parentEmail` on the profile. Used as the recovery identifier AND as the destination for eventual verifiable parental consent emails in Section 9. Clear "ask a parent first" warning.
- **"Restore Profile" modal** on the profile-picker screen with two tabs (handle + password / parent email) that matches against the locally-stored profile list. Pre-backend this is device-local only; post-backend it becomes a real cross-device lookup.
- **Handle uniqueness** enforced on both create and rename via `isHandleTaken()` (device-local for now; TODO swap for Supabase RPC when backend lands).
- **Handle rename flow** — new `openRenameHandleModal()` invoked from a ✏️ button next to the handle on the profile screen. Reuses all the same validators.

**Compliance age threshold raised to 18** — stored as `CONSENT_AGE_THRESHOLD = 18` constant. This is stricter than COPPA's 13 but aligns with the Texas / Utah / Louisiana app store accountability laws (2026) and California's Digital Age Assurance Act (2027), which all treat under-18 as minors requiring parental consent. The age at profile creation is snapshotted to `consentAgeAtCreate` so future threshold changes don't retroactively re-classify existing profiles.

**Educator unlock age gate** — the legacy `unlockEducatorMode()` self-toggle is age-gated to 18+ as defense-in-depth (UI gate in `renderProfile` + authoritative check in the function itself). **This is transitional** — per Section 5.3 below, the self-unlock code path is going to be deleted entirely when the proper "I'm a teacher" Supabase Auth flow lands. Both call sites are tagged with `TODO(phase-b-5.3)` so future cleanup is obvious.

### New profile fields that need Supabase schema support

When Section 4 schema gets written, the `profiles` table needs these additional nullable columns:

| Column | Type | Purpose |
|---|---|---|
| `parent_email` | `text` nullable | Parent/guardian email for under-18 profiles; used for recovery + consent flow in Section 9 |
| `password_hash` | `text` nullable | Hex SHA-256 of password for 18+ profiles; used with handle for self-serve profile recovery |
| `recovery_created_at` | `timestamptz` nullable | Timestamp when recovery data was set (for audit / "last updated" display) |
| `consent_age_at_create` | `smallint` nullable | Snapshot of `CONSENT_AGE_THRESHOLD` at profile creation time |
| `auth_uid` | `uuid` nullable, indexed | **⚠ BETA SCOPE CHANGE:** Supabase anonymous-auth UID. Populated on first sign-in. RLS pivot column. See §0.8 Decision 2. |

`_buildProfileRow()` in `mapolis_v4.html` already emits the first four fields; `auth_uid` is added in §6 as part of the dual-key migration.

### Architectural deviation from original blueprint

The original Section 3 / Section 5 design said:

> **Student** — anonymous Supabase session. Joined to a classroom via 6-character code. **No email, no name.**

Phase 1 deviates from this in two ways, both deliberate:

1. **User-picked handles, not auto-generated.** The original rationale for auto-generated usernames was "no PII." Phase 1 preserves that goal through the moderation system (validated handles cannot contain real-name patterns or profanity) while giving users the ownership they expect from a consumer product.
2. **Optional recovery data at signup, age-branched.** The original design assumed the Supabase session token *was* the identity and recovery meant "join a classroom to get re-linked." That works for educator-managed students but leaves solo consumer players with no recovery path if they clear browser storage. The Phase 1 addition gives every user an optional escape hatch without forcing data collection.

### What Phase 1 did NOT solve (still on the Phase B backlog)

- **Real parental consent delivery.** ⚠ **BETA SCOPE CHANGE:** Deferred — see §0.8. Reactivates with §9.
- **True cross-device recovery.** §4 (Supabase schema) + the recovery hash columns above will make it real.
- **Handle uniqueness at global scope.** Requires a Supabase `UNIQUE` index on `lower(handle)`.
- **Rate limiting on recovery attempts.** Post-backend, add server-side rate limiting (e.g. 5 attempts per hour per IP).

---

## 1. Repository and Environment Setup

**Goal:** Get the file out of the chat-upload-each-session pattern and into a real version-controlled environment so changes are recoverable.

**⚠ BETA SCOPE CHANGE:** This step has its own dedicated handoff document — `STEP_1_HANDOFF.md` — that walks through the work in a fresh-chat-executable format. The summary below is the high-level scope; the handoff doc is the executable detail.

- [ ] **1.1** Create a private GitHub repo: `<your-org>/mapolis`
- [ ] **1.2** Commit current `mapolis_v4.html` as the baseline (renamed to `index.html` or moved into `play/`). Tag it `pre-phase-b-step-1`.
- [ ] **1.3** Add `.gitignore` for `node_modules/`, `.env`, `.env.local`, `dist/`, `ios/`, `android/`.
- [ ] **1.4** Create directory structure (use the subdirectory layout from `STEP_1_HANDOFF.md` for clean two-site Netlify setup):
    ```
    /
      play/
        index.html              (the game)
      admin/
        index.html              (stub for now)
      assets/                   (any external files; shared.js lands here in Step 2)
      docs/
        PHASE_B_BLUEPRINT.md    (this file)
        PATH_TO_LLC.md          (canonical merged version, not the legacy variants)
        H2H_BUILD_HANDOFF.md    (historical)
        PHASE_5_HANDOFF.md      (historical)
        STEP_1_HANDOFF.md       (this step's handoff)
      .env.example              (template — no real keys)
    ```
- [ ] **1.5** Set up Netlify account, link to repo, configure two sites pointing at the same repo with different base/publish directories:
    - Site 1: `play.mapolis.app` → base directory `play/`, publish directory `play/`
    - Site 2: `admin.mapolis.app` → base directory `admin/`, publish directory `admin/`
- [ ] **1.6** Add custom domains to both Netlify sites and verify HTTPS is active.

**Verification gate 1:** Push a trivial change (add an HTML comment), confirm both Netlify sites auto-deploy, and confirm both URLs load over HTTPS in a browser. Roll back the trivial change.

---

## 2. Admin Extraction

**Goal:** Pull admin UI and admin-only logic out of the game file into `admin/index.html`. Educator interface stays in the game per your direction. Game must still write all the data the admin needs to read.

- [ ] **2.1** Audit the current file and tag every block as one of:
    - **GAME** — gameplay, map rendering, audio, content data → stays in `play/index.html`
    - **EDUCATOR** — classroom mgmt UI used by teachers from inside the game → stays in `play/index.html`
    - **ADMIN_UI** — admin dashboard, charts, user management → moves to `admin/index.html`
    - **ADMIN_LOGIC** — admin-only mutations (resets, exports, moderation) → moves to `admin/index.html`
    - **SHARED** — utilities, Supabase client, models → extracted to `/assets/shared.js` and loaded by both — preferred
- [ ] **2.2** Create `/assets/shared.js` containing: Supabase client init, auth helpers, common data models, and the existing `syncStore` module (currently inline in the game file around line 19173). ⚠ **BETA SCOPE CHANGE:** No `MonetizationProvider` interface and no parental gate component — both are deferred. Both `play/index.html` and `admin/index.html` will load this shared file.
- [ ] **2.3** Create the real `admin/index.html` (replacing the Step 1 stub). Copy ADMIN_UI and ADMIN_LOGIC blocks into it. Wire it to load `/assets/shared.js`.
- [ ] **2.4** Strip ADMIN_UI and ADMIN_LOGIC out of `play/index.html`. Leave EDUCATOR blocks intact.
- [ ] **2.5** Confirm no game-side code calls anything that was moved. Search for orphaned references.

**Verification gate 2:**
1. Open `play/index.html` locally — game launches, all gameplay works, educator tools work, no console errors.
2. Open `admin/index.html` locally — admin shell loads (will be empty of data because Supabase isn't wired yet, but no JS errors).
3. Filesize check: `play/index.html` is meaningfully smaller than `mapolis_v4.html`. Record before/after sizes here:

> **Before:** _______ KB **After:** _______ KB **Reduction:** _______ KB

---

## 3. Data Flow Design (Inline)

**Goal:** Document who writes what, who reads what, and how RLS enforces it. Reflects the locked decisions in §0.8.

⚠ **BETA SCOPE CHANGE:** Originally this section produced a separate `docs/DATA_FLOWS.md` file. For the invite-only beta, the data flow lives inline in this document so there's a single source of truth and the architectural decisions can't drift between two files.

### 3.1 Authentication actors

- **Educator** — registered with email + password. Owns classrooms.
- **Student** — Supabase anonymous session. User picks a handle at signup, validated against the moderation system (see Phase 1 Completion Summary). User optionally provides recovery data, branched on age: parent email for under-18, optional password (stored as a hash) for 18+. **⚠ PHASE 1 CHANGE:** this replaces the original "anonymous + auto-generated username + no email" design.
- **Admin** — registered email + password + `is_admin` flag set in `profiles` table by manual SQL. Cannot be created from the UI.

### 3.2 Identity model (locked per §0.8 Decision 2)

Each player has TWO identifiers:

- **`player_id`** — `crypto.randomUUID()` generated client-side at profile creation. Stable forever. Primary key in Supabase. Used as the `profile_id` foreign key in every owned table.
- **`auth_uid`** — Supabase anonymous-auth `auth.uid()`. One per browser/device. Multiple `player_id` rows can share an `auth_uid` (the family-shared-device case).

RLS pivots on `auth_uid`. Every owned table has either an `auth_uid` column directly or a `profile_id` that joins to `profiles.auth_uid`.

### 3.3 Solo write paths (game → Supabase)

⚠ **BETA SCOPE CHANGE — Decision 3:** All solo writes happen at end-of-round via a single transactional RPC, not per-event during gameplay.

**During gameplay:** No Supabase calls. Card answers, star events, and progress updates accumulate in an in-memory `roundData` object on the client.

**At round-end:** One call.

```js
await supabase.rpc('submit_round', { payload: roundData });
```

The `submit_round` Postgres function:
1. Validates that `payload.session.player_id` belongs to a profile owned by `auth.uid()` (auth check at top, raises exception on mismatch)
2. Inserts the `sessions` row, capturing the new session_id
3. Bulk-inserts all `card_attempts` rows linked to that session_id
4. Bulk-inserts all `star_events` rows
5. Upserts all `progress` rows
6. All in one transaction — round is atomic

**On RPC failure:** Client caches the entire `roundData` object in `localStorage` under `mapolis_pending_rounds[]`. Retried on next round-end and next app open. Idempotent because session_id is client-generated and tables use `ON CONFLICT DO NOTHING`.

### 3.4 H2H write paths (unchanged from original §6.5)

- Player enters h2h queue → `match_queue` insert
- Server pairs two queued players → `matches` insert, two `match_players` inserts, both `match_queue` rows deleted (Edge Function `pair-queue`)
- Player answers a card mid-match → `match_events` insert + Realtime broadcast on `match:<match_id>` channel
- Match ends → both clients call `finalize_match` Edge Function (idempotent — only first call does work):
  - Sums `score_delta` per player from `match_events`
  - Determines winner / tie
  - Computes Elo update (K=32, starting 1200)
  - Updates `competitive_ratings`
  - Inserts two `match_results` rows
  - Updates `matches.ended_at`, `matches.winner_id`, `matches.status = 'finished'`

### 3.5 Realtime channels (Supabase Realtime)

- `queue:lobby` — presence channel; clients join on entering the queue, leave on exit/match. Used to count "players in queue" and "players online" for the queue screen counter.
- `match:<match_id>` — per-match channel; both players subscribe on match start. Score updates and card-answer events broadcast here for the live HUD.

### 3.6 Read paths

- **Game (student) reads:** own `profiles` row (matched on `auth_uid = auth.uid()` and `player_id = active_profile.id`), own `progress`, own `classroom_members`, own `star_events` history, own `competitive_ratings` row, own `match_results` history
- **Educator reads:** their own `classrooms`, all `profiles` for students in their classrooms, **and per-student `card_attempts` history grouped by category** (the Decision-1-justifying feature; built in §7)
- **Admin reads:** everything
- **Public reads (no auth required):** top-N `competitive_ratings` for the competitive leaderboard, top-N `profiles.cr` for the engagement leaderboard

### 3.7 RLS policy summary

**Owned tables (`profiles`, `sessions`, `card_attempts`, `star_events`, `progress`):**
- READ: row visible if it belongs to a profile where `auth_uid = auth.uid()` OR if requester is educator of a classroom this profile belongs to OR if requester is admin
- WRITE: **NO direct INSERT/UPDATE allowed.** All writes go through the `submit_round` RPC which runs `SECURITY DEFINER` and does its own auth check at the top. This is simpler than per-table write policies and impossible to bypass without server-side cooperation.
- EXCEPTION: `profiles` table allows direct UPDATE on the row matching `auth_uid = auth.uid()` for handle renames, recovery data updates, etc. Insert into `profiles` only allowed via `create_profile` RPC (also SECURITY DEFINER, validates handle uniqueness and moderation server-side).

**Classroom tables (`classrooms`, `classroom_members`):**
- `classrooms`: visible if `owner_id = auth.uid()` OR admin
- `classroom_members`: visible if member is self OR requester owns the classroom OR admin

**H2H tables (`match_queue`, `matches`, `match_players`, `match_events`, `competitive_ratings`, `match_results`):**
- `match_queue`: visible to self and admin only; insert allowed for self; delete allowed for self or system
- `matches`: visible if requester is one of the two `match_players` for that match OR admin
- `match_players`: visible if requester is in this match OR admin
- `match_events`: visible if requester is in this match OR admin; insert allowed only by the player whose `profile_id` matches the event
- `competitive_ratings`: read public (for leaderboard); update only by `finalize_match` RPC — never by client directly
- `match_results`: visible if requester is the result owner OR admin

⚠ **BETA SCOPE CHANGE:** No `purchases`, `purchase_requests`, or `admin_actions` tables. Those reactivate with §8/§9.

### 3.8 PII boundary (unchanged from Phase 1)

**Allowed on any profile:** anonymous UUID (`player_id`), `auth_uid`, user-picked moderated handle, avatar choice, star count, classroom ID, progress data, attempt history, birth year (for age gating), country (for home-country feature).

**Allowed on 18+ profiles only:** `password_hash`.

**Allowed on under-18 profiles only:** `parent_email`. ⚠ **BETA SCOPE CHANGE:** This field is collected (the Phase 1 client flow already populates it) but not used for anything until §9 reactivates. It sits in the database as future-use data.

**Disallowed on any profile:** real name (caught by handle moderation), child's own email, photo of the child, precise geolocation, device fingerprint, IP address in persistent storage, third-party ad tracking identifiers.

**Verification gate 3:** A second person (or you, after a coffee) can read this section and answer "where does X live and who can read it?" for any X in the system. If yes, proceed.

---

## 4. Supabase Project + Schema + RLS

**Goal:** Standing Supabase project with the schema and RLS policies from §3. No game code wired yet.

- [ ] **4.1** Create Supabase project. Name: `mapolis-beta`. Region closest to your beta testers.
- [ ] **4.2** Record connection details in `.env.local` (never commit):
    ```
    SUPABASE_URL=https://xxx.supabase.co
    SUPABASE_ANON_KEY=eyJ...
    ```
    Add the same keys to Netlify environment variables for both sites.
- [ ] **4.3** Enable email + password auth (for educators and admins). Enable anonymous auth (for students). **Enable Supabase Realtime** on the project (required for h2h queue presence and in-match score broadcasts).
- [ ] **4.4** Create tables. ⚠ **BETA SCOPE CHANGE:** Reflects locked decisions in §0.8 — normalized schema, dual-key player ID, no purchase-related tables.

    **Solo gameplay (normalized per Decision 1):**
    - `profiles` (`player_id` UUID PK, `auth_uid` UUID indexed, `handle` text unique, `avatar_svg`, `avatar_selections` jsonb, `birth_year`, `country`, `is_educator` bool, `is_admin` bool, `cr` int default 0, `parent_email` nullable, `password_hash` nullable, `recovery_created_at` nullable, `consent_age_at_create` nullable, `created_at`)
        - **⚠ PHASE 1 CHANGE:** `handle` replaces `username`. Unique index on `lower(handle)` for global case-insensitive uniqueness.
        - **⚠ BETA SCOPE CHANGE:** `auth_uid` column added per Decision 2.
        - **⚠ BETA SCOPE CHANGE:** No `ads_removed` column (deferred with §8).
    - `sessions` (`id` UUID PK, `player_id` FK→profiles, `started_at`, `ended_at`, `mode` enum 'solo'|'h2h', `tier`, `category`, `final_score`, `cards_answered`, `cards_correct`)
    - `card_attempts` (`id` UUID PK, `session_id` FK→sessions, `player_id` FK→profiles, `card_id` text, `category` text, `correct` bool, `time_ms` int, `answered_at`)
    - `star_events` (`id` UUID PK, `player_id` FK→profiles, `session_id` FK→sessions nullable, `amount` int, `reason` text, `earned_at`)
    - `progress` (`player_id` FK→profiles, `screen_id` text, `state_json` jsonb, `updated_at`, PRIMARY KEY (`player_id`, `screen_id`))

    **Classrooms (unchanged):**
    - `classrooms` (id, owner_id, name, join_code, created_at)
    - `classroom_members` (classroom_id, profile_id, joined_at)

    **H2H (normalized per blueprint §6.5):**
    - `match_queue` (profile_id PK, tier_at_queue, queued_at)
    - `matches` (id, started_at, ended_at, card_pool_tier, card_sequence_json, winner_id nullable, status enum)
    - `match_players` (match_id, profile_id, final_score, disconnected bool, PK (match_id, profile_id))
    - `match_events` (id, match_id, profile_id, card_id, correct, score_delta, client_ts, server_ts)
    - `competitive_ratings` (profile_id PK, elo int default 1200, matches_played int, wins int, losses int, ties int, updated_at)
    - `match_results` (id, match_id, profile_id, score, opponent_score, elo_before, elo_after, outcome enum, created_at)

    **⚠ BETA SCOPE CHANGE:** No `purchases`, `purchase_requests`, `admin_actions` (purchase-related fields), or any monetization tables. Deferred with §8/§9.

- [ ] **4.5** **Write the `submit_round` Postgres function.** ⚠ **BETA SCOPE CHANGE — Decision 3 deliverable.**

    ```sql
    CREATE OR REPLACE FUNCTION submit_round(payload jsonb)
    RETURNS uuid
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $$
    DECLARE
      claimed_player_id uuid;
      claimed_auth_uid  uuid;
      new_session_id    uuid;
    BEGIN
      claimed_player_id := (payload->'session'->>'player_id')::uuid;

      -- Auth check: the claimed player_id must belong to a profile
      -- whose auth_uid matches the current Supabase auth.uid()
      SELECT auth_uid INTO claimed_auth_uid
      FROM profiles
      WHERE player_id = claimed_player_id;

      IF claimed_auth_uid IS NULL OR claimed_auth_uid != auth.uid() THEN
        RAISE EXCEPTION 'submit_round: auth mismatch for player %', claimed_player_id;
      END IF;

      -- Insert session, return its ID
      INSERT INTO sessions (id, player_id, started_at, ended_at, mode, tier,
                            category, final_score, cards_answered, cards_correct)
      VALUES (
        (payload->'session'->>'id')::uuid,
        claimed_player_id,
        (payload->'session'->>'started_at')::timestamptz,
        (payload->'session'->>'ended_at')::timestamptz,
        (payload->'session'->>'mode')::text,
        (payload->'session'->>'tier')::int,
        payload->'session'->>'category',
        (payload->'session'->>'final_score')::int,
        (payload->'session'->>'cards_answered')::int,
        (payload->'session'->>'cards_correct')::int
      )
      ON CONFLICT (id) DO NOTHING
      RETURNING id INTO new_session_id;

      -- If session already existed (idempotent retry), bail out cleanly
      IF new_session_id IS NULL THEN
        RETURN (payload->'session'->>'id')::uuid;
      END IF;

      -- Bulk insert card_attempts
      INSERT INTO card_attempts (id, session_id, player_id, card_id, category,
                                 correct, time_ms, answered_at)
      SELECT
        gen_random_uuid(),
        new_session_id,
        claimed_player_id,
        item->>'card_id',
        item->>'category',
        (item->>'correct')::boolean,
        (item->>'time_ms')::int,
        (item->>'answered_at')::timestamptz
      FROM jsonb_array_elements(payload->'card_attempts') AS item;

      -- Bulk insert star_events
      INSERT INTO star_events (id, player_id, session_id, amount, reason, earned_at)
      SELECT
        gen_random_uuid(),
        claimed_player_id,
        new_session_id,
        (item->>'amount')::int,
        item->>'reason',
        (item->>'earned_at')::timestamptz
      FROM jsonb_array_elements(payload->'star_events') AS item;

      -- Upsert progress rows
      INSERT INTO progress (player_id, screen_id, state_json, updated_at)
      SELECT
        claimed_player_id,
        item->>'screen_id',
        item->'state_json',
        (item->>'updated_at')::timestamptz
      FROM jsonb_array_elements(payload->'progress_updates') AS item
      ON CONFLICT (player_id, screen_id) DO UPDATE
        SET state_json = EXCLUDED.state_json,
            updated_at = EXCLUDED.updated_at;

      RETURN new_session_id;
    END;
    $$;
    ```

    Grant execute permission to the `authenticated` role:
    ```sql
    GRANT EXECUTE ON FUNCTION submit_round(jsonb) TO authenticated;
    ```

- [ ] **4.6** Write RLS policies per §3.7. Enable RLS on **every** table (no exceptions). Default deny.

    For owned tables (`sessions`, `card_attempts`, `star_events`, `progress`), the write policies can be DENY ALL because writes go through `submit_round`. Read policies use the `auth_uid` join pattern:

    ```sql
    -- Example: card_attempts read policy
    CREATE POLICY card_attempts_read ON card_attempts
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM profiles
          WHERE profiles.player_id = card_attempts.player_id
            AND profiles.auth_uid = auth.uid()
        )
        OR
        EXISTS (
          -- Educator can read attempts for students in their classroom
          SELECT 1 FROM classroom_members cm
          JOIN classrooms c ON c.id = cm.classroom_id
          WHERE cm.profile_id = card_attempts.player_id
            AND c.owner_id = auth.uid()
        )
        OR
        EXISTS (
          SELECT 1 FROM profiles WHERE auth_uid = auth.uid() AND is_admin = true
        )
      );
    ```

- [ ] **4.7** Write SQL test queries (run from Supabase SQL editor as different roles) that prove:
    - A student cannot read another student's profile
    - A student cannot read sessions belonging to another student
    - A student cannot directly INSERT into `sessions`, `card_attempts`, `star_events`, or `progress` (write policies block direct access)
    - A student CAN successfully call `submit_round` with their own `player_id`
    - A student calling `submit_round` with someone else's `player_id` gets an exception
    - An educator can read profiles AND `card_attempts` of students in their classroom only
    - An educator cannot read `card_attempts` of students in someone else's classroom
    - A non-admin cannot set `is_admin = true` on themselves
    - An admin can read everything
    - A player cannot read a `matches` row they are not a participant in
    - A player cannot insert a `match_events` row with someone else's `profile_id`
    - A player cannot directly update their own `competitive_ratings.elo`
    - The competitive leaderboard query (top-N from `competitive_ratings`) succeeds for an anonymous student

**Verification gate 4:** All 13 SQL test queries return the expected result. Save the test queries in `docs/RLS_TESTS.sql` so you can re-run after any policy change. **`submit_round` is the only write path for solo gameplay data and it works end-to-end.**

---

## 5. Auth Wiring (Game and Admin)

**Goal:** Both files can authenticate against Supabase. Game does anonymous-by-default with optional educator login. Admin does email login with admin-flag check.

- [ ] **5.1** In `/assets/shared.js`, implement:
    - `getSupabase()` — returns initialized client
    - `signInAnonymous()` — for students on first launch; returns `auth.uid()`
    - `signInWithEmail(email, password)` — for educators and admins
    - `signOut()`
    - `getCurrentUser()` — returns `{ id, role, isAdmin }` or null
- [ ] **5.2** In `play/index.html`, on first launch: call `signInAnonymous()` to get a Supabase session, capture the returned `auth.uid()`, and **write it to every existing local profile's `auth_uid` field** (the dual-key migration per §0.8 Decision 2). Then run the Phase 1 signup flow if no profile exists yet.
    - On subsequent launches, the local profile already has `auth_uid` set, but call `signInAnonymous()` again to refresh the session token. Verify the returned `auth.uid()` still matches the local `auth_uid`. If it doesn't (the user cleared site data or the session expired), the local profile is orphaned — surface the Restore Profile flow.
    - **⚠ PHASE 1 CHANGE:** the signup flow is already implemented in `mapolis_v4.html` — it just needs its `saveProfiles()` call rewired to also `insert` into the Supabase `profiles` table (via a `create_profile` RPC, see 5.2.1).
    - **Recovery restore flow:** `openRestoreProfileModal()` in `mapolis_v4.html` currently scans `allProfiles` locally. When the backend lands, swap the local scan for two Supabase RPCs: `rpc_restore_by_password(handle text, password_hash text)` and `rpc_restore_by_parent_email(parent_email text)`. ⚠ **BETA SCOPE CHANGE:** Rate limiting is still recommended but the parent-email path is informational only since §9 is deferred.
- [ ] **5.2.1** Write a `create_profile` Postgres RPC (SECURITY DEFINER) that:
    - Accepts the new profile data
    - Validates handle uniqueness server-side (case-insensitive)
    - Sets `auth_uid` from `auth.uid()`
    - Inserts the row
    - Returns the new `player_id`
- [ ] **5.2.2** ⚠ **PHASE 1 CHANGE — client-side safety net (already done):** the self-toggle `unlockEducatorMode()` button is currently age-gated to 18+ as defense-in-depth and will be deleted entirely when 5.3 below is implemented. Two call sites in `mapolis_v4.html` carry `TODO(phase-b-5.3)` comments. When 5.3 lands, grep for that marker and delete both.
- [ ] **5.3** In `play/index.html`, add an "I'm a teacher" button on the title screen → opens email/password sign-in. On successful login, set the session role to educator and unlock educator UI.
- [ ] **5.4** In `admin/index.html`, gate the entire UI behind email login. After login, check `profiles.is_admin === true` (looked up via `auth_uid`). If false, show "Access denied" and sign the user out.
- [ ] **5.5** Make at least one admin account by hand: register via the admin login flow, then run `UPDATE profiles SET is_admin = true WHERE auth_uid = '<your-uuid>'` in the Supabase SQL editor.

**Verification gate 5:**
1. Open game in incognito → automatic anonymous student account created, profile row visible in Supabase with both `player_id` and `auth_uid` populated
2. Open game on same device, create a second profile → second `profiles` row exists with same `auth_uid`, different `player_id` (multi-profile-per-device works)
3. Open game, click "I'm a teacher", log in with educator account → educator UI appears
4. Open admin in incognito → login wall shown
5. Log into admin with non-admin account → access denied
6. Log into admin with admin account → admin shell loads with empty dashboards (no data yet)

---

## 6. Game Write Paths

**Goal:** Every gameplay event that the admin will eventually want to chart gets written to Supabase. ⚠ **BETA SCOPE CHANGE — Decision 3:** Solo writes batch at end-of-round via `submit_round` RPC. H2H writes stay per-event via Realtime channels.

- [ ] **6.1** **Build the `roundData` accumulator.** In `play/index.html`, add a module-level `currentRoundData` object that gets initialized at session start. Replace the in-game stat-update calls with appenders to this object:
    - On session start: `currentRoundData = { session: {...}, card_attempts: [], star_events: [], progress_updates: [] }`
    - On each card answer: `currentRoundData.card_attempts.push({...})`
    - On each star earned: `currentRoundData.star_events.push({...})`
    - On screen progress change: `currentRoundData.progress_updates.push({...})`
    - On session end: populate `session.ended_at`, `final_score`, etc.
- [ ] **6.2** **Implement `submitRound()` on the client.** A single function in `shared.js`:
    ```js
    async function submitRound(roundData) {
      try {
        const { data, error } = await supabase.rpc('submit_round', { payload: roundData });
        if (error) throw error;
        clearPendingRound(roundData.session.id);
        return { success: true, sessionId: data };
      } catch (err) {
        console.warn('[submitRound] Failed, caching for retry:', err);
        cachePendingRound(roundData);
        return { success: false, error: err };
      }
    }
    ```
- [ ] **6.3** **Implement pending-round cache.** Three small functions:
    - `cachePendingRound(roundData)` — appends to `localStorage['mapolis_pending_rounds']`
    - `clearPendingRound(sessionId)` — removes by session_id
    - `flushPendingRounds()` — iterates the cache, retries each via `submitRound`, removes successes. Called on app open and on every successful `submitRound`.
- [ ] **6.4** **Wire `submitRound()` into the results screen.** When the player reaches the solo results screen, fire `submitRound(currentRoundData)` in the background. The results screen renders from local data — the network call is non-blocking and the player doesn't see it.
- [ ] **6.5** **Keep the existing `syncStore.save('profile_X', ...)` flow for profile metadata** (handle, avatar, recovery fields). That's a separate write path from gameplay data and it's already wired. Rename the queue to `profile_sync_queue` to disambiguate from the round-batch flow.
- [ ] **6.6** Add a per-session debug log that prints every `submitRound` call to the browser console when `?debug=1` is in the URL.
- [ ] **6.7** Test end-to-end: play through a full session as an anonymous student, then check Supabase tables and verify rows landed correctly.

⚠ **BETA SCOPE CHANGE:** The originally-planned per-event sync queue + retry logic is replaced by the simpler `pending_rounds` cache. There's exactly one network call per round and exactly one place a round can fail.

**Verification gate 6:** Play a 5-card session. In Supabase, confirm: 1 row in `sessions`, 5 rows in `card_attempts` linked to that session, N rows in `star_events`, 1+ rows in `progress`. RLS test: open the SQL editor as a different anonymous user and confirm you cannot see those rows. Force an offline state mid-session and confirm the round caches locally and flushes on reconnect.

---

## 6.5. Head-to-Head Mode

**Goal:** Networked 1v1 competitive mode, fully built and playable, before monetization wiring begins.

⚠ **BETA SCOPE CHANGE:** The "before monetization wiring" framing is now moot — monetization is deferred entirely. This section's scope is unchanged: complete the H2H backend swap from `H2HStub` to real Supabase Realtime.

### 📌 Implementation status (April 2026)

**The full H2H client flow is built, integrated, and playable end-to-end in `mapolis_v4.html` against a local `H2HStub` bot.** Roger has played a dozen+ matches. Everything below this callout splits into two categories:

- **Client tasks (✅ done):** queue screen, in-match HUD reusing `s-game` with a mode flag, results screen with all three rematch states, match state machine, rating math (K=32, 1200 starting), rematch flow, disconnect/forfeit stub, competitive leaderboard UI, tier-capped deck pool, stars banked to `profile.stats.cr` on correct H2H answers, bright-green polygon flash on correct.
- **Backend tasks (⏳ pending):** everything involving Supabase Realtime, `match_queue` / `matches` / `match_events` / `competitive_ratings` / `match_results` tables, Edge Functions (`pair-queue`, `finalize_match`), and RLS. These are the task boxes left unchecked below.

Nothing about the client UI or gameplay needs re-litigation. When the backend lands, the swap is mechanical: replace `H2HStub` method calls with Supabase Realtime subscribes and Edge Function invocations. The UI code doesn't move.

**Design gate (closed):** All three mockups were approved and shipped. (See full details in the prior version of this section — preserved as historical record.)

---

- [x] **6.5.1** ✅ **Client-side: shipped.** "Head to Head" entry lives on the continent selection screen.
- [~] **6.5.2** Implement the **queue screen** per approved spec. Client shipped; backend swap remaining (insert into `match_queue`, presence on `queue:lobby`).
- [~] **6.5.3** Implement the **matchmaker** as Supabase Edge Function `pair-queue`. (Full spec preserved from original blueprint version.)
- [~] **6.5.4** **Queue timeout flow** — modal at 30s. (Spec preserved.)
- [~] **6.5.5** **Match state machine** — full spec preserved.
- [~] **6.5.6** **In-match card flow** — full spec preserved, including server-side validation against `card_sequence_json`.
- [~] **6.5.7** **Dual-score HUD** — Realtime subscribe on `match:<match_id>`.
- [~] **6.5.8** **Clock** — 60s synced to `matches.started_at`.
- [~] **6.5.9** **`finalize_match` Edge Function** — service role, idempotent, writes `match_results` + updates `competitive_ratings`. Same transactional pattern as `submit_round` for solo. Elo formula: K=32, starting 1200; the H2H stub already implements this in `H2HStub.calcRatingDelta` — port verbatim.
- [~] **6.5.10** **Results screen** — client shipped.
- [~] **6.5.11** **Disconnect handling** — surviving player plays out the clock; disconnecter gets `forfeit_loss`.
- [~] **6.5.12** **Competitive leaderboard** — read from `competitive_ratings` joined to `profiles`.

**Verification gate 6.5:** Two browsers queue up, get matched within ~2 seconds, both see the 3-2-1 countdown, both play the same card sequence, live score updates appear within ~500ms, lower-tier player's tier is the source for the card pool, at 60 seconds both transition to results with consistent Elo updates, disconnect test passes, competitive leaderboard shows both test players, RLS prevents third-user reads.

---

## 7. Admin Read Paths + Educator Card-Attempt View

**Goal:** The admin dashboard reads from Supabase. ⚠ **BETA SCOPE CHANGE:** This section gains a headline new feature — the **per-student card-attempt history view in the educator dashboard** — which is the deliverable that justified normalizing the schema in §0.8 Decision 1.

### 📌 Phase 5 admin expansion (April 2026 — shipped in `mapolis_v4.html`)

The admin Analytics tab has already been expanded with four new blocks per `PHASE_5_HANDOFF.md`, built against the localStorage data model. When this section wires Supabase, these blocks need their data sources re-pointed.

(Block A/B/C/D summary preserved from prior version.)

### 7.1 Admin chart Supabase swap

- [ ] **7.1.1** Replace each existing admin chart's data source with a Supabase query. Common patterns:
    - "Total sessions today" → `SELECT count(*) FROM sessions WHERE started_at::date = current_date`
    - "Star leaderboard" → `SELECT handle, cr FROM profiles ORDER BY cr DESC LIMIT 50`
    - "Competitive leaderboard" → `SELECT p.handle, p.avatar_svg, cr.elo, cr.wins, cr.losses, cr.ties FROM competitive_ratings cr JOIN profiles p ON p.player_id = cr.profile_id ORDER BY cr.elo DESC LIMIT 50`
    - "Matches today" → `SELECT count(*) FROM matches WHERE started_at::date = current_date AND status = 'finished'`
    - "Active queue right now" → `SELECT count(*) FROM match_queue`
    - **Block A totals** → aggregate `matches` count (H2H total) and `sessions` count (solo total)
    - **Block B totals** → `profiles WHERE is_educator = true`, `classroom_members` for linked students
    - **Block B Educator Growth chart** → swap proxy for `profiles.created_at WHERE is_educator = true`
- [ ] **7.1.2** Add a "data freshness" indicator on each chart so you can tell when the data was last fetched.
- [ ] **7.1.3** Block C (Feature Engagement) and Block D (Revenue) **stay as empty states** — both depend on deferred work.

### 7.2 Educator dashboard reads (lives inside the game file, not admin)

- [ ] **7.2.1** An educator should see their own classrooms and the progress of students in them. Use queries scoped by classroom ownership: `SELECT * FROM profiles WHERE player_id IN (SELECT profile_id FROM classroom_members WHERE classroom_id IN (SELECT id FROM classrooms WHERE owner_id = auth.uid()))`.

### 7.3 ⚠ NEW — Per-student card-attempt history view

**This is the headline deliverable that justified normalizing the schema.** Without this feature, the educator product has no per-student diagnostic capability — and that capability is the whole reason the educator module exists.

- [ ] **7.3.1** Add a "View student progress" button on each row of the educator's classroom roster.
- [ ] **7.3.2** Tapping it opens a per-student detail screen showing:
    - **Recent sessions** (last 10): date, mode, score, accuracy
    - **Most-missed cards** (across all sessions): card name, category, # times shown, # correct, % accuracy. Sorted by lowest accuracy.
    - **Category breakdown:** for each category (Countries, Capitals, Rivers, etc.), show total attempts, total correct, % accuracy.
    - **Recent mistakes feed:** last 20 incorrect `card_attempts` rows in chronological order, showing card name + category.
- [ ] **7.3.3** All queries scoped by RLS — the educator can only see students in their own classrooms. The card_attempts read policy from §4.6 enforces this server-side.

**Verification gate 7:**
1. Admin dashboard shows real data from §6's playthrough.
2. Educator dashboard, when logged in as the test educator, shows only that educator's classroom's data and not other classrooms.
3. **Per-student card-attempt view loads** — pick one student, see their recent sessions, most-missed cards, category breakdown, and recent mistakes.
4. RLS test: educator A cannot see educator B's students' card attempts.
5. Blocks A and B read from Supabase; C and D remain empty-state.

---

## 8. Monetization Scaffolding

⚠ **BETA SCOPE CHANGE — DEFERRED.** This section is not built for the invite-only beta. It reactivates before the public launch. The original spec is preserved below as the implementation reference for when reactivation happens.

(Original §8.1–§8.7 spec preserved verbatim in the prior blueprint version. Reactivation requires: Stripe account, AdMob account, decision on educator/classroom bypass policy, parental gate component build, ad slot UI placement.)

---

## 9. Web Payment Flow with Parental Verification

⚠ **BETA SCOPE CHANGE — DEFERRED.** This section is not built for the invite-only beta. Reactivates with §8 before public launch. Original spec preserved as implementation reference.

---

## 10. Privacy, Legal, and App Privacy Disclosures

⚠ **BETA SCOPE CHANGE — DEFERRED.** Replaced for the invite-only beta by **plain-language disclosure in the invite email**. The full privacy policy and ToS reactivate as a hard gate before any URL becomes shareable beyond the invite list.

### 10.0 Invite-only beta disclosure (interim, in the invite email)

The invite email to each beta tester must include:
- Plain-language description of what data the game collects (handles, gameplay stats, optional birth year, optional country, optional parent email for under-18, optional password hash for 18+)
- Explicit statement that no real names, emails of children, photos, or location data are collected
- Statement that the data lives in Supabase and is not shared with any third party
- Operator contact email for data deletion requests
- Statement that the URL is invite-only and not to be shared

This disclosure does not replace a privacy policy — it bridges the gap until §10 reactivates.

### 10.1–10.5 Original privacy policy / ToS / parental info / deletion procedure

Preserved from the prior blueprint version. Reactivates before public launch.

---

## 11. Beta Deploy and Smoke Test

**Goal:** Both URLs live, real users on real devices, ready for the invite-only beta tester group.

⚠ **BETA SCOPE CHANGE:** "Beta tester group" means the capped invite list from §0.6, not a public open beta.

- [ ] **11.1** Final commit, push, confirm both Netlify deploys succeed.
- [ ] **11.2** Smoke test from a clean device (phone, tablet, laptop) you don't normally use:
    - Open `play.mapolis.app` → game loads, anonymous account created, can play a session
    - Solo session end → `submit_round` fires successfully, rows visible in Supabase
    - Open `admin.mapolis.app` → login wall, log in as admin, see real data from your smoke test session
    - Educator login from the game → educator dashboard works
    - **Per-student card-attempt view loads** for at least one student (the §7.3 deliverable)
    - H2H match between two browsers → live HUD works, results land, leaderboard updates
- [ ] **11.3** Run the RLS test SQL from §4.7 against the live Supabase project to confirm policies are still in force after all the wiring.
- [ ] **11.4** ⚠ **BETA SCOPE CHANGE:** Before sending invites, confirm the §10.0 plain-language disclosure email template is finalized.
- [ ] **11.5** Send beta invites with: the URL, the disclosure, what to test, where to send bug reports.

**Verification gate 11:** All five smoke tests pass on a device that has never seen the app before. RLS tests still pass. Disclosure email template is ready. You are ready to invite beta testers.

---

## Debug Plan

(Preserved from prior blueprint version. Same `?debug=1` toggle, same reference table for "where to look when something breaks," same reproduction-of-issues guidance. Updated to add: `submit_round` call logging, `pending_rounds` cache contents, RLS denial logs.)

---

## Phase B Done Criteria (Invite-Only Beta)

You have completed the invite-only beta when **all** of these are true:

**Phase 1 items (already done in `mapolis_v4.html` as of April 2026):**
- [x] Handle moderation, messaging restrictions, recovery flow, age threshold, educator gate (all preserved from prior version)

**Phase B items still to do for the invite-only beta:**
- [ ] Both URLs live and serving the right files
- [ ] Anonymous student accounts work; profiles row carries both `player_id` and `auth_uid`
- [ ] Multi-profile-per-device confirmed working
- [ ] Student signup flow rewired through `create_profile` RPC
- [ ] Restore Profile modal swapped from local scan to Supabase RPC
- [ ] Global handle uniqueness enforced via Supabase `UNIQUE` index
- [ ] Educator accounts can create classrooms and view their students' progress
- [ ] **Per-student card-attempt history view shipped (§7.3)**
- [ ] "I'm a teacher" login flow implemented; legacy `unlockEducatorMode()` self-toggle deleted
- [ ] Admin tool reads all data; non-admins cannot
- [ ] **`submit_round` RPC working end-to-end with pending-round retry cache**
- [ ] **Head-to-head mode is live:** ✅ Client shipped. ⏳ Supabase Realtime swap complete so two real players can match each other.
- [x] **UI mockups approved by Roger before build:** all three shipped.
- [x] **Admin analytics Phase 5 expansion shipped:** ready for Supabase swap.
- [ ] Phase 5 Block A and B reading from Supabase (C and D remain empty states)
- [ ] At least 3 invite-only beta testers have completed a full session and the data is visible in admin
- [ ] At least one h2h match has been played by beta testers and shows up on the competitive leaderboard
- [ ] No third-party trackers or analytics SDKs in `play/index.html`
- [ ] Plain-language disclosure email template finalized and used in invites

**Items deferred for invite-only beta (do NOT block done criteria):**
- [ ] ~~Monetization provider abstraction~~ — deferred (§8)
- [ ] ~~Stripe / parental purchase flow~~ — deferred (§9)
- [ ] ~~Privacy policy and ToS finalized~~ — deferred (§10)
- [ ] ~~LLC formation~~ — deferred (§0.4)
- [ ] ~~Parental gate component~~ — deferred (with §8/§9)

When the invite-only beta is done and validated, the deferred items reactivate per the trigger table in §0.8. After all deferred items ship, Phase C (iOS) is mostly: install Capacitor, swap the web monetization provider for the iOS one, add native shell, submit. The hard architectural work is finished.

---

*Last updated: April 9, 2026 — Invite-only beta scope cut applied. §0.8 added documenting locked decisions. §3 rewritten for normalized schema, dual-key player ID, end-of-round batching. §4 schema reflects normalized + `auth_uid` + `submit_round` RPC. §6 replaced with `roundData` accumulator + single RPC call. §7 gains §7.3 per-student card-attempt history view. §8/§9/§10 marked deferred. Done criteria trimmed. Sections marked with ⚠ BETA SCOPE CHANGE callouts throughout.*

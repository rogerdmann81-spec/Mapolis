# Mapolis — Step Current Handoff
## Date: April 22, 2026
## Context: Phase B Invite-Only Beta — Backend Verified, Client Wiring Next

---

## What We Verified Today

### Supabase Schema (LIVE — all confirmed via SQL audit)
- **13 tables** created with RLS enabled on all
- **Schema gaps FIXED** via ALTER TABLE:
  - `classrooms.join_code` added
  - `match_queue.tier_at_queue` added
  - `match_players.final_score` + `disconnected` added; `tier_at_queue` dropped
  - `match_results.score` + `opponent_score` added
  - `competitive_ratings.matches_played/wins/losses/ties` added
  - `matches.card_sequence_json` added
  - Unique index on `lower(handle)` created
  - Index on `profiles.auth_uid` created
  - `progress` PK set to `(player_id, screen_id)`
  - `classrooms` UPDATE policy added
  - `sessions.id` default set to `gen_random_uuid()`

### RPCs (LIVE — confirmed in `pg_proc`)
- `submit_round(payload jsonb)` — SECURITY DEFINER, handles solo end-of-round batch insert
- `create_profile(...)` — SECURITY DEFINER, validates handle uniqueness, sets auth_uid

### RLS Policies (LIVE — confirmed in `pg_policies`)
- All owned tables: read = self + educator-of-classroom + admin; write = DENY ALL (only via RPCs)
- `profiles`: read = self + educator + admin; update = self; insert = DENY (only via create_profile RPC)
- Classroom tables: scoped by ownership
- H2H tables: scoped by match participation
- `competitive_ratings`: public read for leaderboard

### GitHub Repo Status
- `admin/index.html` — **78KB real admin UI restored** in latest commit (`951f6d4` "bring ui preview back")
  - Previously was a stub; Roger restored from older version
  - GitHub raw cache may lag; file is confirmed 78KB in commit tree
- `play/index.html` — ~4MB game file, Phase 1 features shipped, H2H client playable vs bot
- `assets/shared.js` — auth helpers + syncStore, loaded by both play and admin
- `docs/` — all handoff files present (PHASE_B_BLUEPRINT, PHASE_5_HANDOFF, H2H_BUILD_HANDOFF, STEP_1_HANDOFF, PATH_TO_LLC, DATA_FLOWS)

---

## What's Done vs. What's Left

| Blueprint Section | Status | Detail |
|---|---|---|
| §1 Repo + Netlify | ✅ | Two sites: play.mapolis.app, admin.mapolis.app |
| §2 Admin extraction | ✅ | Real admin UI restored to repo |
| §4 Schema + RLS + RPCs | ✅ | All live, all gaps patched |
| §5 Auth wiring | 🟡 Partial | `signInAnonymous`, shared.js dedup, educator self-toggle removed. Still need: "I'm a teacher" login flow, Restore Profile modal → Supabase RPC |
| §6 Game write paths | ❌ | **NEXT PRIORITY** — roundData accumulator + submitRound() + pending cache |
| §6.5 H2H backend | ❌ | Edge Functions `pair-queue` + `finalize_match` not built |
| §7 Admin reads | ❌ | Admin UI restored but still reads localStorage. Needs Supabase swap + per-student card-attempt view |
| §8-10 | ⏸️ Deferred | Monetization, Stripe, privacy policy — per §0.8 beta scope cut |

---

## Token-Saving Strategy (Agreed)

**Goal:** Minimize Netlify deploys (each push = token burn).

**Plan:**
1. **Phase A (0 pushes):** Build all Supabase backend (Edge Functions, any schema tweaks) — test in Supabase SQL Editor / Edge Function logs
2. **Phase B (0 pushes):** Modify `play/index.html` and `admin/index.html` locally — test by opening files directly in browser (`file://` or `npx serve`). Supabase REST calls work from localhost.
3. **Phase C (1 push):** When everything works locally, commit all changes and push ONCE. Both Netlify sites auto-deploy.

**HTTPS note:** `admin.mapolis.app` showing "not secure" — Roger has not touched Netlify today. Likely auto-SSL renewal lag. Can fix via Netlify Domain Settings → HTTPS → Renew Certificate, OR ignore until beta invites (local testing works without HTTPS).

---

## Next Session Pickup

**Recommended first task:** Build the `roundData` accumulator in `play/index.html` (§6.1–6.4). This is the foundation — without it, no gameplay data reaches Supabase and admin has nothing to display.

**Files to have open:**
- `play/index.html` — the 4MB game file
- `assets/shared.js` — shared Supabase client
- `docs/PHASE_B_BLUEPRINT.md` — §6 for roundData spec, §6.5 for H2H spec

**Key blueprint references:**
- §0.8 — Locked architectural decisions (normalized schema, dual-key, end-of-round batching)
- §3 — Data flow design (who writes what, who reads what)
- §6 — Solo write paths (roundData accumulator pattern)
- §6.5 — H2H backend swap (Edge Function specs)
- §7 — Admin reads + educator card-attempt view

---

## Decisions Locked (Do Not Re-Litigate)

1. **Normalized schema** — per-card-attempt rows required for educator diagnostics
2. **Dual-key identity** — `player_id` (client UUID) + `auth_uid` (Supabase auth) — supports multi-profile-per-device
3. **End-of-round batching** — solo writes via `submit_round` RPC only; H2H writes per-event via Realtime
4. **No backfill** — beta starts clean, no localStorage migration
5. **Invite-only beta** — monetization, legal docs, LLC all deferred until after beta validates

---

*End of handoff. Next session should start by opening this file, the blueprint, and `play/index.html`.*

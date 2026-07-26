# Mapolis — Step 1 Handoff: Repo + Netlify (Invite-Only Beta)

**Status:** Ready to execute. Start in a fresh chat. This is the first concrete build step of the invite-only beta push.

**Game file:** `mapolis_v4.html` (single-file HTML, ~26,500 lines, ~3.8 MB). Upload fresh at start of chat.

**Why this step exists:** Get the deploy pipeline working before any backend complexity lands. Two URLs serving HTTPS, the current game file at one of them, a stub admin page at the other. This is the foundation everything in Phase B sits on top of.

---

## Locked decisions (do not re-litigate)

These were decided in the planning session that produced this handoff. They are inputs to all later steps, not topics for this step:

| Decision | Value |
|---|---|
| **Beta scope** | Invite-only public URL. No purchases, no ads, no parental gate, no privacy policy, no LLC. |
| **Schema shape** | Normalized — separate `profiles`, `sessions`, `card_attempts`, `star_events`, `progress` tables for solo. H2H tables also normalized per blueprint §6.5. |
| **Player ID** | Dual-key. Local profile keeps its `crypto.randomUUID()`-generated `id` as `player_id` (PK). Supabase profiles row also carries `auth_uid` column populated from anonymous-auth `auth.uid()`. RLS uses `WHERE auth_uid = auth.uid()`. Supports multiple local profiles per device. |
| **Solo write strategy** | End-of-round transactional batch via `submit_round` Postgres RPC. Round data accumulates in an in-memory `roundData` object during gameplay; at round-end, one HTTP call carries the entire package; server-side function splits into the right tables in one transaction. |
| **H2H write strategy** | Per-event Realtime broadcasts (unchanged from blueprint §6.5). Match finalization via `finalize_match` RPC, same transactional pattern. |
| **Backfill** | None. No profiles in Supabase yet, all existing data is local and discardable. Beta starts clean. |

These decisions are also documented in the updated `PHASE_B_BLUEPRINT.md` (look for `⚠ BETA SCOPE CHANGE` callouts).

---

## What this step delivers

By the end of Step 1:

1. A private GitHub repo `levvl/mapolis` (or whatever your GitHub org is) containing the working game file as `index.html` and a stub `admin.html`
2. Two Netlify sites linked to the repo, both auto-deploying on push
3. Two custom domains live and serving HTTPS:
   - `play.mapolis.app` → serves `index.html` (the game)
   - `admin.mapolis.app` → serves `admin.html` (currently a stub)
4. The full file structure described in blueprint §1.4 in place
5. A trivial test commit confirming both sites auto-deploy

**What this step does NOT do:** Supabase setup, admin extraction, schema work, auth wiring, any of the actual H2H backend swap. Those are Steps 2 onward. Don't get pulled forward.

---

## Pre-flight checklist

Before starting the actual work, confirm you have:

- [ ] A GitHub account (free is fine for a private repo)
- [ ] A Netlify account linked to that GitHub account (free tier is fine for the beta)
- [ ] Ownership/control of the `mapolis.app` domain (or whatever domain you're using). If you don't have it yet, register it now via Cloudflare Registrar or Porkbun. **Do not use GoDaddy.** Domain should be registered in your personal name for now since LLC is deferred — track that as a TODO to transfer when the LLC forms.
- [ ] `mapolis_v4.html` uploaded to this chat

If any of those aren't ready, stop and resolve them before continuing.

---

## Build steps

### 1. Create the repo

```bash
# Create a new private repo on github.com/<your-org>/mapolis
# (do this through the GitHub web UI)
```

Then locally:

```bash
mkdir mapolis && cd mapolis
git init
git remote add origin git@github.com:<your-org>/mapolis.git
```

### 2. Create the directory structure

Per blueprint §1.4:

```
mapolis/
├── index.html           # the game (renamed from mapolis_v4.html)
├── admin.html           # stub for now
├── assets/              # empty for now, shared.js lands here in Step 2
├── docs/
│   ├── PHASE_B_BLUEPRINT.md
│   ├── PATH_TO_LLC.md
│   ├── H2H_BUILD_HANDOFF.md       # historical
│   └── PHASE_5_HANDOFF.md         # historical
├── .gitignore
└── .env.example
```

Commands:

```bash
mkdir -p assets docs
# Copy the uploaded mapolis_v4.html into the repo as index.html
cp /mnt/user-data/uploads/mapolis_v4__1_.html index.html
# Copy doc files from /mnt/project/ into docs/
cp /mnt/project/PHASE_B_BLUEPRINT__2_.md docs/PHASE_B_BLUEPRINT.md
cp /mnt/project/H2H_BUILD_HANDOFF.md docs/
cp /mnt/project/PHASE_5_HANDOFF.md docs/
# Use the merged PATH_TO_LLC.md from this chat's outputs (not the legacy versions)
cp <path-to-merged-PATH_TO_LLC.md> docs/PATH_TO_LLC.md
```

### 3. Create the stub `admin.html`

This is intentionally minimal. It exists only so the `admin.<domain>` site has something to serve. Real admin extraction is Step 2.

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Mapolis Admin</title>
  <style>
    html,body { margin:0; padding:0; background:#0a0a0a; color:#e8f4ff;
                font-family:-apple-system,system-ui,sans-serif;
                min-height:100vh; display:flex; align-items:center;
                justify-content:center; text-align:center; }
    .stub { padding:32px; max-width:480px; }
    .stub h1 { font-size:24px; margin:0 0 12px; font-weight:500; }
    .stub p { font-size:14px; color:#7fb8d8; line-height:1.6; margin:8px 0; }
    .badge { display:inline-block; background:rgba(91,143,255,0.15);
             border:1px solid rgba(91,143,255,0.4); border-radius:999px;
             padding:4px 12px; font-size:11px; color:#5b8fff;
             text-transform:uppercase; letter-spacing:1.2px; margin-top:16px; }
  </style>
</head>
<body>
  <div class="stub">
    <h1>Mapolis Admin</h1>
    <p>Admin extraction lands in Step 2 of the Phase B build.</p>
    <p>This stub exists so the deploy pipeline has something to serve.</p>
    <div class="badge">Step 1 Stub</div>
  </div>
</body>
</html>
```

### 4. Create `.gitignore`

```
node_modules/
.env
.env.local
.env.*.local
dist/
ios/
android/
.DS_Store
*.log
```

### 5. Create `.env.example`

Empty template for now. Real values land in Step 4.

```
# Supabase (filled in during Step 4)
SUPABASE_URL=
SUPABASE_ANON_KEY=

# Stripe (deferred for invite-only beta — see PHASE_B_BLUEPRINT §8/§9)
# STRIPE_PUBLIC_KEY=
# STRIPE_SECRET_KEY=
```

### 6. First commit and push

```bash
git add .
git commit -m "Initial commit: Step 1 baseline (game + admin stub)"
git tag pre-phase-b-step-1
git branch -M main
git push -u origin main --tags
```

### 7. Set up Netlify Site 1: `play.mapolis.app`

Through the Netlify web UI:

1. **Add new site** → Import an existing project → GitHub → select `mapolis` repo
2. **Build settings:**
   - Base directory: (leave blank)
   - Build command: (leave blank — no build step)
   - Publish directory: `.` (root of repo)
3. **Site name:** `mapolis-play` (or whatever; the custom domain matters more than the netlify subdomain)
4. **Deploy site** → wait for green checkmark
5. **Add a redirect rule** so all paths serve `index.html`. Create `_redirects` file in repo root:

```
/admin.html  /admin.html  200
/*           /index.html  200
```

(The first line preserves the admin path so it doesn't get rewritten — relevant if both sites end up sharing the same publish directory in the future. For now they're separate sites so this is belt-and-suspenders.)

Commit and push that file.

### 8. Set up Netlify Site 2: `admin.mapolis.app`

Same process as Site 1, but:

1. **Add new site** → same `mapolis` repo
2. **Site name:** `mapolis-admin`
3. **Build settings:** same as above (no build command, root publish directory)
4. **Add a redirect rule** in this site's settings (Site settings → Build & deploy → Post processing → Snippet injection won't work for this; use a per-site `netlify.toml` instead — see below)

Because both sites point at the same repo and both have the same publish directory, you need a way to tell each site which file to serve as the root. The cleanest way is **two `netlify.toml` files in different branches** OR **one `netlify.toml` per site with site-specific config in Netlify's environment**.

**Recommended approach:** add a single `netlify.toml` to the repo root that uses Netlify's `[context]` blocks keyed off site name or environment variable. Or, simpler for this stage:

Option A — single repo, branch per site:
- `main` branch → deploys to `play.mapolis.app`, default redirect rule serves `index.html`
- `admin` branch → deploys to `admin.mapolis.app`, redirect rule serves `admin.html` as root

Option B — single branch, two subdirectories:
- Restructure: move game to `play/index.html`, admin stub to `admin/index.html`
- Site 1 base directory = `play/`, Site 2 base directory = `admin/`
- Both sites build from `main`, no branch switching

**Recommendation: Option B.** Branch-per-site gets messy fast and forces you to merge back and forth. Subdirectories are clean and stable.

If you go with Option B, restructure step 2 like this instead:

```
mapolis/
├── play/
│   └── index.html           # the game
├── admin/
│   └── index.html           # admin stub
├── assets/                  # shared between both
├── docs/
├── .gitignore
├── .env.example
└── netlify.toml             # optional site-wide config
```

Then in Netlify:
- Site 1 (`mapolis-play`): Base directory = `play`, Publish directory = `play`
- Site 2 (`mapolis-admin`): Base directory = `admin`, Publish directory = `admin`

Both sites trigger on every push to `main`, but each only sees its own subdirectory.

### 9. Wire up the custom domains

For each Netlify site:

1. **Domain settings → Add custom domain**
2. Enter `play.mapolis.app` (or `admin.mapolis.app`)
3. Netlify will give you DNS instructions. Two options:
   - **CNAME record** at your DNS provider pointing the subdomain at the Netlify site URL
   - **Netlify DNS** — transfer NS records to Netlify, simpler if you have only this one project
4. Wait for DNS propagation (usually <5 min, can take up to an hour)
5. **Verify HTTPS** — Netlify auto-provisions Let's Encrypt certs once DNS resolves. Confirm the green padlock in browser.

### 10. Smoke test

Open both URLs in incognito (clean state):

- [ ] `https://play.mapolis.app` → game loads, profile picker appears, you can create a profile and start a session
- [ ] `https://admin.mapolis.app` → admin stub renders with the "Step 1 Stub" badge
- [ ] Browser dev tools console → no errors on either site
- [ ] Both URLs serve over HTTPS, not HTTP

### 11. Verification commit

Add a trivial change (an HTML comment in `index.html`), commit, push. Watch both Netlify sites auto-deploy. Confirm the change appears live on `play.mapolis.app`. Then revert the change (or leave it; it's just a comment).

---

## Verification gate (Step 1 done criteria)

All of these must be true before declaring Step 1 complete and moving to Step 2:

- [ ] Private GitHub repo exists with `index.html`, `admin.html`, `docs/`, `.gitignore`, `.env.example`
- [ ] `pre-phase-b-step-1` git tag exists on the initial commit (rollback safety)
- [ ] Two Netlify sites are linked to the repo and both auto-deploy on push
- [ ] `play.mapolis.app` serves the game over HTTPS
- [ ] `admin.mapolis.app` serves the stub over HTTPS
- [ ] A test commit (HTML comment) propagates to live within ~2 minutes of `git push`
- [ ] Smoke test passed: game playable from a clean device, no console errors

---

## What comes next (Step 2 preview, do NOT build in Step 1)

Step 2 is admin extraction + creation of `assets/shared.js`. The current `mapolis_v4.html` has an inline `syncStore` module (around line 19173) that needs to move into `shared.js` along with the Supabase client init. Both `index.html` and `admin.html` will load `shared.js` so they share the same data layer.

Step 2 also creates the real `admin.html` by moving the existing `s-admin` screen, `renderAdmin()`, `adminSetTab()`, and the Phase 5 analytics blocks out of `index.html` into the new file.

Step 2 is its own handoff doc, written after Step 1 is verified complete.

---

## Known issues / heads up

1. **The current game file has hardcoded placeholder Supabase URL/key** (around line 19173). They evaluate to "not configured" via `isSupabaseConfigured()`, so the sync queue is dormant. **Do not fill in real keys during Step 1.** Real keys land in Step 4 after the schema exists.

2. **The game file references "nsg_" localStorage keys** (e.g., `nsg_muted`, `nsg_messages`, `nsg_syncQueue`). These are legacy key names from when the project was called North Star Global. Don't rename them in Step 1 — that's a separate cleanup pass and renaming live keys orphans existing localStorage data on test devices.

3. **The merged `PATH_TO_LLC.md`** sits in the chat outputs from the planning session, not in `/mnt/project/`. Use the merged version, not any of the three legacy versions (`PATH_TO_LLC.md`, `PATH_TO_LLC__1_.md`, `PATH_TO_LLC_ADDENDUM_2026-04-09.md`). Once it's in the new repo's `docs/`, the legacy versions can be deleted from the project.

4. **No DNS yet?** If you don't own `mapolis.app` at the moment Step 1 starts, you can still complete steps 1–8 using the auto-generated `*.netlify.app` URLs Netlify gives each site. Step 9 (custom domains) waits until the registration completes. The rest of the build doesn't depend on the custom domains being live, only on the sites being deployable.

---

## Do NOT do in Step 1

- Do not create the Supabase project (Step 4)
- Do not write any schema SQL (Step 4)
- Do not extract the admin code from `index.html` (Step 2)
- Do not create `assets/shared.js` (Step 2)
- Do not touch the H2H stub or any gameplay logic (Step 6.5 backend swap)
- Do not start the privacy policy (deferred)
- Do not form the LLC (deferred)
- Do not register a Stripe account (deferred)

If something on this list feels tempting, that's the signal to stop and confirm Step 1 is done first. One step at a time, in order.

---

**Start with Step 1 of this document. When the verification gate passes, request the Step 2 handoff in a new chat.**

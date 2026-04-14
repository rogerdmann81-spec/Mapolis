# Mapolis H2H Build — Handoff to New Session

Continuing the Mapolis H2H build from a previous session. All design decisions are locked. Do not re-mock or re-propose; execute the build plan below against the uploaded files.

## Files to upload into the new session

1. **`mapolis_v1.html`** — working file, already has profile H2H stats integrated (twin Star Bank + Rating hero cards, Solo / Head to Head section headers, 3-up H2H grid, `profile.stats.h2h` schema with rating 1200 default)
2. **`queue_screen_mockup.html`** — approved queue screen visual spec, port verbatim
3. **`hud_final_b.html`** — approved in-match HUD spec (Mockup B)
4. **`results_mockup_v5.html`** — approved results screen spec (clean avatars, three Rematch states)
5. **`PHASE_B_BLUEPRINT (2).md`** — reference for data flows and terminology

## Build order

**Use option (a) for the in-match HUD — extend `s-game` with a mode flag, do NOT create a parallel screen.**

1. **Solo cleanup:** in `updateTimerDisplay()`, let `.score-lbl` keep reading "Stars" in all modes. The prog bar already carries the time.

2. **Stub data layer:** add a `_h2h` global state object + `H2HStub` module that fakes a remote opponent. Stub generates random handle, avatar, rating, match-found delay, randomized in-match answer schedule driving live score updates, and a random rematch decision. All screens read from/write to this module so Supabase can later be swapped in without touching UI code.

3. **"Head to Head" entry card** on the continent-select grid in `renderSetupSubPage`'s home view. Tap → `startH2HQueue()`.

4. **Queue screen `s-h2h-queue`** — port `queue_screen_mockup.html` verbatim. Stub drives fake counters; after randomized 2-5s delay fires `match_found` → transition to in-match.

5. **In-match HUD** — extend existing `s-game` with an H2H mode flag. Add the Mockup B HUD:
   - Prog bar reused as 60s clock (green→yellow→red at 33%/11%, same as solo timed)
   - Digital clock badge centered above prog bar
   - Player score chip left, question card center, opponent score chip right
   - Real profile avatars (DiceBear/Blobby from `profile.avatar.svg`)
   - No quit button in H2H mode — leaving = forfeit
   - Scoring: +1 correct / −0.5 incorrect (not stars)
   - Correct answers skip the highlight sequence; incorrect answers play the standard highlight

6. **Results screen `s-h2h-results`** — port `results_mockup_v5.html` verbatim.
   - Avatar sizes: winner 88px / loser 72px / tie 80px, no borders or glows
   - Headlines: "You Win!" / "Tie!" / no-header-for-loser
   - Columned W/L/T record, single rating+delta in stats
   - Four buttons: Stats (placeholder hook, see note below), Rematch, New opponent, Back
   - Three Rematch button states: default / you-requested (static green) / opponent-requested (green pulse, 1.4s cycle)

7. **State machine:** `H2H.transition('waiting' → 'matched' → 'playing' → 'finished')`. Disconnect handling stub.

8. **PHASE_B_BLUEPRINT.md updates:**
   - Document locked HUD spec in section 6.5
   - Add results screen spec
   - Update 6.5.3 to specify rating-based matchmaking with widening window (start ±50, expand by ±50 every ~3s, fall back to anyone at queue timeout)
   - Update section 0.7 to remove the "no tier matching for beta" line

## Execution style

**Push through steps 1-8 without stopping for visual checks.** Roger will debug the whole flow end-to-end after the build is complete.

## Key terminology

- **Matches** (not duels/battles)
- **Rating** in UI (not Elo)
- `competitive_ratings.elo` stays as the DB column name per blueprint

## Key constraints

- Elo math uses real deltas on all outcomes including ties (K=32, starting 1200)
- H2H scoring is +1 correct / −0.5 incorrect
- 60-second clock
- Card pool drawn from lower-rated player's tier
- No third-party analytics or trackers
- No quit button during H2H matches — leaving = forfeit

## Important caveat on the Stats button

The `Stats` button on the results screen is specced to open the existing solo results page with the rating delta added. That's a non-trivial change to the solo results page — it needs to learn about H2H context.

**For this build, wire Stats as a placeholder hook:** log `TODO: open solo stats with h2h context` to console and leave the button as a visible no-op. The actual solo-results augmentation is its own follow-up task after the main H2H flow works end-to-end.

---

**Start with step 1.**

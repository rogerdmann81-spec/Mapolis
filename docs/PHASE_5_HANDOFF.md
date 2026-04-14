# Mapolis — Phase 5 Handoff: Admin Panel Analytics Views

**Status:** Ready to implement **partially**. See "Critical dependency warning" below. Start in a fresh chat.

**Game file:** `mapolis_v3.html` (single-file HTML, ~24,900 lines, ~3.8 MB). Upload fresh at start of chat.

**Why this phase exists:** Roger wants the admin panel to surface new analytics: H2H vs solo play volume, educator adoption, cross-account coordination activity, per-feature engagement, and revenue breakdown by source.

---

## CRITICAL DEPENDENCY WARNING — READ BEFORE STARTING

Phase 5 was originally designed assuming Phases 2, 3, and 4 would land first. Roger has deferred Phases 2–4 to the "push to publish" process, so **some of Phase 5's intended blocks have no data source yet.**

Here's the reality for each planned block:

| Block | Data source exists? | Build in Phase 5? |
|---|---|---|
| **A. Play Mode Breakdown (H2H vs Solo daily)** | ⚠️ Partial — `profile.stats.h2h.matches` is a running total only, no per-day breakdown. `profile.stats.dayHistory` exists but doesn't distinguish modes. | **Build a degraded version** — see notes below |
| **B. Educator Growth & Coordination** | ✅ Yes — `profile.isEducator`, `profile.linkedEducators`, message store with timestamps all exist today | **Build in full** |
| **C. Feature Engagement (time, unique users, repeat rate)** | ❌ No — requires Phase 4D (screen time tracker) + Phase 4E (feature visit counter). Neither exists. | **Stub with empty-state only** |
| **D. Revenue Block** | ❌ No — requires Phase 2 (ad impressions store) + Phase 3 (`adsRemoved`, `educatorSubscription`). Neither exists. | **Stub with empty-state only** |

Recommendation: build B in full, build A as degraded, and put C and D behind feature flags or "Coming in next release" empty states so the admin panel UI is ready for data when the earlier phases land.

---

## Where to make changes

The existing admin analytics code is in `mapolis_v3.html` around:

- `renderAdmin()` — line ~24316 (tab switcher)
- `renderAdminAnalytics(profiles)` — line ~24698 (the HTML for the Analytics tab)
- `renderAdminCharts(profiles)` — line ~24771 (d3 chart rendering, called after HTML is injected)
- Individual chart functions: `adminChartDAU`, `adminChartGrowth`, `adminChartAcc`, `adminChartGames` around lines 24783–24855
- `adminBigCard(label, value)` helper — around line 24766, used for the small stat cards at the top
- `adminAllDates`, `adminBuildDateArr`, `adminBucket`, `adminRangeCutoff` — existing date/range utilities, reuse them
- Range keys `_adminRangeKey` and `adminSetRange()` — existing range filter (7d / 30d / 3m / 6m / 1y / all), respect in new charts

All new blocks should plug into the same `renderAdminAnalytics` return string and add their chart setup to `renderAdminCharts` so the range filter propagates cleanly.

---

## Scope — exactly what to build

### Block A — Play Mode Breakdown (DEGRADED)

**Intended:** Stacked bar chart, H2H games per day vs Solo games per day, over the selected range.

**Reality today:** We have total H2H matches (`profile.stats.h2h.matches`) and total day-history (`profile.stats.dayHistory[]`) but no per-day H2H counter. Until Phase 4A/B adds `h2hDayHistory[]` and `soloDayHistory[]`, the best we can do is:

**Build as summary cards, not a daily chart:**
- Total H2H matches (sum across all profiles of `stats.h2h.matches || 0`)
- Total solo games (sum of `stats.gamesPlayed`) minus total H2H matches = approx solo games
- H2H match ratio: `h2hTotal / (h2hTotal + soloTotal)` as a percentage
- Active H2H players: profiles with `stats.h2h.matches > 0`
- Active solo-only players: profiles with `stats.gamesPlayed > 0` and no H2H matches

Show these as four `adminBigCard` entries under a "Play Mode Breakdown" section header.

**Add a TODO comment in the code** that when Phase 4A/B lands, this block should be upgraded to a true daily stacked bar chart using the new `h2hDayHistory` and `soloDayHistory` fields. Sketch:
```js
// TODO(phase-4): Replace summary cards with daily stacked bar chart once
// h2hDayHistory and soloDayHistory per-profile arrays exist. Use the same
// date-bucketing pattern as adminChartDAU() — iterate adminBuildDateArr(),
// for each date sum profiles' h2hDayHistory.includes(date) and same for solo.
```

### Block B — Educator Growth & Coordination (BUILD IN FULL)

**All data already exists.** This is the main deliverable of Phase 5.

#### Summary cards
- **Total Educators** — `profiles.filter(p => p.isEducator).length`
- **Total Linked Students** — `profiles.filter(p => (p.linkedEducators || []).length > 0).length`
- **Avg Students / Educator** — linked students ÷ educators (guard divide-by-zero)
- **Largest Classroom** — `max` of each educator's linked-student count
- **Messages Sent (range)** — count messages in MSG_KEY store with `sentAt` within the selected range
- **Unique Conversation Pairs (range)** — count distinct `{fromId, toId}` pairs (order-independent) with activity in range
- **Avg Messages / Pair** — messages ÷ pairs in the range

#### Educator Growth chart
Line chart of cumulative educator count over time. Since we don't have an `educatorUnlockedAt` timestamp (deferred to Phase 4C), use the earliest entry in each educator's `stats.dayHistory[]` as a proxy for their unlock date. This is reasonable for beta — users who became educators presumably played the game first.

```js
var educatorFirstSeen = profiles
  .filter(function(p) { return p.isEducator; })
  .map(function(p) {
    var dh = (p.stats && p.stats.dayHistory) || [];
    return dh.length ? dh.slice().sort()[0] : null;
  })
  .filter(Boolean)
  .sort();
```

Bucket these by day (or week/month based on range) and draw as a cumulative line — same pattern as the existing `adminChartGrowth()`. Use a distinct color (gold `#ffe135` or similar) to differentiate from the existing profile-growth chart.

#### Top 5 Educators by Outbound Volume
Read MSG_KEY, filter to messages where `fromId` belongs to a profile with `isEducator: true`, group by `fromId`, count, sort desc, take top 5. Render as a simple HTML list:

```
1. Ms. Garcia      142 msgs · 18 students
2. Mr. Chen         89 msgs · 12 students
3. ...
```

#### Messages-per-day chart
Bar chart of messages sent per day in the range. Read MSG_KEY, bucket by date of `sentAt`. Same bucketing pattern as `adminChartDAU`.

#### Helper functions to add
```js
function adminLoadMessages() {
  try { var raw = localStorage.getItem(MSG_KEY); return raw ? JSON.parse(raw) : []; }
  catch(e) { return []; }
}

function adminMessagesInRange(cutoffDate) {
  var all = adminLoadMessages();
  if (!cutoffDate) return all;
  return all.filter(function(m) { return m.sentAt >= cutoffDate; });
}

function adminUniqueConvoPairs(msgs) {
  var pairs = {};
  msgs.forEach(function(m) {
    var key = [m.fromId, m.toId].sort().join('|');
    pairs[key] = true;
  });
  return Object.keys(pairs).length;
}

function adminTopEducatorsByVolume(profiles, msgs, n) {
  var eduIds = {};
  profiles.forEach(function(p) { if (p.isEducator) eduIds[p.id] = p; });
  var counts = {};
  msgs.forEach(function(m) {
    if (eduIds[m.fromId]) counts[m.fromId] = (counts[m.fromId] || 0) + 1;
  });
  return Object.keys(counts)
    .map(function(id) { return { profile: eduIds[id], count: counts[id] }; })
    .sort(function(a,b) { return b.count - a.count; })
    .slice(0, n);
}
```

### Block C — Feature Engagement (STUB ONLY)

**No data source.** Phase 4D and 4E are deferred. Build an empty-state card that says:

> **Feature Engagement**
>
> Per-feature time tracking, unique users, and repeat-visit rates will be shown here once engagement tracking is enabled.
>
> _Requires Phase 4 (engagement tracking) to be deployed._

Style it to match the existing chart cards (same `var(--bg-panel)` background, same border radius, same header label style) so it slots into the admin panel visually. Make it clear this is a placeholder, not a broken chart.

**Important:** Do NOT add fake/mock data to make this look populated. Keep it honest — empty state only.

### Block D — Revenue Block (STUB ONLY)

Same as Block C — no data source. Build a clearly-labeled empty state:

> **Revenue**
>
> Ad revenue (by gameplay source), Remove Ads purchases, and Educator Subscription MRR will appear here once monetization is enabled.
>
> _Requires Phases 2 and 3 (monetization + purchases) to be deployed._

Same visual styling as Block C.

---

## UI layout — where blocks go

Below the existing Analytics content, in this order:

```
[existing: big cards grid]
[existing: range filter]
[existing: Active Users chart (DAU)]
[existing: Cumulative Users chart (growth)]
[existing: Accuracy Distribution chart]
[existing: Games Per Profile chart]

--- NEW ---
[Block A: Play Mode Breakdown — summary cards with TODO]
[Block B: Educator Growth & Coordination — cards + growth chart + top 5 list + msgs/day chart]
[Block C: Feature Engagement — empty state placeholder]
[Block D: Revenue — empty state placeholder]
```

Each new block should be wrapped in the same `var(--bg-panel)` card style as existing charts. Use the section-header pattern already in use:

```js
'<div style="background:var(--bg-panel);border:1px solid var(--border);border-radius:14px;padding:14px;margin-bottom:12px;">'
  + '<div style="font-size:10px;color:var(--dim);text-transform:uppercase;letter-spacing:.1em;margin-bottom:10px;">SECTION TITLE</div>'
  + '<div id="admin-chart-xxx"></div>'
  + '</div>'
```

Rendering goes in `renderAdminAnalytics()` return string; d3 chart setup goes in `renderAdminCharts()` after `html` is injected into `admin-content`.

---

## Range filter integration

All new date-based charts and counters (Block B's messages-per-day chart, top educators in range, etc.) must respect `_adminRangeKey` and call `adminRangeCutoff(_adminRangeKey)` to get the cutoff date. The existing `adminSetRange()` handler already re-renders the whole analytics HTML and re-runs `renderAdminCharts()`, so as long as new charts read from `_adminRangeKey`, they'll update when the user switches the range.

---

## Testing checklist

1. **Admin panel loads** — Analytics tab shows existing blocks plus 4 new ones, no JS errors
2. **Range filter still works** — switch 7d / 30d / 3m / 6m / 1y / all, all new charts update
3. **Block A** — summary cards show correct totals matching raw data (manually verify against a profile or two)
4. **Block B with real data** — create a test educator profile, link 2 student profiles, send 5 messages from educator to students and 3 from students back. Verify:
   - Educator count increases by 1
   - Linked students count increases by 2
   - Messages-in-range count = 8
   - Unique pairs = 2
   - Top educators list shows the test educator with count 5
   - Messages/day chart shows today with value 8
5. **Block B with no data** — fresh install, no educators, empty state gracefully handles zero (no NaN, no divide-by-zero, shows "0" everywhere, no broken charts)
6. **Blocks C and D** — render as empty-state placeholders, no mock data visible
7. **Syntax check** — `node --check` on extracted JS passes

---

## Definition of done

- Four new blocks added to the admin Analytics tab in the correct order
- Block A: summary cards with TODO comment for Phase 4 upgrade
- Block B: fully functional — cards, growth chart, top educators list, messages/day chart
- Block C: honest empty-state placeholder with "requires Phase 4" note
- Block D: honest empty-state placeholder with "requires Phases 2 and 3" note
- Range filter propagates to all new date-sensitive elements in Block B
- Existing admin views (Profiles tab, existing Analytics charts, Notes tab) unchanged
- Syntax check passes

## Out of scope (do NOT build in Phase 5)

- Any new data tracking (that's Phases 2, 3, 4)
- Fake/mock data in the Feature Engagement or Revenue blocks
- Changes to the Profiles tab or individual profile detail view
- Changes to the existing DAU / Growth / Accuracy / Games charts

## When Phases 2, 3, 4 land later

Future thread should revisit Blocks A, C, and D:
- **Block A:** swap summary cards for daily stacked bar chart using `h2hDayHistory` and `soloDayHistory`
- **Block C:** replace empty state with three-column bar chart reading from `profile.stats.screenTime` and `profile.stats.featureVisits`
- **Block D:** replace empty state with cards for ad revenue (by mode), Remove Ads purchase count + revenue, educator subscription count + MRR, plus a stacked area chart of revenue by source over time

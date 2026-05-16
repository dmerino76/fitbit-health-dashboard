# Plan: Expand Google Fit Sleep & Heart Rate Coverage

## Context

The dashboard surfaces only a tiny slice of what Google Fit exposes. Two concrete user-visible problems:

1. **Sleep stages always render as 0** (`StageBox` boxes in `App.jsx:247-250`). Root cause: `fitGoogleToFitbitShape` in `server.js:551-561` reads `session.activityType` from the `/sessions` endpoint, but modern Google Fit stores per-stage data in the `com.google.sleep.segment` *dataset* (intVal 1=awake, 3=out-of-bed, 4=light, 5=deep, 6=REM). The sessions endpoint typically returns one parent session with activityType=72 and no sub-stages → today's mapping never matches.
2. **Many fields are missing**: bedtime, wake time, in-bed minutes, sleep efficiency, real intraday HR chart, real minutes-per-zone, and true daily HR aggregates (min/max/avg). The current "resting HR" is just whatever `point.value[0].fpVal` happens to be, and the four HR zones are computed from a hardcoded `220 − 30` formula (`server.js:539-545`), not actual time-in-zone.

Goal: enrich the `/api/health-data` payload, fix the stages bug, drive the current `ActivityChart` heart panel with a real 15-minute intraday series, extend the existing Sleep and Heart cards in `App.jsx` in place, and invalidate the cache so backfilled history picks up the new shape.

## Decisions

- **UI**: extend existing "Sleep architecture" and "Heart zones" cards in place — no new sections.
- **HR granularity**: 15-min buckets via `bucketByTime: 900000`.
- **Stage source**: `com.google.sleep.segment` dataset for stages; keep `/sessions` for bedtime/wake times.
- **Multi-session days**: longest sleep session = "main sleep" (drives bedtime/wake/efficiency); stage totals sum across all sessions of the day.
- **In-bed / efficiency**: in-bed = main session duration; efficiency = (light+deep+REM) ÷ in-bed × 100.
- **HRV**: skipped — not available via Google Fit REST.
- **Historical charts**: new sleep fields appear on the current-day card only; no new `ActivityChart` panels.
- **Cache**: one-time invalidation + backfill on first run after deploy.

## Backend changes — `server.js`

### 1. Fix sleep stage extraction + add bedtime/wake/in-bed/efficiency

In `fitGoogleToFitbitShape` (server.js:516), accept a new `sleepSegments` input alongside the existing `sleep` sessions:

- Replace the activityType-based stage loop (server.js:551-561) with a loop over `sleepSegments.bucket[].dataset[0].point[]`. Each point has `startTimeNanos`, `endTimeNanos`, and `value[0].intVal`. Map intVal: `4→light`, `5→deep`, `6→rem`, `1→wake`. Duration = `(endNanos − startNanos) / 60e9` minutes. Sum across all points in the day.
- Determine the **main sleep session**: from the existing `session[]` array, pick the one with the largest `endTimeMillis − startTimeMillis`. Expose:
  - `bedtime` = `new Date(parseInt(mainSession.startTimeMillis)).toISOString()`
  - `wakeTime` = same for `endTimeMillis`
  - `inBedMinutes` = `Math.round((endMillis − startMillis) / 60000)`
- `efficiency` = `Math.round((light+deep+rem) / inBedMinutes * 100)` (guard divide-by-zero).
- Add these to the returned `sleepSummary`: `{ totalMinutesAsleep, stages, bedtime, wakeTime, inBedMinutes, efficiency }`.

### 2. Add real HR aggregates and intraday series

In the `/api/health-data` handler (server.js:387), add two parallel fetches alongside the existing `Promise.all` (server.js:447-465):

- **Intraday HR (15-min buckets)** — `dataset:aggregate` with `aggregateBy: [{ dataTypeName: 'com.google.heart_rate.bpm' }]`, `bucketByTime: { durationMillis: 900000 }`, spanning `dayStart(today)` to `dayEnd(today)`. Returns up to 96 buckets. For each bucket, extract `point[0].value[0].fpVal` (the bucket average).
- **Daily HR aggregate** — already fetched as `heartData`; from its bucket extract `min`, `max`, `average`. Resting HR = the lowest 15-min bucket average where time is in the user's main sleep window. Fall back to daily min if no sleep window.

Compute **real minutes-per-zone** by walking the intraday series and bucketing each 15-min interval into one of the four zones using the same `220−30` thresholds as today. Each bucket contributes 15 minutes to its zone.

Add to the returned shape:
- `heartRate[0].value.restingHeartRate` (existing, now correctly computed)
- `heartRate[0].value.minBpm`, `maxBpm`, `avgBpm` (new)
- `heartRate[0].value.heartRateZones[i].minutes` (now populated from real data)
- `heartRate[0].intraday`: `[{ time: 'HH:MM', value: avgBpm }, …]` — drives the day-view chart.

### 3. Wire the segment fetch and pass it through

- Add a custom dataset request for `com.google.sleep.segment` with NO bucketing (just `startTimeMillis`/`endTimeMillis`), so each segment comes back as its own point. The existing `aggregate()` helper always buckets by 86400000ms and cannot be reused for this.
- Pass `sleepSegments: sleepSegmentData` into `fitGoogleToFitbitShape`.

### 4. Apply the same enrichments to `cacheHistoricalData` (server.js:594)

Mirror the same `com.google.sleep.segment` + intraday-HR fetches inside the historical backfill loop (server.js:673-741). Use the existing `aggregateWithRetry` for the intraday HR call. Add a separate retrying fetch for `com.google.sleep.segment` without bucketing. Pipe both into the same `fitGoogleToFitbitShape` call. Keep the existing 1.5s inter-day delay.

### 5. Cache invalidation

Add a one-shot migration on server startup, before `cacheHistoricalData` runs:
- New table: `cache_meta(key TEXT PRIMARY KEY, value TEXT)`.
- If `cache_meta` value for `health_data_schema` ≠ `"v2"`, run `DELETE FROM health_data_cache`, then set `"v2"`.
- The existing `cacheHistoricalData` then naturally repopulates with the new shape over ~20–40 min in the background.

`daily_summary` schema does NOT need a change — new sleep fields live only inside the `health_data_cache` JSON blob.

## Frontend changes — `fitbit-dashboard/src/App.jsx`

### Sleep architecture card (App.jsx:234-259)

After the StageBoxes grid, add four new fields using the same `border rounded-lg p-3` pattern:

- **Bedtime** — `new Date(data.sleepSummary.bedtime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })`.
- **Wake time** — same on `wakeTime`.
- **In bed** — `(data.sleepSummary.inBedMinutes / 60).toFixed(1)` hrs.
- **Efficiency** — `data.sleepSummary.efficiency`%.

Guard each with `?? 'N/A'` for pre-migration cached dates.

### Heart zones card (App.jsx:206-231)

Above the zone bars, add a 3-column mini-grid: **Min / Avg / Max** BPM from `heartRate[0].value`. Zone bars require no code change — they already read `zone.minutes`, which the backend now populates.

### Intraday HR chart

`ActivityChart` with `metricType="heart"` is at App.jsx:196. Add a branch in `/api/activity-history` (server.js:149):

```
if (range === 'day' && type === 'heart') {
  // pull heartRate[0].intraday from health_data_cache for targetDate
  // return as [{ label: 'HH:MM', value: bpm }, ...]
}
```

Pull from `health_data_cache` first; fall back to live aggregate on cache miss. No changes to `ActivityChart.jsx` itself.

## Critical files

- `server.js` — `fitGoogleToFitbitShape` (~line 516), `/api/health-data` (~line 387), `/api/activity-history` (~line 149), `cacheHistoricalData` (~line 594), startup migration (~line 20).
- `fitbit-dashboard/src/App.jsx` — Sleep card (~line 234), Heart zones card (~line 206).
- `fitbit-dashboard/src/components/ActivityChart.jsx` — **no changes**.

## Issues

Tracked as 5 GitHub Issues (vertical slices) under the **Sleep & HR expansion** milestone on this repo. Each issue is a full-stack slice — fetch → shape → route → UI — that can be demoed end-to-end before merging. See the milestone for current status.

### Dependency summary

| # | Title | Depends on | Complexity | Labels |
|---|-------|------------|------------|--------|
| 1 | Sleep stage boxes show real minutes | none | M | `fix` `backend` |
| 2 | Sleep card: bedtime / wake / in-bed / efficiency | #1 | M | `feature` `backend` `frontend` |
| 3 | Heart card: real zone minutes + min/avg/max BPM | none | M | `feature` `backend` `frontend` |
| 4 | HR chart "Day" view: 15-min intraday curve | #3 | S | `feature` `backend` |
| 5 | Cache: auto-invalidate on deploy + backfill new shape | #1, #3 | M | `infra` `backend` `cache` |

**Safe merge order:** #1 and #3 are independent — start both in parallel. #2 after #1. #4 after #3. #5 last.

---

### Issue #1 — Fix: sleep stage boxes show real deep/REM/light/awake minutes

**Slice summary:** Engineer fetches `com.google.sleep.segment`, wires it into the shape transform, and demos the four stage boxes showing non-zero numbers on any date with sleep data — no other UI work needed.

**Depends on:** none

**Layers touched:** server fetch · data transform · HTTP response payload
*(StageBoxes at `App.jsx:247-250` already consume `stages.*` correctly — no UI code change)*

**What to build:**

- In `/api/health-data` (`server.js:387`), add a custom inline dataset request alongside the existing `Promise.all` (`server.js:447-465`). Must NOT use `bucketByTime` — each sleep segment must come back as its own point:

  ```js
  const sleepSegmentsResp = await axios.post(
    'https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate',
    { aggregateBy: [{ dataTypeName: 'com.google.sleep.segment' }],
      startTimeMillis: dayStart(today), endTimeMillis: dayEnd(today) },
    { headers }
  ).catch(() => null);
  ```

- Pass `sleepSegments: sleepSegmentsResp?.data` into `fitGoogleToFitbitShape` (`server.js:516`).

- In `fitGoogleToFitbitShape`, replace the activityType stage loop (`server.js:551-561`) with a loop over `googleData.sleepSegments?.bucket?.[0]?.dataset?.[0]?.point ?? []`. Duration = `(endTimeNanos − startTimeNanos) / 60_000_000_000` min. intVal mapping: `1→wake`, `4→light`, `5→deep`, `6→rem` (skip 3=out-of-bed). `totalMinutesAsleep` still comes from the parent session (activityType=72, unchanged).

**What NOT to build:** bedtime/wake/efficiency (→ #2); cache backfill (→ #5); no UI component changes.

**Acceptance criteria:**
- [ ] `curl .../api/health-data?date=<date-with-sleep> | jq '.sleepSummary.stages'` → at least one of `{deep,rem,light,wake}` non-zero.
- [ ] Date with no sleep → `stages` all zero, no 500 error.
- [ ] Segment fetch failure → endpoint returns 200, stages all zero (not crash).
- [ ] `sleepSummary.totalMinutesAsleep` still populated from parent session.
- [ ] StageBoxes in UI render (browse dashboard — no crash, boxes show real numbers).

---

### Issue #2 — Feature: sleep card shows bedtime, wake time, in-bed duration, and efficiency

**Slice summary:** Engineer adds main-session logic to the shape transform and four new UI boxes to the Sleep card, and demos a date showing "Bedtime 11:30 PM · Wake 7:15 AM · In bed 7.8 hrs · Efficiency 87%" end-to-end.

**Depends on:** #1 *(efficiency = (light+deep+rem) / inBedMinutes — needs real stage totals)*

**Layers touched:** data transform · HTTP response payload · frontend component

**What to build:**

- In `fitGoogleToFitbitShape` (`server.js:516`), after the stage loop, find the main sleep session (longest by duration): `googleData.sleep.session?.reduce((a, b) => (b.endTimeMillis - b.startTimeMillis) > (a.endTimeMillis - a.startTimeMillis) ? b : a, googleData.sleep.session?.[0])`.

- Compute: `bedtime` (ISO string from startTimeMillis), `wakeTime` (endTimeMillis), `inBedMinutes` (rounded duration), `efficiency` = `round((light+deep+rem) / inBedMinutes * 100)` guarded against divide-by-zero. All four are `null` when no sessions.

- In `App.jsx`, after StageBoxes (`App.jsx:251`), add a 2×2 grid conditionally rendered only when `data.sleepSummary.bedtime != null`. Use a local `SleepMetaBox` component with the same `border rounded-lg p-3` pattern. Format bedtime/wake via `new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })`.

**What NOT to build:** Heart card changes (→ #3); cache backfill (→ #5).

**Acceptance criteria:**
- [ ] `curl .../api/health-data?date=<date-with-sleep> | jq '.sleepSummary | {bedtime,wakeTime,inBedMinutes,efficiency}'` → all four non-null and plausible.
- [ ] Efficiency is 0–100 (never >100, never negative).
- [ ] Sleep card shows 2×2 grid with Bedtime/Wake/In bed/Efficiency on a date with sleep.
- [ ] Date without sleep → 2×2 grid does NOT render (no "null" visible).
- [ ] "No sleep data recorded" state (`App.jsx:256-258`) still appears on zero-sleep dates.
- [ ] Stage boxes from #1 still show alongside the new boxes.

---

### Issue #3 — Feature: heart card shows real zone minutes, min/avg/max BPM, and corrected resting HR

**Slice summary:** Engineer adds a 15-min intraday HR fetch, computes real zone minutes and daily aggregates, adds a Min/Avg/Max BPM row to the Heart card, and demos zone bars with real widths and the new stats row — all from one PR.

**Depends on:** none *(resting HR uses daily min as fallback when no sleep window)*

**Layers touched:** server fetch · data transform · HTTP response payload · frontend component

**What to build:**

- In `/api/health-data` (`server.js:387`), add a 15-min intraday HR fetch to `Promise.all`: `com.google.heart_rate.bpm` with `bucketByTime: { durationMillis: 900000 }`. Returns up to 96 buckets — non-empty ones become `heartRate[0].intraday = [{ time: 'HH:MM', value: avgBpm }]`.

- From the intraday series, compute zone minutes: each non-empty bucket adds 15 to its zone using the existing `220 − 30` thresholds (`server.js:539-545`). Overwrites the zeros in `heartRateZones[i].minutes`.

- From the existing `heartData` bucket, extract `minBpm`, `maxBpm`, `avgBpm`. Use `minBpm` as `restingHeartRate`. Add `{restingHeartRate, minBpm, maxBpm, avgBpm}` to `heartRate[0].value`.

- In `App.jsx`, Heart zones card (`App.jsx:206-231`), insert a 3-column min/avg/max grid between the heading and the zone list. Zone bars need no code change — they already read `zone.minutes`.

**What NOT to build:** Day-view HR chart route (→ #4); cache backfill (→ #5).

**Acceptance criteria:**
- [ ] `curl .../api/health-data?date=<today> | jq '.heartRate[0].value | {minBpm,avgBpm,maxBpm,restingHeartRate}'` → all non-zero on a day HR was tracked.
- [ ] `jq '.heartRate[0].value.heartRateZones | map(.minutes)'` → at least one non-zero; sum ≈ tracked intervals × 15.
- [ ] `jq '.heartRate[0].intraday | length'` → 1–96.
- [ ] Heart card shows Min/Avg/Max row with real BPM values above zone bars.
- [ ] Zone bars have non-zero widths on an active day.
- [ ] Intraday fetch failure → 200 returned; `intraday: []`, zone minutes 0, min/avg/max 0.
- [ ] Existing zone names/ranges (`Out of Zone`, `Fat Burn`, `Cardio`, `Peak`) still render correctly.

---

### Issue #4 — Feature: HR chart "Day" view renders a 15-min intraday curve

**Slice summary:** Engineer adds a `range=day&type=heart` branch to `/api/activity-history` that reads the cached intraday series, and demos the "Day" button on the Heart Rate chart rendering a smooth curve instead of a single bar.

**Depends on:** #3 *(intraday array must exist in `health_data_cache` before this branch can read it)*

**Layers touched:** HTTP route / response payload
*(ActivityChart at `App.jsx:196` is metric-agnostic — no UI code change needed)*

**What to build:**

- In `/api/activity-history` (`server.js:149`), add a branch for `range === 'day' && type === 'heart'`:
  1. Read `health_data_cache` row for `targetDate`.
  2. If found: return `JSON.parse(row.data).heartRate[0].intraday.map(p => ({ label: p.time, value: p.value }))`.
  3. If not found: live-fetch 15-min intraday HR and return same shape.
  4. Any failure: return `[]`.

**What NOT to build:** Cache backfill (→ #5); no changes to `ActivityChart.jsx`.

**Acceptance criteria:**
- [ ] `curl ".../api/activity-history?range=day&type=heart&date=<date>" | jq 'length'` → 1–96; `jq '.[0]'` → `{ "label": "HH:MM", "value": <number> }`.
- [ ] Clicking "Day" on the HR chart → smooth area curve renders.
- [ ] Uncached date → falls back to live fetch, still returns valid array.
- [ ] Live fetch failure → returns `[]`, chart shows empty state, no crash.
- [ ] "Week" and "Month" buttons on HR chart still work.
- [ ] "Day" on Steps chart still uses the existing steps path (`server.js:176`), unaffected.

---

### Issue #5 — Infra: historical cache auto-invalidates on deploy and backfills with new data shape

**Slice summary:** Engineer adds a schema-version table, wipes the old cache on startup, updates `cacheHistoricalData` to fetch sleep segments + intraday HR, and demos a server restart that logs the wipe then progressively repopulates historical dates with real stages/bedtime/zones.

**Depends on:** #1, #3 *(backfill must produce the new shape those issues define)*

**Layers touched:** DB schema · server fetch · data transform
*(No UI changes; historical dates just start rendering correctly as rows are rebuilt)*

**What to build:**

- In schema init (`server.js:20`), add `CREATE TABLE IF NOT EXISTS cache_meta (key TEXT PRIMARY KEY, value TEXT)`.

- After schema init, add a migration check: if `cache_meta` value for `health_data_schema` ≠ `"v2"`, run `DELETE FROM health_data_cache`, log `[CACHE] Schema v2 migration: cleared health_data_cache for rebuild`, set version to `"v2"`, then call `cacheHistoricalData()`. Remove any existing direct call to `cacheHistoricalData()` at startup (migration is now the only trigger).

- In `cacheHistoricalData` (`server.js:594`), inside the per-date loop (`server.js:673-741`), add:
  1. Intraday HR: `aggregateWithRetry` with `bucketByTime: 900000` — add a `bucketDurationMs` parameter (default 86400000) to the existing helper (`server.js:625`).
  2. Sleep segments: new retrying helper that omits `bucketByTime` entirely.
  3. Pass both to `fitGoogleToFitbitShape`.

**What NOT to build:** No UI changes; no `daily_summary` schema changes (new fields stay in the `health_data_cache` JSON blob).

**Acceptance criteria:**
- [ ] First restart: `server.log` shows `[CACHE] Schema v2 migration: cleared health_data_cache for rebuild` exactly once, then `[CACHE] Cached YYYY-MM-DD` lines resuming.
- [ ] Second restart: NO deletion log; existing rows preserved; already-cached dates skipped.
- [ ] After a date repopulates: `sqlite3 fitbit.db "SELECT json_extract(data, '$.sleepSummary.efficiency') FROM health_data_cache WHERE date='<date-with-sleep>'"` → number 0–100 (not null).
- [ ] After a date repopulates: `sqlite3 fitbit.db "SELECT json_extract(data, '$.heartRate[0].intraday') FROM health_data_cache WHERE date='<recent>'"` → non-empty JSON array.
- [ ] Single-date fetch failure (segment or intraday) → that date's row still written with zeros; loop continues.
- [ ] Existing fields (`steps`, `calories`, `sleepSummary.totalMinutesAsleep`) still present in repopulated rows.
- [ ] `/api/health-data` for a repopulated historical date serves from cache (log shows `[API-CACHE] Health data hit`) with new fields present.

## Verification

1. Start the server and hit `curl http://localhost:3000/api/health-data?date=<recent-date> -H "Authorization: Bearer <token>"`. Confirm:
   - `sleepSummary.stages.{deep,rem,light,wake}` non-zero for a date with stage data.
   - `sleepSummary.{bedtime,wakeTime,inBedMinutes,efficiency}` populated.
   - `heartRate[0].value.{minBpm,maxBpm,avgBpm}` populated.
   - `heartRate[0].value.heartRateZones[].minutes` non-zero (sum ≈ total worn time).
   - `heartRate[0].intraday` has 80–96 points for a fully-worn day.
2. On startup, confirm `[CACHE] DELETE FROM health_data_cache` log appears once only.
   Spot-check: `sqlite3 fitbit.db "SELECT json_extract(data, '$.sleepSummary.efficiency') FROM health_data_cache WHERE date='<recent>'"`.
3. Open `http://localhost:5173`, navigate to a recent date. Confirm Sleep card shows stages + bedtime/wake/in-bed/efficiency; Heart card shows Min/Avg/Max + real zone bars; HR chart "Day" view shows a smooth 96-point curve.
4. Open a date with no sleep — "No sleep data recorded" still shows (App.jsx:256-258). Open a pre-migration date mid-backfill — all new fields show `N/A`, no crash.

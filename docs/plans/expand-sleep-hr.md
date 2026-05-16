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

Tracked as 10 GitHub Issues under the **Sleep & HR expansion** milestone on this repo. See the milestone for current status.

| # | Title | Labels | Depends on |
|---|-------|--------|------------|
| 1 | Sleep stages always render 0: switch to `com.google.sleep.segment` | bug, backend | — |
| 2 | Fetch `com.google.sleep.segment` in `/api/health-data` | feature, backend | #1 |
| 3 | Add bedtime/wake/in-bed/efficiency to `sleepSummary` | feature, backend | #1 |
| 4 | Add daily HR min/max/avg + corrected resting HR | feature, backend | — |
| 5 | Intraday HR (15-min) + real minutes-per-zone | feature, backend | — |
| 6 | Mirror sleep/HR enrichments in `cacheHistoricalData` | feature, backend | #2, #5 |
| 7 | One-shot cache invalidation + `cache_meta` table | feature, backend | #6 |
| 8 | Day-view HR chart branch in `/api/activity-history` | feature, backend | #5 |
| 9 | Sleep card: bedtime/wake/in-bed/efficiency UI | feature, frontend, ui | #3 |
| 10 | Heart zones card: Min/Avg/Max BPM | feature, frontend, ui | #4 |

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

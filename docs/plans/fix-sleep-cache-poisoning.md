# Fix: Sleep Architecture Empty on Past Dates

## Context

The Sleep Architecture card shows "No sleep data recorded" for any previously-viewed
past date, even when sleep data exists in Google Fit. Today always displays correctly.

**Root cause — cache poisoning.** When a past date is loaded for the first time,
`server.js` fetches from Google Fit and writes the result to `health_data_cache`
(SQLite). If sleep hadn't synced to Google Fit at the moment of that first fetch, the
result is cached with `totalMinutesAsleep = 0`. Every subsequent load for that date
returns the stale cached entry. Today bypasses the cache entirely (always re-fetches),
which is why it works.

The `daily_summary` table has the same problem: `sleep_minutes = 0` rows poison the
30-day sleep trend chart used by `/api/activity-history`.

## Decisions (from design interview)

| # | Question | Decision |
|---|----------|----------|
| 1 | Root cause | Cache poisoning confirmed |
| 2 | Existing poisoned entries | Delete from `health_data_cache` on server startup |
| 3 | Future prevention | Skip `health_data_cache` write when `totalMinutesAsleep === 0` |
| 4 | All-nighter edge case | Accept — perpetual re-fetches are harmless |
| 5 | `daily_summary` fix | Yes — fix both tables (cache + trend chart) |

## Critical File

`server.js` — all four changes are here.

---

## Changes

### 1. Startup cleanup — inside `db.serialize()` block (~line 46)

Add after the existing `CREATE TABLE` statements:

```javascript
// Remove cache entries poisoned with zero sleep (written before sleep synced to Google Fit)
db.run(`DELETE FROM health_data_cache
        WHERE CAST(json_extract(data, '$.sleepSummary.totalMinutesAsleep') AS INTEGER) = 0
           OR json_extract(data, '$.sleepSummary.totalMinutesAsleep') IS NULL`);
db.run(`UPDATE daily_summary SET sleep_minutes = NULL WHERE sleep_minutes = 0`);
```

### 2. `/api/health-data` cache write guard (~line 577)

**Before:**
```javascript
if (!isToday) {
  db.run(
    "INSERT OR REPLACE INTO health_data_cache (date, data, created_at) VALUES (?, ?, ?)",
    [today, JSON.stringify(result), Math.floor(Date.now() / 1000)]
  );
}
```

**After:**
```javascript
if (!isToday && (result.sleepSummary?.totalMinutesAsleep ?? 0) > 0) {
  db.run(
    "INSERT OR REPLACE INTO health_data_cache (date, data, created_at) VALUES (?, ?, ?)",
    [today, JSON.stringify(result), Math.floor(Date.now() / 1000)]
  );
}
```

### 3. `cacheHistoricalData()` cache write guard (~line 900)

Same guard in the background 90-day warm-up function:

**Before:**
```javascript
db.run(
  "INSERT OR REPLACE INTO health_data_cache (date, data, created_at) VALUES (?, ?, ?)",
  [dateStr, JSON.stringify(result), Math.floor(Date.now() / 1000)]
);
```

**After:**
```javascript
if ((result.sleepSummary?.totalMinutesAsleep ?? 0) > 0) {
  db.run(
    "INSERT OR REPLACE INTO health_data_cache (date, data, created_at) VALUES (?, ?, ?)",
    [dateStr, JSON.stringify(result), Math.floor(Date.now() / 1000)]
  );
}
```

### 4. `daily_summary` write — NULL instead of 0 (~line 915)

Prevents poisoning the sleep trend chart with zero-sleep rows.

**Before:**
```javascript
[steps, sleepMins, hr, weight, dateStr]
```

**After:**
```javascript
[steps, sleepMins || null, hr, weight, dateStr]
```

---

## Verification

1. Restart the server — confirm no startup errors in logs.
2. Navigate to a past date that previously showed "No sleep data recorded" — it should
   now re-fetch from Google Fit and display sleep stages/totals.
3. Reload the same past date — if sleep data came back, confirm it is now cached and
   loads instantly (no extra API call in server logs).
4. Navigate to a past date with genuinely no sleep — confirm it shows "No sleep data
   recorded" and re-fetches each time (no cache entry written).
5. Confirm today's date still works correctly.
6. Open the Sleep trend chart (30-day view) — previously-zero dates should now re-fetch
   from Google Fit and populate with correct values.

---

## Issues

### #1 — Purge poisoned sleep cache so past dates show real sleep architecture

**Slice summary:**
On server restart, delete all `health_data_cache` entries with zero sleep and guard the on-demand fetch write so a zero-sleep result is never permanently cached — enabling a past date to re-fetch from Google Fit until real sleep data appears.

**Depends on:** none

**Labels:** `fix` `backend` `cache`

**Complexity:** S (< 4h)

**Layers touched:**
- [x] DB / schema (startup DELETE against `health_data_cache`)
- [ ] Server fetch / external API call
- [ ] Data transform / shape
- [x] HTTP route / response payload (cache write guard on `/api/health-data`)
- [ ] Frontend component / state (no change — card already renders correctly when data > 0)

**What to build:**
- `server.js:20-46` — inside `db.serialize()`, after the `CREATE TABLE` statements, add:
  ```javascript
  db.run(`DELETE FROM health_data_cache
          WHERE CAST(json_extract(data, '$.sleepSummary.totalMinutesAsleep') AS INTEGER) = 0
             OR json_extract(data, '$.sleepSummary.totalMinutesAsleep') IS NULL`);
  ```
- `server.js:577-582` — wrap the cache write in a sleep guard:
  ```javascript
  if (!isToday && (result.sleepSummary?.totalMinutesAsleep ?? 0) > 0) {
    db.run("INSERT OR REPLACE INTO health_data_cache ...", [...]);
  }
  ```

**What NOT to build (out of scope for this slice):**
- The `cacheHistoricalData()` background warm-up guard (that's #2)
- The `daily_summary` NULL write fix (that's #2)
- The startup `UPDATE daily_summary` cleanup (that's #2)
- Any frontend changes

**Acceptance criteria:**
- [ ] Restart server → `sqlite3 fitbit.db "SELECT COUNT(*) FROM health_data_cache WHERE json_extract(data,'$.sleepSummary.totalMinutesAsleep')=0"` returns `0`
- [ ] Navigate to a past date that previously showed "No sleep data recorded" → sleep architecture card displays sleep data; server log shows a fresh Google Fit fetch (no cache hit log line)
- [ ] Reload that same past date → server log shows cache hit; no second Google Fit call
- [ ] Navigate to today → still displays correctly (today path is unchanged)
- [ ] Edge case: navigate to a past date with genuinely zero sleep → "No sleep data recorded" shown; server log shows a Google Fit fetch on every load (no cache entry written)

**Traceability:**
- Plan section: `Changes — 1. Startup cleanup` and `Changes — 2. /api/health-data cache write guard`
- Source files: `server.js:20-46`, `server.js:577-582`

---

### #2 — Prevent background cache warm-up from re-poisoning sleep data and fix trend chart zeros

**Slice summary:**
Apply the zero-sleep guard to `cacheHistoricalData()` and write `NULL` instead of `0` to `daily_summary.sleep_minutes`, so neither the 90-day background warm-up nor subsequent trend-chart reads re-introduce stale zeros after #1 clears them.

**Depends on:** none (independent code paths; can merge before or after #1)

**Labels:** `fix` `backend` `cache` `data`

**Complexity:** S (< 4h)

**Layers touched:**
- [x] DB / schema (startup UPDATE on `daily_summary`; NULL write going forward)
- [ ] Server fetch / external API call
- [ ] Data transform / shape
- [x] HTTP route / response payload (`cacheHistoricalData` cache write guard)
- [ ] Frontend component / state (trend chart already handles NULL/0 gracefully via Google Fit fallback)

**What to build:**
- `server.js:20-46` — in `db.serialize()`, alongside #1's DELETE, also add:
  ```javascript
  db.run(`UPDATE daily_summary SET sleep_minutes = NULL WHERE sleep_minutes = 0`);
  ```
- `server.js:900-903` — wrap the `cacheHistoricalData` cache write in a sleep guard:
  ```javascript
  if ((result.sleepSummary?.totalMinutesAsleep ?? 0) > 0) {
    db.run("INSERT OR REPLACE INTO health_data_cache ...", [...]);
  }
  ```
- `server.js:914-917` — write `NULL` instead of `0` for missing sleep:
  ```javascript
  [steps, sleepMins || null, hr, weight, dateStr]
  ```

**What NOT to build (out of scope for this slice):**
- The `health_data_cache` startup DELETE (that's #1)
- The `/api/health-data` single-date guard (that's #1)
- Any changes to how `/api/activity-history` reads `daily_summary` — the existing Google Fit fallback already handles NULL values correctly

**Acceptance criteria:**
- [ ] Restart server → `sqlite3 fitbit.db "SELECT COUNT(*) FROM daily_summary WHERE sleep_minutes=0"` returns `0`
- [ ] Open the Sleep trend chart (30-day view) → dates that previously showed 0 mins now show fetched values or blank (not zero bar)
- [ ] After background `cacheHistoricalData()` runs → `sqlite3 fitbit.db "SELECT COUNT(*) FROM health_data_cache WHERE json_extract(data,'$.sleepSummary.totalMinutesAsleep')=0"` remains `0`
- [ ] A date with real sleep data gets a `health_data_cache` entry written by the warm-up
- [ ] A date with zero sleep gets no `health_data_cache` entry; its `daily_summary.sleep_minutes` is `NULL` (not `0`)
- [ ] No regression: `steps`, `resting_hr`, and `weight` columns in `daily_summary` are unaffected by the NULL change

**Traceability:**
- Plan section: `Changes — 3. cacheHistoricalData() cache write guard` and `Changes — 4. daily_summary write — NULL instead of 0`
- Source files: `server.js:20-46`, `server.js:900-903`, `server.js:914-917`

---

## Dependency Summary

| # | Title (short) | Depends on | Complexity | Labels |
|---|---------------|------------|------------|--------|
| 1 | Purge poisoned cache + guard on-demand write | none | S | fix, backend, cache |
| 2 | Guard background warm-up + fix trend chart NULLs | none | S | fix, backend, cache, data |

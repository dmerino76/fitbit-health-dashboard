# Plan: Backend module stack — CacheStore, GoogleFitGateway, MetricHistory

## Context

From the `/improve-codebase-architecture` review. Three backend candidates (1, 2, 3) and
one frontend candidate (5) are being sliced together because candidates 1–3 form a
layered stack rather than independent extractions.

## Decisions (locked)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Architecture shape | Stack (not Parallel) | MetricHistory uses CacheStore + GoogleFitGateway; route handlers become thin |
| Scope | Full (both routes) | `/api/health-data` and `/api/activity-history` both refactored |
| fitGoogleToFitbitShape | Dissolves into GoogleFitGateway | Route handler stops knowing about Google Fit's response format |
| Module location | `lib/` at project root | Conventional for Node.js; avoids polluting root alongside `server.js` |

## Stack diagram

```
GET /api/health-data (thin route handler)
    → CacheStore.getSnapshot(date) / .setSnapshot(date, snapshot)
    → GoogleFitGateway.fetchDay(token, date)

GET /api/activity-history (thin route handler)
    → MetricHistory.getRange(type, date, range, token, refreshToken)
        → CacheStore.getDailySummary(dates, col) / .setDailySummary(date, vals)
        → CacheStore.getIntraday(date) / .setIntraday(date, json)
        → GoogleFitGateway.fetchAggregate(token, dates, dataType)
        → GoogleFitGateway.fetchIntraday(token, date)

cacheHistoricalData() (background warm-up)
    → GoogleFitGateway.fetchDay(token, date)
    → CacheStore.setSnapshot(date, snapshot)
    → CacheStore.setDailySummary(date, vals)
```

## Module interfaces

### `lib/cache.js` — CacheStore

```js
getSnapshot(date)                    // → Promise<object|null>  — reads health_data_cache
setSnapshot(date, snapshot)          // → Promise<void>         — writes health_data_cache; owns poisoning guards
getDailySummary(dates, column)       // → Promise<Map<string,number>>  — reads daily_summary
setDailySummary(date, values)        // → Promise<void>         — writes daily_summary
getIntraday(date)                    // → Promise<object|null>  — reads intraday_json
setIntraday(date, json)              // → Promise<void>         — writes intraday_json
```

Poisoning guards (currently scattered across `server.js:46-58` and `server.js:590-598`)
move into `setSnapshot`. No caller ever thinks about validation again.

### `lib/googleFitGateway.js` — GoogleFitGateway

```js
fetchDay(token, date)                // → Promise<FitnessSnapshot>      — 9 parallel API calls + fitGoogleToFitbitShape logic
fetchAggregate(token, dates, type)   // → Promise<[{date, value}]>      — multi-day aggregate for activity-history
fetchIntraday(token, date)           // → Promise<[{label, value}]>     — 15-min HR or daily steps bucket
```

`fitGoogleToFitbitShape` (`server.js:611-767`) dissolves into `fetchDay` internals.
All Google Fit data type strings and domain constants (sleep stage codes, `activityType === 72`,
`maxHR = 190`) live here and nowhere else.

### `lib/metricHistory.js` — MetricHistory

```js
getRange(type, date, range, token, refreshToken)
// → Promise<[{label: string, date: string, value: number}]>
// type: 'steps' | 'heart' | 'sleep' | 'weight'
// range: 'day' | 'week' | 'month'
```

Owns the cache-read → identify-missing → fetch → upsert pattern and the rate-limit
fallback (429 → return cached values). Uses CacheStore and GoogleFitGateway internally.

## Source references

| Concern | Current location |
|---------|-----------------|
| Poisoning guards (startup purge) | `server.js:46-58` |
| health-data cache read | `server.js:457-467` |
| health-data cache write (with guard) | `server.js:589-599` |
| Promise.all API calls | `server.js:522-543` |
| Sleep sessions fetch | `server.js:545-572` |
| `fitGoogleToFitbitShape` | `server.js:611-767` |
| activity-history route (full) | `server.js:166-440` |
| Background warm-up | `server.js:770-960` |
| `formatDate` in App.jsx | `App.jsx:42-45` |
| `formatDate` in ActivityChart.jsx | `ActivityChart.jsx:37-38` |

---

## Issues

### #1 — Concentrate cache reads, writes, and poisoning guards in CacheStore

**Slice summary:** An engineer can demo that all cache reads and writes in `/api/health-data`
and the background warm-up flow through `CacheStore`, and that poisoning-guard logic exists
in exactly one place (`setSnapshot`) rather than three.

**Depends on:** none

**Labels:** `refactor`, `backend`, `cache`

**Complexity:** M (4–8h)

**Layers touched:**
- [x] DB / schema (inline SQLite calls moved into module)
- [x] HTTP route / response payload (route reads/writes replaced, behaviour unchanged)

**What to build:**

1. Create `lib/cache.js` exposing six methods (see interface above). Each method wraps
   the relevant `db.get` / `db.run` / `db.all` callback in a Promise.

2. `setSnapshot(date, snapshot)` must:
   - Reject (silently skip, log warning) if `snapshot.sleepSummary?.totalMinutesAsleep` ≤ 0
   - Reject if `snapshot.heartRate?.[0]?.value?.avgBpm` ≤ 0
   - Write `INSERT OR REPLACE INTO health_data_cache` otherwise
   - These guards currently live at `server.js:590-598` and in the startup SQL at `server.js:46-58`

3. In `/api/health-data` (`server.js:457-467` and `server.js:589-599`):
   - Replace `db.get("SELECT data FROM health_data_cache …")` with `CacheStore.getSnapshot(date)`
   - Replace the inline `db.run("INSERT OR REPLACE INTO health_data_cache …")` block with `CacheStore.setSnapshot(date, result)`
   - Remove the guard `if (!isToday && totalMinutesAsleep > 0 && avgBpm > 0)` — it now lives in `setSnapshot`

4. In `cacheHistoricalData` (`server.js:770-960`):
   - Replace all inline `db.run("INSERT OR REPLACE INTO health_data_cache …")` calls with `CacheStore.setSnapshot`
   - Replace all inline `db.run("INSERT OR REPLACE INTO daily_summary …")` calls with `CacheStore.setDailySummary`

5. Remove the startup SQL purge block (`server.js:46-58`) — `setSnapshot`'s guard prevents
   poison entries from ever being written; a one-time migration comment may remain for history.

**What NOT to build (out of scope for this slice):**
- Do not touch `/api/activity-history` — its daily_summary and intraday reads stay as-is until #3
- Do not create `GoogleFitGateway` or `MetricHistory`
- Do not change the JSON response shape of `/api/health-data` — callers see no difference
- Do not add cache TTL or invalidation beyond what currently exists

**Acceptance criteria:**
- [ ] `curl "http://localhost:3000/api/health-data?date=YYYY-MM-DD" -H "Authorization: Bearer $TOKEN"` returns the same JSON shape as before
- [ ] A past date with real sleep data is served from cache on second request (verify with `[API-CACHE]` log line)
- [ ] Manually inserting a row with `totalMinutesAsleep = 0` into `health_data_cache` then calling `setSnapshot` with valid data overwrites it; inserting via `setSnapshot` with zero sleep is silently skipped
- [ ] Server startup no longer runs the DELETE purge SQL at `server.js:46-58`
- [ ] No regression: `/api/activity-history` still returns data for all metric types

**Traceability:**
- Plan section: `CacheStore module interfaces`
- Source files: `server.js:46-58`, `server.js:457-467`, `server.js:589-599`, `server.js:770-960`

---

### #2 — Concentrate all Google Fit API knowledge in GoogleFitGateway

**Slice summary:** An engineer can demo that `/api/health-data` calls a single
`gateway.fetchDay(token, date)` and receives a `FitnessSnapshot`, with `fitGoogleToFitbitShape`
gone from `server.js` and all Google Fit data type strings living only in `lib/googleFitGateway.js`.

**Depends on:** #1

**Labels:** `refactor`, `backend`

**Complexity:** M (4–8h)

**Layers touched:**
- [x] Server fetch / external API call
- [x] Data transform / shape
- [x] HTTP route / response payload (route simplified, response unchanged)

**What to build:**

1. Create `lib/googleFitGateway.js` with three methods:

   **`fetchDay(token, date)`**
   - Accepts an access token and a date string
   - Reproduces the `aggregate()` and `aggregateIntraday()` helpers (`server.js:482-520`)
   - Fires the same `Promise.all` of 9 aggregate calls (`server.js:522-543`)
   - Fires the sleep sessions GET (`server.js:545-561`)
   - Fires the sleep segments aggregate (`server.js:563-572`)
   - Runs the full `fitGoogleToFitbitShape` logic (`server.js:611-767`) internally
   - Returns the `FitnessSnapshot` object (same shape `fitGoogleToFitbitShape` currently returns)
   - All Google Fit data type constants (`'com.google.step_count.delta'` etc.), sleep session codes
     (`activityType === 72`), sleep stage codes (`intVal 1/4/5/6`), and `maxHR = 190` live here

   **`fetchAggregate(token, dates, dataType)`**
   - Accepts multiple dates and one data type name
   - Returns `[{date: string, value: number}]`
   - Used by MetricHistory in #3; stub it out here as a placeholder that throws
     `'Not yet implemented'` — it will be filled in during #3

   **`fetchIntraday(token, date)`**
   - Returns `[{label: string, value: number}]` (15-min HR buckets or daily steps)
   - Same stub approach as `fetchAggregate` — filled in during #3

2. In `/api/health-data` (`server.js:478-601`):
   - Replace the entire fetch + transform block with `const result = await gateway.fetchDay(accessToken, today)`
   - Replace `CacheStore.getSnapshot` call (from #1) — keep it, just slot `gateway.fetchDay` as the cache-miss path
   - Delete `fitGoogleToFitbitShape` from `server.js`
   - Delete the inline `aggregate()` and `aggregateIntraday()` helpers — they move into the gateway

3. In `cacheHistoricalData` (`server.js:770-960`):
   - Replace the per-date fetch block (currently uses `aggregateWithRetry` and
     `fetchSleepSegmentsWithRetry`, `server.js:800-870`) with `gateway.fetchDay(accessToken, dateStr)`
   - The gateway's internal retry logic replaces `aggregateWithRetry`

**What NOT to build (out of scope for this slice):**
- `fetchAggregate` and `fetchIntraday` are stubs only — no real implementation yet
- Do not touch `/api/activity-history` — MetricHistory wires the gateway in #3
- Do not change the response shape of `/api/health-data`

**Acceptance criteria:**
- [ ] `curl "http://localhost:3000/api/health-data?date=YYYY-MM-DD" -H "Authorization: Bearer $TOKEN"` returns the same JSON shape as before this issue
- [ ] `grep -n "fitGoogleToFitbitShape\|com.google.step_count" server.js` returns no matches — all references live in `lib/googleFitGateway.js`
- [ ] Cache hit path still works: a second request for a cached past date returns from `CacheStore.getSnapshot` without calling the gateway
- [ ] Background warm-up on server start completes without errors (check server log)
- [ ] No regression: `/api/activity-history` still returns data (still uses raw SQLite — unchanged until #3)

**Traceability:**
- Plan section: `GoogleFitGateway module interface`
- Source files: `server.js:482-520`, `server.js:522-543`, `server.js:545-572`, `server.js:611-767`, `server.js:800-870`

---

### #3 — Extract activity-history orchestration into MetricHistory

**Slice summary:** An engineer can demo that `/api/activity-history` is ~15 lines and
delegates entirely to `MetricHistory.getRange(type, date, range, token, refreshToken)`,
which handles cache-read → missing-date-fetch → upsert → rate-limit-fallback internally.

**Depends on:** #1, #2

**Labels:** `refactor`, `backend`

**Complexity:** M (4–8h)

**Layers touched:**
- [x] Server fetch / external API call
- [x] DB / schema (daily_summary and intraday reads/writes move into module)
- [x] HTTP route / response payload (route simplified, response unchanged)

**What to build:**

1. Create `lib/metricHistory.js` exposing `getRange(type, date, range, token, refreshToken)`.
   Move the entire body of `/api/activity-history` (`server.js:180-439`) into this method:
   - Token refresh via `getValidToken` (or accept a pre-refreshed token — see ⚠️ below)
   - Day-view steps path: `CacheStore.getIntraday(date)` → cache miss → `GoogleFitGateway.fetchIntraday()` → `CacheStore.setIntraday()`
   - Day-view heart path: `CacheStore.getSnapshot(date)` → extract intraday HR array from snapshot
   - Week/month path: `CacheStore.getDailySummary(dates, column)` → identify missing → `GoogleFitGateway.fetchAggregate()` → `CacheStore.setDailySummary()`
   - Rate-limit fallback (429 from gateway): return cached values even if incomplete
   - Implement `GoogleFitGateway.fetchAggregate` and `GoogleFitGateway.fetchIntraday` (stubs from #2) with real logic here

2. Update `/api/activity-history` route (`server.js:166-440`):
   - Keep only: auth header check, `getValidToken` call, `MetricHistory.getRange(...)`, `res.json(result)`
   - Delete all 270+ lines of inline logic

3. `getDatesInRange` helper (`server.js:160` area) and `dayStart`/`dayEnd`/`toRFC3339`
   (`server.js:161-163`) may be needed by both `metricHistory.js` and `googleFitGateway.js` —
   move them into a small shared `lib/dateHelpers.js` (3–4 functions, no grilling needed).

⚠️ **Open question:** `getValidToken` is currently defined in `server.js` and uses the
`oauth2Client` instance from the same file. `MetricHistory` will need to call it or receive
a pre-refreshed token. Simplest: pass a pre-refreshed `accessToken` into `getRange`
(caller refreshes before calling); `refreshToken` param is kept only for the rate-limit
fallback log message.

**What NOT to build (out of scope for this slice):**
- Do not change the JSON response shape of `/api/activity-history`
- Do not add new metric types or ranges
- Do not add retry logic beyond what the current route already has

**Acceptance criteria:**
- [ ] All four chart types (steps, heart, sleep, weight) × all three ranges (day, week, month) return data matching the current response — verify with browser network tab
- [ ] `wc -l server.js` is meaningfully shorter (route handler should be ~15 lines)
- [ ] Clicking a bar in the steps week-view chart still navigates to that date (no regression on `onDateSelect`)
- [ ] Rate-limit scenario: mock a 429 from Google Fit → chart renders with cached values, no 500 error
- [ ] Day-view heart rate chart renders the intraday area curve (the path through `CacheStore.getSnapshot` → extract intraday)
- [ ] No regression: `/api/health-data` still works (untouched in this slice)

**Traceability:**
- Plan section: `MetricHistory module interface`
- Source files: `server.js:166-440`

---

### #4 — Extract shared `formatDate` utility to eliminate frontend duplication

**Slice summary:** An engineer can demo that `formatDate` is defined once in
`fitbit-dashboard/src/utils/formatDate.js` and imported by both `App.jsx` and
`ActivityChart.jsx`, with the inline month-view date format also unified.

**Depends on:** none

**Labels:** `refactor`, `frontend`

**Complexity:** S (< 4h)

**Layers touched:**
- [x] Frontend component / state

**What to build:**

1. Create `fitbit-dashboard/src/utils/formatDate.js` exporting two functions:
   ```js
   export const formatDate = (dateStr) =>
     new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

   export const formatShortDate = (dateStr) =>
     new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
   ```

2. In `App.jsx`:
   - Delete inline `formatDate` at `App.jsx:42-45`
   - Add `import { formatDate } from '../utils/formatDate'` (adjust path as needed)

3. In `ActivityChart.jsx`:
   - Delete inline `formatDate` at `ActivityChart.jsx:37-38`
   - Replace the inline `new Date(...).toLocaleDateString(...)` at `ActivityChart.jsx:149` with `formatShortDate(payload.value)`
   - Add `import { formatDate, formatShortDate } from '../utils/formatDate'`

**What NOT to build (out of scope for this slice):**
- Do not change the display format itself — output must be character-for-character identical
- Do not add any other utilities to the file

**Acceptance criteria:**
- [ ] `grep -rn "toLocaleDateString" fitbit-dashboard/src/` returns matches only in `utils/formatDate.js` — zero in `App.jsx` or `ActivityChart.jsx`
- [ ] Date labels in all chart axes render identically to before (spot-check week view: "17 May 2026")
- [ ] Header date display in `App.jsx` renders identically to before
- [ ] Month-view x-axis labels show short format ("17 May") as before

**Traceability:**
- Plan section: `Shared date utility`
- Source files: `App.jsx:42-45`, `ActivityChart.jsx:37-38`, `ActivityChart.jsx:149`

---

## Dependency table

| # | Title | Depends on | Complexity | Labels |
|---|-------|------------|------------|--------|
| 1 | CacheStore — cache reads/writes/guards | none | M | refactor, backend, cache |
| 2 | GoogleFitGateway — Google Fit API knowledge | #1 | M | refactor, backend |
| 3 | MetricHistory — activity-history orchestration | #1, #2 | M | refactor, backend |
| 4 | Shared `formatDate` utility | none | S | refactor, frontend |

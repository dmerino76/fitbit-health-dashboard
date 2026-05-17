# Plan: Extract `useMetricHistory` hook from `ActivityChart`

## Context

During an architecture review (`/improve-codebase-architecture`), candidate 4 was
selected: the `ActivityChart` component owns both data-fetching and chart rendering,
which makes fetch behaviour impossible to test in isolation.

## Decisions (locked)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Who owns `range`? | Component (Option A) | Range is UI state; hook is a pure fetcher |
| Refresh token | Parameter (Option A2) | Makes hook a pure function of its inputs; testable with `renderHook` |
| Error state | Surfaced as `Error \| null` | Allows component to distinguish fetch failure from genuinely empty data |
| Race condition guard | `cancelled` flag on cleanup | Prevents stale state updates when date changes mid-flight |

## Interface

```js
// src/hooks/useMetricHistory.js
useMetricHistory(token, refreshToken, date, metricType, range)
→ { data, loading, error }
```

- `data`: `[{label: string, date: string, value: number}]`, defaults to `[]`
- `loading`: `boolean`
- `error`: `Error | null`, resets to `null` on each new fetch

## Files affected

| File | Change |
|------|--------|
| `fitbit-dashboard/src/hooks/useMetricHistory.js` | Create — hook implementation |
| `fitbit-dashboard/src/components/ActivityChart.jsx` | Update — remove inline fetch, use hook, show error state |

## Source references

- Current fetch logic: `ActivityChart.jsx:14-35`
- Local state being replaced: `ActivityChart.jsx:10-12`
- Empty-state UI to update: `ActivityChart.jsx:183-188`

---

## Issues

### #1 — Extract metric-history fetch into `useMetricHistory` hook

**Slice summary:** An engineer can delete `fetchHistory` from `ActivityChart.jsx`, replace it with `useMetricHistory(...)`, and demo all four charts fetching correctly — with "Failed to load" shown on network error instead of a silent empty state.

**Depends on:** none

**Labels:** `refactor`, `frontend`

**Complexity:** S (< 4h)

**Layers touched:**
- [x] Frontend component / state

**What to build:**

1. Create `fitbit-dashboard/src/hooks/useMetricHistory.js`:
   - Accept `(token, refreshToken, date, metricType, range)`
   - Guard with `if (!token) return` before fetching
   - Reset `error` to `null` and set `loading = true` at the top of each fetch
   - Call `GET http://localhost:3000/api/activity-history` with `{ date, range, type: metricType, refresh: refreshToken }` params and `Authorization: Bearer ${token}` header
   - On success: `setData(response.data)`, `setError(null)`
   - On failure: `setError(err)`, `setData([])`
   - Set `loading = false` in `finally`
   - Return cleanup function that sets a `cancelled` flag; skip all state updates if `cancelled` is true
   - Return `{ data, loading, error }`

2. Update `fitbit-dashboard/src/components/ActivityChart.jsx`:
   - Remove `useState` for `data` and `loading` (`ActivityChart.jsx:11-12`)
   - Remove `fetchHistory` function (`ActivityChart.jsx:20-35`)
   - Remove `useEffect` that calls `fetchHistory` (`ActivityChart.jsx:14-18`)
   - Import and call `useMetricHistory(token, localStorage.getItem('fitbit_refresh_token'), date, metricType, range)`
   - In the empty-state branch (`ActivityChart.jsx:183-188`): add an `error` branch above the existing "No data available" — show "Failed to load" with the error message when `error` is non-null

**What NOT to build (out of scope for this slice):**
- No changes to the backend (`server.js`)
- No changes to `App.jsx`
- No changes to the `range` state — it stays as local `useState` in `ActivityChart`
- No unit tests or test harness setup (the hook is now _testable_, but writing tests is a separate issue)
- No retry logic on failure
- The `formatDate` duplication between `App.jsx` and `ActivityChart.jsx` is a separate concern — do not consolidate here

**Acceptance criteria:**
- [ ] All four charts (steps, heart rate, sleep, weight) render data on page load with no console errors
- [ ] Changing the date in the header re-fetches all four charts and renders the new data
- [ ] Toggling day/week/month on any chart re-fetches and re-renders correctly
- [ ] Clicking a bar or x-axis label to navigate dates still works (no regression on `onDateSelect`)
- [ ] With the network tab open, killing the dev server mid-request and reloading shows "Failed to load" — not "No data available" — in the affected chart
- [ ] Switching dates rapidly (fast-clicking the slider) does not produce a stale data flash — the last-selected date wins
- [ ] Dark/light mode toggle produces no regression in chart styling

**Traceability:**
- Plan section: `Extract useMetricHistory hook from ActivityChart`
- Source files: `ActivityChart.jsx:10-35`, `ActivityChart.jsx:183-188`

---

## Dependency table

| # | Title | Depends on | Complexity | Labels |
|---|-------|------------|------------|--------|
| 1 | Extract `useMetricHistory` hook | none | S | refactor, frontend |

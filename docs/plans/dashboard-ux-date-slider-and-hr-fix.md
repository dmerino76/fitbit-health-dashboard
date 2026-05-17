# Dashboard UX — Date Slider, Click-to-Date, Year Format & HR Cache Fix

## Scope

Four coordinated changes to the Fitbit dashboard:

1. **Fix Heart Rate cache poisoning** for recent dates (server-side bug)
2. **Date slider** — inline in header, 30-day window, draggable thumb
3. **Click-to-date navigation** — clicking any chart bar, x-axis label, or metric card jumps to that date
4. **Year in all date labels** — `DD MMM YYYY` format everywhere

---

## 1. Heart Rate Cache Poisoning Fix (`server.js`)

**Problem:** Recent dates (last ~3 days) show empty Heart Rate in the dashboard. The cause is the same as the sleep cache bug fixed in commits #6/#7: the cache warm-up or on-demand fetch ran before Google Fit had synced HR data, storing empty `heartRate` in `health_data_cache`.

**Fix:**

### 1a. Startup purge (alongside the existing sleep purge)
Add a `DELETE` after line 51 in `server.js` (inside `db.serialize`):

```js
// Purge entries poisoned with missing heart rate data
db.run(`DELETE FROM health_data_cache
        WHERE CAST(json_extract(data, '$.heartRate[0].value.avgBpm') AS REAL) = 0
           OR json_extract(data, '$.heartRate[0].value.avgBpm') IS NULL`);
```

### 1b. Cache-write guard (line 583)
Extend the existing guard to also require heart rate data before caching:

```js
// Before (line 583):
if (!isToday && (result.sleepSummary?.totalMinutesAsleep ?? 0) > 0) {

// After:
if (
  !isToday &&
  (result.sleepSummary?.totalMinutesAsleep ?? 0) > 0 &&
  (result.heartRate?.[0]?.value?.avgBpm ?? 0) > 0
) {
```

### 1c. Historical cache warm-up guard (line 905)
Same guard applies in `cacheHistoricalData()` — add the same HR condition alongside the existing sleep condition.

---

## 2. Date Slider (`App.jsx`)

### Placement
Inline in the header bar, stretching between the logo (left) and the theme toggle/logout group (right). The existing native `<input type="date">` stays for precise entry and moves to sit just left of the slider track.

### Range
30 days ending today. Day 0 = 30 days ago, day 29 = today.

```js
const SLIDER_DAYS = 30;

// Derive slider index from date string
const dateToIndex = (dateStr) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr);
  const diff = Math.round((today - d) / 86400000);
  return Math.max(0, Math.min(SLIDER_DAYS - 1, SLIDER_DAYS - 1 - diff));
};

// Derive date string from slider index
const indexToDate = (idx) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (SLIDER_DAYS - 1 - idx));
  return d.toISOString().split('T')[0];
};
```

### Interaction
- Dragging the thumb: updates `date` state live → date input reflects immediately + tooltip floats above thumb
- Tooltip: absolutely positioned above thumb, shows `DD MMM YYYY` format
- Thumb animation: CSS `transition: left 0.25s ease` so when `date` changes from click-to-date navigation, the thumb slides to the new position

### State additions in `App.jsx`
```js
const [sliderTooltip, setSliderTooltip] = useState(null); // {visible, label}
```

No new date state needed — derives from existing `date`.

### JSX structure (header section)
```jsx
<header>
  <div class="logo">…</div>

  {/* Date controls — inline, flex-1 */}
  <div class="flex items-center gap-3 flex-1 mx-6">
    <input type="date" value={date} onChange={…} />   {/* existing */}
    <div class="relative flex-1">                      {/* slider track */}
      {sliderTooltip?.visible && (
        <div class="absolute -top-8 … tooltip">{sliderTooltip.label}</div>
      )}
      <input
        type="range"
        min={0} max={SLIDER_DAYS - 1}
        value={dateToIndex(date)}
        onChange={(e) => setDate(indexToDate(Number(e.target.value)))}
        onMouseMove={(e) => setSliderTooltip({ visible: true, label: formatDate(indexToDate(…)) })}
        onMouseLeave={() => setSliderTooltip({ visible: false, label: '' })}
        style={{ transition: 'none' }}   /* thumb position via value, CSS handles track */
      />
    </div>
  </div>

  <div class="controls">theme toggle / logout</div>
</header>
```

---

## 3. Click-to-Date Navigation

### `ActivityChart.jsx` changes
Add `onDateSelect` prop. Wire it to bar clicks and x-axis tick clicks.

```jsx
const ActivityChart = ({ …, onDateSelect }) => {
```

Each data point already has a `date` field (from the server's `dateList`). Confirm the server returns `date: 'YYYY-MM-DD'` alongside `label` in the activity-history response — check `server.js` lines ~290–410. If not, add it there.

```jsx
<Bar
  dataKey="value"
  fill={theme.stroke}
  radius={[4, 4, 0, 0]}
  onClick={(barData) => onDateSelect?.(barData.date)}
  style={{ cursor: onDateSelect ? 'pointer' : 'default' }}
/>
```

For x-axis tick clicks, use Recharts' `<XAxis onClick>`:
```jsx
<XAxis
  dataKey="label"
  onClick={(tickData) => onDateSelect?.(tickData.date)}
  tick={{ cursor: 'pointer' }}
/>
```

### `App.jsx` changes
Pass `onDateSelect` to all four `<ActivityChart>` instances:

```jsx
<ActivityChart … onDateSelect={setDate} />
```

Setting `date` triggers the existing `useEffect` → fetches new day's data + slider thumb animates to new position.

### Daily Goals metric cards
Each card shows the current day's metric. Add a subtle `cursor-pointer` and `onClick={() => {/* already selected date, no-op in day view */}}` — the interaction becomes meaningful if a future multi-day goals view is added. For now, clicking a Goals card in day view keeps the date the same (no visible change) but the affordance is in place.

---

## 4. Date Format: `DD MMM YYYY` Everywhere

### Helper function (add to `App.jsx` and `ActivityChart.jsx`)
```js
const formatDate = (dateStr) => {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  // → "16 May 2026"
};
```

### Where to apply

| Location | Current | After |
|---|---|---|
| Header date input (displayed value) | `YYYY-MM-DD` (native) | Native input keeps YYYY-MM-DD internally; add a text label alongside showing `DD MMM YYYY` |
| Slider tooltip | — (new) | `DD MMM YYYY` |
| Chart x-axis week view | `MM-DD` (`.slice(5)`) | `DD MMM YYYY` — rotate labels 30° to fit, reduce font to 10px |
| Chart x-axis month view | `DD` (`.slice(8)`) | `DD MMM` (drop year for month view to avoid clutter; 30 labels is tight) |
| Chart tooltip | current label | `DD MMM YYYY` |
| ActivityChart `server.js` label field | `d.slice(5)` / `d.slice(8)` | replace with full `YYYY-MM-DD` as `date` field; format in the component |

**Server-side label change** (`server.js` ~line 302/355/378/405):
```js
// Before:
label: d.slice(range === 'week' ? 5 : 8)

// After — keep date as YYYY-MM-DD, format in frontend:
label: d,   // full date string; component calls formatDate(label)
date: d,    // also expose for click-to-date
```

---

## File Checklist

| File | Changes |
|---|---|
| `server.js` | HR cache purge (startup), HR cache-write guard, historical cache guard, `label`/`date` in activity-history response |
| `fitbit-dashboard/src/App.jsx` | `dateToIndex`/`indexToDate`/`formatDate` helpers, slider JSX + tooltip state, pass `onDateSelect={setDate}` to charts |
| `fitbit-dashboard/src/components/ActivityChart.jsx` | `onDateSelect` prop, `onClick` on `<Bar>` and `<XAxis>`, `formatDate` helper, rotate x-axis labels |

---

## Implementation Order

1. `server.js` — HR cache fix (purge + guards + label fields)  ← unblocks real data
2. `ActivityChart.jsx` — `onDateSelect` + date format
3. `App.jsx` — slider + tooltip + wire `onDateSelect`

---

## Issues

### #1 — Heart Rate shows real data for recent dates (fix cache poisoning)

**Slice summary:** Server startup purges HR-empty cache rows and guards both write paths so recent dates load real heart rate data in the dashboard.

**Depends on:** none

**Labels:** `fix` `backend` `cache`

**Complexity:** S (< 4h)

**Layers touched:**
- [x] DB / schema (DELETE poisoned rows on startup)
- [x] Server fetch / external API call (cache write guards)
- [ ] Data transform / shape
- [ ] HTTP route / response payload
- [ ] Frontend component / state

**What to build:**
- In `server.js` inside `db.serialize()`, after line 51 (the existing sleep purge), add:
  ```js
  db.run(`DELETE FROM health_data_cache
          WHERE CAST(json_extract(data, '$.heartRate[0].value.avgBpm') AS REAL) = 0
             OR json_extract(data, '$.heartRate[0].value.avgBpm') IS NULL`);
  ```
- At `server.js:583`, extend the on-demand cache-write guard to also require `avgBpm > 0`:
  ```js
  if (
    !isToday &&
    (result.sleepSummary?.totalMinutesAsleep ?? 0) > 0 &&
    (result.heartRate?.[0]?.value?.avgBpm ?? 0) > 0
  ) {
  ```
- At `server.js:906`, extend the historical warm-up guard the same way (mirrors the on-demand guard).

**What NOT to build (out of scope for this slice):**
- No frontend changes — the Heart Zones card already renders correctly when `data.heartRate` is populated.
- No changes to the activity-history endpoint (that is issue #2).

**Acceptance criteria:**
- [ ] Restart the server → `server.log` shows the DELETE ran (no error). Select yesterday in the dashboard → Heart Zones card shows min/avg/max BPM values (not dashes).
- [ ] Edge case: select a date where Google Fit genuinely has no HR data → card shows dashes (unchanged behaviour — nothing cached, nothing shown).
- [ ] No regression: selecting any older cached date still loads instantly from cache.

**Traceability:**
- Plan section: `## 1. Heart Rate Cache Poisoning Fix`
- Source files: `server.js:47–51` (startup purge), `server.js:583` (on-demand guard), `server.js:906` (historical guard)

---

### #2 — Activity history API emits a `date` field on every data point

**Slice summary:** Every object returned by `/api/activity-history` gains a `date: 'YYYY-MM-DD'` field (and `label` becomes the raw date string), consumed immediately by the chart tooltip so no layer is left dangling.

**Depends on:** none

**Labels:** `fix` `backend` `frontend`

**Complexity:** S (< 4h)

**Layers touched:**
- [ ] DB / schema
- [ ] Server fetch / external API call
- [x] Data transform / shape
- [x] HTTP route / response payload
- [x] Frontend component / state (tooltip consumes `date`)

**What to build:**
- In `server.js`, change all four `result.push` / `dateList.map` calls that build activity-history objects. Replace `label: d.slice(...)` with the raw date string and add `date: d`:

  | Line | Before | After |
  |------|--------|-------|
  | 302 | `{ label: d.slice(range === 'week' ? 5 : 8), value: dbMap[d] \|\| 0 }` | `{ label: d, date: d, value: dbMap[d] \|\| 0 }` |
  | 355 | `{ label: d.slice(range === 'week' ? 5 : 8), value: val }` | `{ label: d, date: d, value: val }` |
  | 378 | `{ label: d.slice(range === 'week' ? 5 : 8), value: val }` | `{ label: d, date: d, value: val }` |
  | 405 | `{ label: d.slice(range === 'week' ? 5 : 8), value: val }` | `{ label: d, date: d, value: val }` |

- In `ActivityChart.jsx`, update `CustomTooltip` (line ~46) to display `label` through a `formatDate` helper instead of raw string. Add `formatDate` as a local helper:
  ```js
  const formatDate = (dateStr) =>
    new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  ```
  The tooltip `<p>` for the date label becomes `{formatDate(label)}` — this is the only consumer changed in this slice. X-axis label formatting is issue #3.

**What NOT to build (out of scope for this slice):**
- X-axis label reformatting / rotation (issue #3).
- Click-to-date wiring (issue #4).
- The slider (issue #5).

**Acceptance criteria:**
- [ ] `curl "http://localhost:3000/api/activity-history?date=2026-05-16&range=week&type=steps" -H "Authorization: Bearer $TOKEN" | jq '.[0]'` → object contains `"date": "YYYY-MM-DD"` and `"label": "YYYY-MM-DD"` fields.
- [ ] Hovering a bar in week view shows tooltip with date formatted as e.g. `"16 May 2026"` (not the raw `YYYY-MM-DD` string).
- [ ] No regression: day / week / month ranges all return correct number of data points.

**Traceability:**
- Plan section: `## 4. Date Format — Server-side label change`
- Source files: `server.js:302`, `server.js:355`, `server.js:378`, `server.js:405`; `fitbit-dashboard/src/components/ActivityChart.jsx:46–55`

---

### #3 — Chart x-axis labels display dates in `DD MMM YYYY` format

**Slice summary:** The x-axis tick labels in all Performance Trends charts reformat from raw `YYYY-MM-DD` strings to `DD MMM YYYY` (week view, rotated 30°) and `DD MMM` (month view), using the `date` field available after #2.

**Depends on:** #2

**Labels:** `feature` `frontend`

**Complexity:** S (< 4h)

**Layers touched:**
- [ ] DB / schema
- [ ] Server fetch / external API call
- [ ] Data transform / shape
- [ ] HTTP route / response payload
- [x] Frontend component / state

**What to build:**
- In `ActivityChart.jsx`, update the `<XAxis>` in the BarChart branch (line ~137) to use a custom tick renderer that calls `formatDate` (already added in #2). For week view use full `DD MMM YYYY`; for month view use `DD MMM` (drop year to avoid clutter across 30 labels):
  ```jsx
  tick={({ x, y, payload }) => {
    const label = range === 'month'
      ? new Date(payload.value + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
      : formatDate(payload.value);
    return (
      <g transform={`translate(${x},${y})`}>
        <text
          x={0} y={0} dy={16}
          textAnchor="end"
          fill="#9ca3af"
          fontSize={10}
          transform={range === 'week' ? 'rotate(-30)' : undefined}
        >
          {label}
        </text>
      </g>
    );
  }}
  ```
- Increase `<XAxis height>` to 40 in week view to give rotated labels room.

**What NOT to build (out of scope for this slice):**
- Click handlers on x-axis or bars (issue #4).
- The slider (issue #5).
- Day-view AreaChart x-axis (already hidden, leave it).

**Acceptance criteria:**
- [ ] Switch any Performance Trends chart to week view → x-axis labels show e.g. `"16 May 2026"`, rotated ~30°, no overlap with bars.
- [ ] Switch to month view → labels show e.g. `"16 May"` (no year), readable at 10px.
- [ ] Day view → x-axis still hidden (no regression).
- [ ] No regression: chart data values are unchanged.

**Traceability:**
- Plan section: `## 4. Date Format: DD MMM YYYY Everywhere — Where to apply`
- Source files: `fitbit-dashboard/src/components/ActivityChart.jsx:134–156`

---

### #4 — Clicking a chart bar or x-axis label navigates to that date

**Slice summary:** Clicking any bar or x-axis tick in a Performance Trends chart (week/month view) sets the dashboard date to that day and updates all three controls (date input, slider thumb, charts) in sync.

**Depends on:** #2

**Labels:** `feature` `frontend`

**Complexity:** M (4–8h)

**Layers touched:**
- [ ] DB / schema
- [ ] Server fetch / external API call
- [ ] Data transform / shape
- [ ] HTTP route / response payload
- [x] Frontend component / state

**What to build:**
- In `ActivityChart.jsx`, add `onDateSelect` prop to the component signature (line ~9).
- On the `<Bar>` element (line ~151), add:
  ```jsx
  onClick={(barData) => onDateSelect?.(barData.date)}
  style={{ cursor: onDateSelect ? 'pointer' : 'default' }}
  ```
- On the `<XAxis>` in the BarChart branch (line ~137), replace the existing `tick` renderer (from #3) with one that wraps the `<text>` in an `onClick`:
  ```jsx
  onClick={(payload) => onDateSelect?.(payload.value)}
  ```
  ⚠️ Open question: Recharts `<XAxis onClick>` fires with `{ value }` where `value` is `dataKey` — confirm `dataKey="label"` returns the full `YYYY-MM-DD` string (it does after #2).
- In `App.jsx`, pass `onDateSelect={setDate}` to all four `<ActivityChart>` instances (lines ~196–199). Setting `date` triggers the existing `useEffect` → re-fetches health data. Slider thumb will animate automatically once #5 is merged, since its position derives from `date`.

**What NOT to build (out of scope for this slice):**
- Daily Goals metric card click affordance (deferred — no multi-day goals view exists yet).
- The slider itself (issue #5).

**Acceptance criteria:**
- [ ] In week view, click a Steps bar for a date other than today → header date input changes, dashboard reloads for that date, spinner shows during fetch.
- [ ] Click an x-axis label → same navigation behaviour as clicking the bar above it.
- [ ] Day view and month view charts: clicking a bar also navigates.
- [ ] No regression: range toggle buttons (day/week/month) still work; hover tooltips still show.

**Traceability:**
- Plan section: `## 3. Click-to-Date Navigation`
- Source files: `fitbit-dashboard/src/components/ActivityChart.jsx:9,151,137`; `fitbit-dashboard/src/App.jsx:196–199`

---

### #5 — Date slider in header navigates within the 30-day window

**Slice summary:** A draggable range slider stretches inline in the header between the logo and the theme toggle; dragging it updates the date input live and shows a floating `DD MMM YYYY` tooltip above the thumb; when date changes from any source (input, chart click), the thumb slides to the new position.

**Depends on:** none

**Labels:** `feature` `frontend`

**Complexity:** M (4–8h)

**Layers touched:**
- [ ] DB / schema
- [ ] Server fetch / external API call
- [ ] Data transform / shape
- [ ] HTTP route / response payload
- [x] Frontend component / state

**What to build:**
- In `App.jsx`, add helpers above the JSX return (after existing state declarations, ~line 23):
  ```js
  const SLIDER_DAYS = 30;
  const dateToIndex = (dateStr) => {
    const today = new Date(); today.setHours(0,0,0,0);
    const diff = Math.round((today - new Date(dateStr)) / 86400000);
    return Math.max(0, Math.min(SLIDER_DAYS - 1, SLIDER_DAYS - 1 - diff));
  };
  const indexToDate = (idx) => {
    const d = new Date(); d.setHours(0,0,0,0);
    d.setDate(d.getDate() - (SLIDER_DAYS - 1 - idx));
    return d.toISOString().split('T')[0];
  };
  const formatDate = (dateStr) =>
    new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  ```
- Add `sliderTooltip` state (~line 23):
  ```js
  const [sliderTooltip, setSliderTooltip] = useState({ visible: false, label: '' });
  ```
- In the header JSX (lines ~108–142), restructure so the date input and slider share a `flex-1` centre zone:
  ```jsx
  {/* centre zone */}
  <div className="flex items-center gap-3 flex-1 mx-6">
    <input type="date" value={date} onChange={(e) => setDate(e.target.value)} … />
    <div className="relative flex-1">
      {sliderTooltip.visible && (
        <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded pointer-events-none whitespace-nowrap">
          {sliderTooltip.label}
        </div>
      )}
      <input
        type="range" min={0} max={SLIDER_DAYS - 1}
        value={dateToIndex(date)}
        onChange={(e) => setDate(indexToDate(Number(e.target.value)))}
        onMouseMove={(e) => {
          const idx = Number(e.target.value);
          setSliderTooltip({ visible: true, label: formatDate(indexToDate(idx)) });
        }}
        onMouseLeave={() => setSliderTooltip({ visible: false, label: '' })}
        className="w-full accent-blue-500"
      />
    </div>
  </div>
  ```
- Thumb animation on external date change: because `value={dateToIndex(date)}` is controlled, the browser moves the thumb whenever `date` state changes (from chart click in #4 or date input). Add `style={{ transition: 'left 0.25s ease' }}` via a CSS class on the slider track if the browser allows; otherwise CSS `::-webkit-slider-thumb { transition: left 0.25s ease; }` in `index.css`.
- Remove or reposition the existing standalone `<input type="date">` that currently sits in the header (line ~119–126) — it moves into the centre zone above.

**What NOT to build (out of scope for this slice):**
- Click-to-date in charts (issue #4); the slider will sync automatically once #4 is merged since both write to `date`.
- Any server-side changes.

**Acceptance criteria:**
- [ ] Drag slider left → date input updates live, tooltip floats above thumb showing e.g. `"10 May 2026"`.
- [ ] Release slider on a new date → dashboard reloads for that date (spinner visible).
- [ ] Selecting a date via the native date input → slider thumb moves to the correct position.
- [ ] After merging #4: clicking a chart bar → slider thumb slides to the clicked date's position.
- [ ] Slider min = 30 days ago from today, max = today. Dragging past either end is blocked.
- [ ] No regression: theme toggle and logout button still visible and functional in the header.

**Traceability:**
- Plan section: `## 2. Date Slider`
- Source files: `fitbit-dashboard/src/App.jsx:18–23` (state), `fitbit-dashboard/src/App.jsx:108–142` (header JSX), `fitbit-dashboard/src/index.css` (thumb transition)

---

## Dependency Summary

| # | Title (short) | Depends on | Complexity | Labels |
|---|---------------|------------|------------|--------|
| 1 | HR cache fix — purge + write guards | none | S | fix, backend, cache |
| 2 | Activity history API adds `date` field | none | S | fix, backend, frontend |
| 3 | Chart x-axis labels in DD MMM YYYY | #2 | S | feature, frontend |
| 4 | Click chart bar/label to navigate to date | #2 | M | feature, frontend |
| 5 | Date slider in header (30-day window) | none | M | feature, frontend |

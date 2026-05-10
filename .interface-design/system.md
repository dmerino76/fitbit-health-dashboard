# Health Dashboard Design System

## Direction & Intent
**Product:** Health dashboard showing personal vitals and patterns  
**User:** Someone checking their daily health rhythm — do I fit my pattern?  
**Feel:** Calm observation, not alarm. Quiet structure where data emerges.

**Signature:** Rhythm indicator bars — every metric shows current vs. baseline as a filled bar that extends past baseline when you exceed it. Health is rhythm; the interface visualizes deviation from your established pattern.

---

## Color Palette

**Functional Colors:**
- `--pulse`: #0ea5e9 (cyan-500) — Primary data, vital signs, active metrics
- `--baseline`: #6b7280 (gray-500) — Reference lines, secondary data
- `--signal`: #10b981 (emerald-500) — Healthy, within zone, positive
- `--caution`: #f59e0b (amber-500) — At threshold, needs attention

**Surface Palette (Dark Mode):**
- `--bg-base`: #050505 — Page background
- `--bg-surface`: #111827 — Card background (gray-900)
- `--bg-surface-elevated`: #1f2937 — Overlays, dropdowns (gray-800)
- `--bg-inset`: #0f172a — Form inputs, inset elements (slate-900)
- `--border-subtle`: rgba(255,255,255,0.05) — Standard separation
- `--border-emphasis`: rgba(255,255,255,0.1) — Stronger division

**Text Hierarchy:**
- `--text-primary`: #f8fafc — Body text, default
- `--text-secondary`: #cbd5e1 — Supporting text, emphasis
- `--text-tertiary`: #94a3b8 — Metadata, less important
- `--text-muted`: #64748b — Disabled, placeholder, very low priority

---

## Spacing Scale

Base unit: 4px (Tailwind default)

- **Micro:** 4px (gap-1)
- **Compact:** 12px (gap-3)
- **Component:** 24px (gap-6, p-6)
- **Section:** 48px (gap-12, mb-12)
- **Major:** 96px (mb-24)

All card padding: p-6 (24px)  
All card gaps: gap-6 (24px) between sub-sections

---

## Depth Strategy

**Borders only. No shadows.**

- Standard card: border-subtle on all sides
- Section dividers: border-t border-subtle with mb-12
- Emphasis elements: border-emphasis
- Focus rings: border-2 border-pulse (blue glow, no shadow)

Why: Technical feel, clean, intentional. Lets data speak.

---

## Typography

**Font Stack:** System stack (font-sans)

**Scale:**
- **Display:** 28px, font-bold, tracking-tight — Main title "Health Sphere"
- **Headline 2:** 20px, font-bold, tracking-tight — Section titles
- **Headline 3:** 16px, font-bold, tracking-tight — Subsection titles
- **Body:** 14px, font-normal (400), leading-relaxed — Descriptions, supporting text
- **Label:** 12px, font-medium (500), uppercase, tracking-wider — Form labels, metric names
- **Caption:** 11px, font-normal, text-tertiary — Timestamps, metadata
- **Data:** 18px, font-bold, font-mono (tabular numbers) — Metric values

Why: Regular weight (400) for body makes reading comfortable. Bold (700) for data draws attention without shouting. Medium (500) for labels is readable at small sizes. No all-caps body text.

---

## Components

### Metric Card (Goal cards)
**Structure:**
```
[Icon] [Title / Value]
[Rhythm bar — shows current vs. typical]
[Legend: Current / Typical]
```

**Spacing:**
- p-6, border-subtle
- Icon + text: flex gap-4
- Rhythm bar: mt-4, mb-2
- Legend: text-caption

**Rhythm Bar:**
- Height: h-1.5
- Background: bg-inset
- Fill: `width: (current / typical) * 100%`
- Color: signal green if ≥ typical, pulse blue if < typical
- No shadow, no glow

### Section Header
**Structure:**
```
[Icon] [Title]
[Light separator line below]
```

**Spacing:**
- Icon + text: flex gap-2
- Icon: small bg-pulse/10, rounded-md, p-1.5
- Text: text-headline-2
- Separator: border-t border-subtle, mb-12, mt-6

### Activity Chart
**Structure:**
```
[Title / Range tabs]
[Recharts AreaChart or BarChart]
[No tooltip overlay — use on-hover]
```

**Changes:**
- Remove backdrop-blur
- Add border-subtle on card
- Chart padding: p-6
- Tabs: No active background, just text color change (text-pulse when active)

### Heart Zones List
**Structure:**
```
[Zone name — baseline level]
[Rhythm bar for this zone]
[Zone range in bpm — text-caption]
```

Repeat 3-4 times (zones ordered low→high).

**Why reorder:** `.reverse()` removes — zones naturally ascend (resting → moderate → vigorous). Let hierarchy emerge.

### Sleep Architecture
**Structure:**
```
[Total sleep — hero display]
[4 stage boxes: Deep / Light / REM / Awake]
```

**Stage box:**
- Dot + label (text-label)
- Value (text-data)
- No background color, just a border-subtle box

### Macro Lines
**Structure:**
```
[Protein — 45g / 150g typical]
[Rhythm bar shows current vs. typical]
```

No hover reveal — show both current and typical always (removes cognitive load).

---

## States & Interactions

**Card Hover:**
- `border-subtle` → `border-emphasis` (very subtle, not flashy)

**Button / Interactive:**
- Default: border-subtle
- Hover: border-emphasis
- Active: border-pulse (blue)
- Focus: border-2 border-pulse (glow effect)
- Disabled: opacity-50

**Data Loading:**
- Spinner: small, centered, text-pulse
- No overlay — just show spinner in place of data

---

## What Changed

1. **Typography:** Regular weight body, removed all-caps labels (→ sentence case)
2. **Depth:** Borders only, removed all shadows and blur
3. **Spacing:** 4-level grid (4, 12, 24, 48px) — all values mapped to grid
4. **Colors:** 2 primary (pulse, baseline) + 2 semantic (signal, caution) — removed emerald, violet, rose
5. **Signature:** Rhythm bars show current vs. baseline — makes deviation visible
6. **Components:** Consistent card structure, border treatment, spacing rhythm
7. **Data viz:** Recharts kept, but cleaner styling (no glow, no blur)

---

## Token Names (Reflect Product World)

- `--pulse` (not `--cyan-500`) — Heart rate, vital rhythm
- `--signal` (not `--emerald`) — Health signal
- `--caution` (not `--amber`) — Warning signal
- `--baseline` (not `--gray`) — Your typical pattern
- `--bg-inset` (not `--bg-input`) — Where data enters

Someone reading tokens alone should sense "this is a health app."

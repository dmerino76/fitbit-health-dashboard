# Extracted Design Patterns - Fitbit Health Dashboard

## Current Design System Analysis

### Color Palette (Actual Usage)

**Primary Accents:**
- Cyan: #06b6d4 (primary metric highlight, strokes)
- Blue: #3b82f6 (secondary accent, distance metric)
- Rose: #f43f5e (heart rate, critical metrics)
- Violet: #8b5cf6 (sleep data)
- Amber: #f59e0b (active zones, warnings)
- Emerald: #10b981 (nutrition/positive)

**Backgrounds:**
- Page: #050505 (near-black)
- Card: gray-900/30 (very dark with transparency)
- Darker Control: black/40 (for inputs, selects)
- Overlay: white/5 to white/10 (subtle separation)

**Text:**
- Primary: white, #f8fafc
- Secondary: gray-400 to gray-600
- Muted: gray-700 to gray-800
- On Accents: white

**Borders:**
- Standard: border-white/5 (very subtle)
- Emphasis: border-white/10 (slightly stronger)
- Focus: border-colored (cyan, rose, etc.)

### Spacing Scale

**Observed Gaps:**
- Micro: gap-2 (8px), gap-3 (12px)
- Component: gap-4 (16px), gap-6 (24px)
- Section: gap-8 (32px)
- Major: mb-8 (32px), mb-10 (40px), mb-16 (64px)

**Padding:**
- Cards: p-8 (32px) consistently
- Controls: py-2.5 px-5 (10px/20px)
- Containers: p-6, p-4
- **Issue:** No consistent internal rhythm within complex cards

### Typography

**Scale:**
- Hero: text-4xl (36px) - main title "HealthSphere"
- H2: text-3xl (30px) - page titles
- H3: text-xl to text-2xl (20-24px) - section headers
- Body: text-sm to text-lg (14-18px) - metrics, content
- Label: text-xs to text-[10px] (10-12px) - uppercase labels
- Caption: text-[8px] (8px) - smallest annotations

**Weight Hierarchy:**
- Headline: font-black (900) - uppercase
- Emphasis: font-bold (700) - metric values
- Normal: font-medium (500) - body text
- **Issue:** No font-weight: 400 (regular) — everything is weighted

**Style Patterns:**
- All labels UPPERCASE with tracking-wider/tracking-widest
- All headlines use font-black with aggressive tracking
- Numbers use font-black for emphasis
- No true regular-weight text for comfort reading

### Depth Strategy

**Current Approach: Mixed**
1. Borders: white/5 and white/10 for structure
2. Shadows: shadow-2xl, shadow-lg, shadow-xl (used sparingly)
3. Glassmorphism: backdrop-blur-md / backdrop-blur-3xl
4. Gradient Accents: Background gradients for emphasis

**Surface Elevation (Implicit):**
- Base: #050505
- Level 1 (Cards): gray-900/30 + white/5 border
- Level 2 (Overlays): black/40 + white/5 border
- Accents: Color-specific backgrounds with low opacity

**Issues Identified:**
- No explicit elevation scale
- Mixed depth strategies (borders + shadows + blur + gradients)
- Shadows sometimes compete with blur effects
- Elevation differences are subtle to the point of unclear

### Border & Radius Strategy

**Radius Values (Inconsistent):**
- Large containers: rounded-[2.5rem] (40px)
- Cards: rounded-[2.5rem] (40px)
- Controls: rounded-2xl (24px), rounded-lg (8px)
- Dots/icons: rounded-full

**Issues:**
- No systematic scale
- 2.5rem feels custom but looks arbitrary
- Small elements (buttons) vs large elements (cards) lack proportional consistency

### Component Patterns Extracted

**Goal Card (Steps, Distance, Active Zone, Calories):**
- Layout: Icon left + Title/Value right + Progress bar bottom
- Pattern: Flex column with mb-8 spacing
- Header: Icon in bg-white/5, title in text-[10px] uppercase, value in text-2xl font-black
- Progress: h-2 bar with color gradient, box-shadow glow
- Footer: "Current" and "Target" labels

**Activity Chart:**
- Container: rounded-2xl, bg-gray-900/50, border-gray-800
- Header: Icon + Title + Range tabs (day/week/month)
- Chart: h-[300px], AreaChart (day view) or BarChart (week/month)
- Tooltip: Custom dark gray with colored text
- No loading state — spinner appears inline

**Heart Zones Display:**
- Vertical stack of zones
- Each zone: Name (text-[9px]), Minutes (text-xl), Range (text-[10px])
- Progress bar: h-1.5 with color-specific gradient and shadow
- Reverse ordered (.slice().reverse())

**Sleep Architecture:**
- Total sleep hero: text-2xl with icon
- Grid of 4 StageBox components
- Each: Color dot, label, value
- Fallback: Info message if data missing

**Macro Lines (Protein, Carbs, Fats):**
- Horizontal bar with label left, value right
- Progress bar: h-1 with opacity transitions
- Metric: Shows current, reveals max on hover

**Device Cards:**
- Icon in bg-white/5 container
- Title + last sync time
- Battery status badge with color (emerald/amber)
- Pulse dot indicator

### Interaction Patterns

**Hover States:**
- Cards: group-hover:bg-gray-900/50
- Icons: group-hover:rotate-12, group-hover:scale-110
- Text: group-hover:text-white (from gray-500)
- Progress bars: opacity-100 on hover

**Focus/Active:**
- Date input: outline-none, cursor-pointer
- Range buttons: Active = bg-gray-700 text-white
- Disabled buttons: opacity implicitly reduced

**Loading:**
- Spinner: h-20 w-20 border-2 with border-t-cyan-500 animate-spin
- Pulse icon inside spinner
- Loading state in ActivityChart shows inline spinner

### Data Visualization

**Charts (Recharts):**
- AreaChart: Filled gradient for day view (15-minute granularity)
- BarChart: Bar fills for week/month view
- PieChart: Donut chart for daily intensity (4 segments)
- Legend: Dot + text pairs, not system legend

**Colors in Viz:**
- Intensity zones: slate-800, cyan-500, blue-500, violet-600
- Gradients: Linear gradients with 5% and 95% stop points
- Tooltip: Custom bg-gray-900 with colored text

### Issues & Inconsistencies Found

1. **Typography:** No regular font-weight — everything weighted. No comfortable reading-weight text.
2. **Spacing:** Inconsistent internal rhythm. Cards have p-8, but some sub-components have arbitrary spacing.
3. **Border Radius:** 2.5rem feels custom but lacks systematic scale.
4. **Elevation:** No clear hierarchy — cards, overlays, and modals don't have distinct levels.
5. **Depth Strategy:** Mixing borders + shadows + blur + gradients without clear rules.
6. **Color Semantics:** Many colors used (6+ accent colors) without clear meaning hierarchy.
7. **Components:** One-off patterns (like `.slice().reverse()` in Heart Zones) instead of reusable components.
8. **States:** Missing explicit disabled, error, and empty states.
9. **Navigation:** No breadcrumb or location indicator (you know data is for today, but no visual confirmation).
10. **Contrast:** Some text/background combos (text-gray-600 on dark backgrounds) may fail accessibility.

### Design Direction Assessment

**Current Feel:**
- **Intended:** Precision, sophistication, futuristic
- **Actual:** Trendy, generic dark-mode dashboard (could be any fintech/health app)
- **Why:** Colors are standard (cyan/blue accents), spacing is standard Tailwind, typography is aggressive (all uppercase, all bold)

**Signature Element:**
- Glassmorphism (backdrop-blur) is closest, but it's a trend, not unique to this product
- No distinctive pattern that screams "health tracking"

### Recommendations for System.md

**To Build Craft:**
1. Establish explicit elevation scale (3-4 levels, not ambiguous)
2. Choose ONE depth strategy (borders OR shadows, not both)
3. Create typography scale with regular weights (body copy at 400, not 700)
4. Build spacing grid (4px or 8px base, not arbitrary)
5. Reduce accent color count (2-3 primary, 1-2 semantic)
6. Add signature element (health-specific metaphor, not generic trend)
7. Document component structure (card anatomy, data patterns)
8. Add state coverage (loading, error, empty, disabled, focus)

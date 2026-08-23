# ODSP-AW Weekly Pulse — canonical format

`ODSP-AW-Pulse-TEMPLATE.html` is the **approved Ambal-format Pulse layout** (Ambal's "Scout"-style
design, adopted Aug 23, 2026, with Aug 9–15 data as the worked example). When asked to build
"next week's Pulse", clone this file and only swap the numbers/dates — **do not change the layout,
section order, colors, or wording scaffold.**

> Ground rules (inherit from ../README.md):
> 1. **Never fabricate a number.** Every value is source-derived. If a source is unreachable, keep the
>    prior value and flag it — do not invent.
> 2. Transcribe exactly from the source the owner points to; don't silently "correct" to finer values.
> 3. Never use the words **"strong" / "weak"** to characterize a metric (owner's standing rule).

## Ambal's feedback — locked design principles

These are the reasons the layout looks the way it does. **Preserve all four every week:**

1. **Pillars are COLUMNS, 2P agents are ROWS — in BOTH grids.** The Scorecard and the ODSP-share
   grid use the identical column structure (2P-agent rail → Adoption → Engagement → Reliability) so
   each **raw number in the Scorecard lines up visually above its % in the share grid.**
2. **Story sections are aligned to pillars**, each with a pillar-colored left border, plus a
   **Leadership watch** card. Movement is **+ in green, − in red.**
3. **Pillar colors are identical across every section** (scorecard, share, story, methodology).
4. **2P agent colors are identical across every section.**

### Canonical colors (do not diverge across sections)

| Role | Token | Light value |
| --- | --- | --- |
| Pillar · Adoption | `--cp-border-strong` | `#919191` (grey) |
| Pillar · Engagement | `--cp-warning` | `#f59e0b` (amber) |
| Pillar · Reliability | `--cp-text` | `#242424` (near-black) |
| Story · Architecture runway | `--cp-border-strong` | `#919191` (grey) |
| Story · Leadership watch | `--cp-accent` | `#b11f4b` (crimson) |
| Agent · Copilot Cowork | `--cp-link` | `#0078d4` (blue) |
| Agent · Copilot Studio / Dracarys | `--cp-text-soft` | `#6f6f6f` (grey) |
| Movement up | `--cp-success` | `#16a34a` (green) |
| Movement down | `--cp-danger` | `#dc2626` (red) |
| Movement flat / n-a | `--cp-text-muted` | `#5c5c5c` (grey) |

The template ships light **and** dark themes (`html[data-theme]`, auto from
`prefers-color-scheme`); every token above has a dark-mode value — always change the **token**,
never a hard-coded hex, so both themes stay in sync.

## Section order (top → bottom)

1. **Hero** (`.hero`) — off-white surface, black top border; amber `.eyebrow` date badge
   (e.g. `Aug 21, 2026`), `h1` = `2P ODSP Integration - Weekly Pulse`, subtitle
   `Week of <this week> compared with <prior week>. Pre ODSP MCP / WorkIQ integration benchmark.`
2. **What is included** (`.included`, blue top border) — 4 cards in a 2-col grid; the current
   highlight card gets `.new` (crimson left border, e.g. "New! Copilot Studio / Dracarys Knowledge Search").
3. **2P ODSP Integration: Scorecard** (`.matrix`) — see grid spec below. Raw values + WoW movement.
4. **M365 Agentic Work: ODSP share** (`.matrix`) — same grid, `.share-metric` donuts + pp movement.
5. **This week's 2P ODSP Integration story** (`.story`, crimson top border) — intro + pillar-colored
   `.story-card`s: Adoption, Engagement, Reliability, Architecture runway, **Leadership watch**, Overall.
6. **Methodology** (`.methodology`) — 3 pillar-colored cards (Adoption / Engagement / Reliability).
7. **Footer** (`.footer`) — sign-off line.

## Tabs (Weekly + Month-to-Date)

The dashboard is a tabbed view. A `.tabs` bar sits under the hero with two `.tab-btn`s that toggle
`.tab-panel` sections (crimson underline marks the active tab); a small script also honors a
`?tab=weekly|mtd` URL param for direct links/screenshots.

- **Weekly** (`#tab-weekly`, default) — sections 2–6 above.
- **Month-to-Date** (`#tab-mtd`) — **uses the exact same `.matrix` layout as the Weekly tab**
  (agents as ROWS, the three pillars as COLUMN groups: Adoption / Engagement / Reliability),
  so both tabs are visually identical in structure and color (Cowork blue rail, Studio grey rail;
    Adoption grey, Engagement amber, Reliability near-black pillar heads). Two sections mirror the
    weekly ones: a **Scorecard** whose `.metric.mtd` cards show the metric name then a **July | Aug MTD**
    value pair with the change below (`N/A` where not publishable, `+NN% pace` for run-rate compares),
    and an **ODSP share** matrix whose `.donut`s show the **Aug MTD** share with a `July NN%` baseline
    (`.share-ref`) and a `+NN pp` movement below, matching Ambal's mockup (both agents cover all six
    metrics; gaps shown as `N/A`). MTD-specific styling: white metric cards, each pillar's metrics kept
  on a single row, and pillar columns sized proportional to metric count (Adoption/Engagement wider,
  Reliability narrower). The `.pulse` container is widened to 1520px so all three pillars fit in one
  row; the mobile media query still stacks everything on small screens.

## Matrix grid spec (shared by Scorecard + Share)

- `grid-template-columns: 190px repeat(3, minmax(0,1fr))`, wrapped in `.matrix-scroll`
  (`min-width:1040px` on desktop).
- **Each `.pillar-cell` carries its pillar class** (`adoption` / `engagement` / `reliability`) in
  addition to any agent class. This is required so the mobile layout can label and color-code cells.
- **Row 1** = `.matrix-corner` ("2P agent") + 3 `.matrix-head` pillar headers, each with a
  plain-language question and a pillar-colored 5px top border:
  - Adoption — "Who is using ODSP?"
  - Engagement — "How much ODSP-backed work is happening?"
  - Reliability — "Can agents depend on ODSP?"
- **Rows 2–3** = one row per agent: a `.surface` agent label (colored 6px left border via
  `--series`) followed by 3 `.pillar-cell`s (one per pillar), each holding a `.metrics` auto-fit grid.
- **Scorecard cell** = `.metric` → `<strong>` value, `<span>` label, `.movement` WoW.
- **Share cell** = `.share-metric` → `.donut` + `.share-copy` (label + pp movement). The donut is a
  pure-CSS `conic-gradient(var(--series) calc(var(--share)*1%), …)`; set `style="--share:NN"` and
  `data-value="NN%"`. Donut arc uses the **agent** series color (blue Cowork, grey Studio).
- Alignment rule (Ambal #1): keep the **same metric in the same column position** in both grids so
  a reader can drop straight down from a raw number to its share. Metrics with no share value
  (e.g. Active Agents) simply have no donut in the share grid.

## Number & wording rules

- Scorecard/share values are **coarse-rounded** (whole %, whole pp; `flat` for ~0 change).
- Story text %s should match the scorecard/share rounding; keep the **Overall** card and
  **Why it matters** lines qualitative, not speculative.
- No "strong/weak"; no fabricated or interpolated values.

## Render / export

Edge headless to verify (light theme is default; append `?scoutTheme=dark` to preview dark):
```
msedge --headless --disable-gpu --force-device-scale-factor=1.25 --window-size=1300,4200 --screenshot=out.png "<file-uri>"
```
The template is **responsive / mobile-friendly**. Below 760px the matrix stops being a wide
scrolling grid: the pillar-header row is hidden and each agent stacks as a card with its three
pillar cells one under the other, each labeled (Adoption / Engagement / Reliability) with a
pillar-colored top border and single-column metrics. Do **not** re-introduce a fixed-width
viewport; keep the `width=device-width` meta and the per-cell pillar classes.

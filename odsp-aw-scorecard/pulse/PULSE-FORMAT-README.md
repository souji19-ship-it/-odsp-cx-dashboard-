# ODSP-AW Weekly Pulse — canonical format

`ODSP-AW-Pulse-TEMPLATE.html` is the **approved Ambal-format Pulse layout** (locked Aug 21, 2026,
Aug 9–15 data as the worked example). When asked to build "next week's Pulse", clone this file and
only swap the numbers/dates — **do not change the layout, section order, colors, or wording scaffold.**

> Ground rules (inherit from ../README.md):
> 1. **Never fabricate a number.** Every value is source-derived. If a source is unreachable, keep the
>    prior value and flag it — do not invent.
> 2. **No personal names** anywhere (leadership-shared).
> 3. Transcribe exactly from the source the owner points to; don't silently "correct" to finer values.

## Section order (top → bottom)

1. **Header** — dark navy (`#10233b`), gold date badge (e.g. `AUG 21, 2026`), title
   `2P Integration — Weekly Pulse`, subtitle `Week of <this week> compared with <prior week>. Pre ODSP MCP / WorkIQ integration benchmark.`
2. **New! callout** — purple left border; announces the current highlight
   (e.g. Copilot Studio / Dracarys now includes Knowledge Search).
3. **What is included** — blue top-border box, 2-column bullet list of the 4 sections.
4. **2P Integration: Scorecard** — agent-box grid. Col1 = pillar rail
   (ADOPTION steel-blue, ENGAGEMENT orange, RELIABILITY green); Cowork header blue `#3355cc`
   spans 2 metric cols, Copilot Studio/Dracarys header purple `#7b34c0` spans 3.
   Values are **coarse-rounded** (e.g. `107.2K`, `flat`, `+8% WoW`, `96%`, `-1 pp WoW`).
5. **M365 Agentic Work: ODSP share** — donut grid.
   - Pillars are **vertical colored bars** on the left of each group (steel-blue Adoption, orange
     Engagement, green Reliability) — matching the 2P Scorecard's vertical pillar rail. A light
     question caption sits above each group ("Who is using ODSP?" etc.); `2P Agent` labels col 1.
   - **5 donut positions per agent row** (Active Users, Active Tenants, Tasks, Tool Calls, success).
   - Cowork success donut title = `Tool Success Rate`, caption `ODSP share`.
   - CS Engagement 2nd cell is **one box holding two color-coded donuts**: `Tool Calls` (CS purple)
     and `Knowledge Searches` (teal `--know #12a594`), each with its own % and pp delta.
   - CS success = `Tool Success Rate`. Reliability donut cells get a teal border.
6. **This week's 2P story** — intro + 5 kicker sections
   (Growth × engagement, Breadth × depth, Reliability, Architecture runway, Leadership watch) + **Overall**.
7. **Methodology** — grouped box: Adoption / Engagement / Reliability, colored left borders.
   Tool Success Rate def = "Percentage of ODSP tool calls that completed successfully."

## Number & color rules

- **Scorecard boxes**: coarse rounding (whole %, whole pp); `flat` for ~0 count change.
- **Donut pp deltas**: finer (e.g. `-0.4 pp`, `-9 pp`, `+2 pp`) — match the owner's donut-source image exactly.
- **Story text %s**: round to whole numbers to match the scorecard/donut slides above.
- **Color coding** (spans `.up` / `.down` / `.flat`):
  - green `#1a8f4c` = metric rose MoM
  - red `#c62828` = metric dropped MoM
  - grey `#6b7280` = flat / no delta (`—`)
  - Share levels in the story are colored by their **pp direction** from the donut grid.

## Donut geometry (r=34, C≈213.63, `viewBox 0 0 84 84`)

`stroke-dasharray = "<pct/100 * 213.63> <remainder>"`, `stroke-dashoffset="53.41"` (starts at 12 o'clock).
Worked values: 48→102.54, 63→134.59, 24→51.27, 14→29.91, 96→205.08, 31→66.22, 42→89.72, 9→19.23,
8→17.09, 92→196.54.

## Render / export

Edge headless to verify, then (optionally) python-pptx full-bleed portrait slide:
```
msedge --headless --disable-gpu --force-device-scale-factor=1.25 --window-size=1240,3050 --screenshot=out.png "<file-uri>"
```

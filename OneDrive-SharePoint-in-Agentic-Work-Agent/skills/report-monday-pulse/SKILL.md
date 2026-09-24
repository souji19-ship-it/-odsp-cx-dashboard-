# Skill: report-monday-pulse

## Purpose

Generate the weekly **"OneDrive SharePoint in Agentic Work" Pulse** — a one-page leadership
scorecard sent every Monday morning. Designed to be skimmed in 60 seconds.

## Inputs

| Input | Required | Default |
|-------|----------|---------|
| `week_ending` | No | Most recent complete Sun–Sat week |
| `include_msit` | No | `false` (production only) |

## Output format

Markdown document with three sections:

### Section 1: Headline (3 sentences max)

One-liner on the week's biggest signal. Example:
> "SPARK WAU crossed 250K for the first time (+8% WoW), driven by tenant expansion
> in financial services. Cost-per-session dropped 12% as GPT-4o-mini adoption
> accelerated. Thumbs-down rate held flat at 25%."

### Section 2: Scorecard Table

```
┌─────────────────────────┬──────────┬─────────┬───────┐
│ Metric                  │ This Wk  │ Last Wk │ WoW   │
├─────────────────────────┼──────────┼─────────┼───────┤
│ SPARK WAU (Prod)        │ 252,100  │ 233,400 │ 🟢 +8%│
│ M365 Copilot SP Rank    │ #5 of 9  │ #5 of 9 │ ⚪ —  │
│ Active Tenants          │ 12,340   │ 11,890  │ 🟢 +4%│
│ Query Volume (weekly)   │ 1.2M     │ 1.1M    │ 🟢 +9%│
│ Thumbs-Down Rate (R7)   │ 25.5%    │ 25.8%   │ ⚪ —  │
│ Cost/Session (est.)     │ $0.032   │ $0.036  │ 🟢-12%│
│ Skills Created (cumul)  │ 8,450    │ 8,100   │ 🟢 +4%│
│ SP Agent WAU            │ 44,956   │ 43,200  │ 🟢 +4%│
│ SP Agent Return Rate    │ 36.1%    │ 35.2%   │ 🟢 +1%│
│ CoWork SP Tool Success  │ — (gap)  │ — (gap) │ ⬜ TBD│
│ Scout SP Integration    │ — (gap)  │ — (gap) │ ⬜ TBD│
└─────────────────────────┴──────────┴─────────┴───────┘
```

Badge rules (from integration_glossary.md):
- 🟢 > +3% WoW
- ⚪ -3% to +3%
- 🟡 -3% to -10%
- 🔴 < -10%
- ⬜ No data

### Section 3: Watch List (2–3 bullets max)

Items that need attention this week. Examples:
- "AI Intranet TDR spiked to 40.7% — investigate top DSAT categories"
- "Autofill PAYG tenant count flat for 3rd consecutive week"
- "CoWork/Scout tool telemetry still not instrumented — engaging Roger/Luca"

## Data sources used

- `context/data/kav2/` — WAU, query volume, active tenants
- `context/data/ideas/` — M365 workload WAU (for rank calculation)
- `context/data/extensibility/` — SP Agent WAU, return rate
- `context/data/cogs/` — cost-per-session
- `context/data/ocv/` — thumbs-down rate
- `context/data/skills/` — skills created/used

## Behavior

1. Load the most recent scrape data from each source
2. Compute WoW changes by comparing to prior week's values
3. Apply badge rules from the glossary
4. Generate the headline by identifying the single biggest WoW mover
5. Populate the Watch List with any 🟡 or 🔴 metrics, plus persistent gaps
6. Output as clean markdown, ready to paste into email or Teams

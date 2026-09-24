# Skill: report-integration-scorecard

## Purpose

Generate the full **OneDrive SharePoint in Agentic Work Integration Scorecard** — a comprehensive
view of how SP integrations perform across all agentic surfaces. More detailed than the
Monday Pulse; used for monthly reviews, ODSP MBR, and CAI BWBRs.

## Inputs

| Input | Required | Default |
|-------|----------|---------|
| `period` | No | Last 4 complete weeks |
| `include_msit` | No | `false` |
| `surfaces` | No | All (CoWork, Scout, Copilot Studio, SPARK) |

## Output format

Markdown document with five sections:

### Section 1: Executive Summary (5 sentences max)

High-level narrative connecting metrics to strategic priorities (BHAGs, Zach's Top of Mind).

### Section 2: Integration Coverage Matrix

```
┌──────────────┬──────────┬────────────┬───────────┬──────────┐
│ Surface      │ SP Tools │ Success %  │ TDR       │ Cost/Qry │
│              │ Enabled  │            │           │ (est.)   │
├──────────────┼──────────┼────────────┼───────────┼──────────┤
│ SPARK        │ ✅ All   │ —          │ 25.5%     │ $0.032   │
│ CoWork       │ ✅ Yes   │ — (gap)    │ — (gap)   │ — (gap)  │
│ Scout        │ ✅ Yes   │ — (gap)    │ — (gap)   │ — (gap)  │
│ Copilot Studio          │ ⚠ Partial│ — (gap)    │ — (gap)   │ — (gap)  │
└──────────────┴──────────┴────────────┴───────────┴──────────┘
```

### Section 3: Growth Trends

- SPARK WAU trend (4-week sparkline description)
- M365 Copilot penetration rate trend
- SP Agent adoption trend
- Skills adoption funnel progression

### Section 4: Cost & Efficiency

- Cost-per-session trend by model
- Token volume growth vs. WAU growth (efficiency ratio)
- Cache hit rate trend

### Section 5: Customer Feedback

- TDR trend (R7 and R28)
- Top 3 DSAT categories with WoW change
- Reliability (error thumbs) trend

## Data sources used

All 14 sources from `context/data_sources.md`.

## Behavior

1. Load all available data, compute 4-week trends
2. Cross-reference metrics against strategic_context.md priorities
3. Honestly label gaps as "— (gap)" — never approximate missing data
4. Highlight any metric that crosses a threshold (TDR > 30%, cost spike, WAU decline)

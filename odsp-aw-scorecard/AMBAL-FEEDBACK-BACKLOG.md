# Ambal — Scorecard Change Backlog

Recommended changes to the **ODSP-in-Agentic-Work Scorecard** from Ambal Balakrishnan, sourced from
the **ODSP in AW** Teams channel and related scorecard threads via Microsoft 365 Copilot (WorkIQ).

- **Compiled:** 2026-07-23
- **Target artifact:** `odsp-aw-scorecard/dashboard/ODSP-in-Agentic-Work-Scorecard.html`
- **Status legend:** ☐ open · ◐ in progress · ☑ done
- **Ground rule reminder:** never fabricate a number; data-dependent items stay open until the real
  value is sourced. Do not auto-update the Cowork tab.

---

## P0 — Most recent (21–23 Jul 2026)

| # | Date | Ask | Detail | Type | Status |
|---|------|-----|--------|------|--------|
| 1 | 21 Jul | **High-Value ODSP Actions metric** | Distinguish high-value ODSP actions from basic file retrieval/read ops. Biggest requested enhancement. | Metric (data) | ☐ |
| 2 | 21 Jul | **Scenario / task-based reporting** | Move beyond tool-call reporting to complete user workflows / task-level measurement. | Metric (data) | ☐ |
| 3 | 21 Jul | **Token consumption attribution** | Framework/metric for token attribution & accountability, ideally task-level. | Metric (data) | ☐ |
| 4 | 21 Jul | **Any Route vs Preferred Route** | Side-by-side adoption/migration metrics (Preferred = MCP/SPARK). | Metric (data) | ☐ |
| 5 | 21 Jul | **Reposition under WorkIQ narrative** | Evolve branding from "2P & 3P Platform Adoption" toward broader "WorkIQ Metrics" framing. | Label/structure | ☐ |
| 6 | 21 Jul | **Business-value storytelling** | Connect Reach → Adoption → Reliability to business value & strategic outcomes, not just telemetry. | Narrative | ☐ |
| 7 | 23 Jul | **Change headline success metric** | Show **ODSP Service Success (~96%)** as primary success metric instead of lower end-to-end figure. | Metric (data) | ☐ |
| 8 | 23 Jul | **Split failures by category** | Service / Author / User failures + status classes (4xx, 5xx, throttling, timeout). | Metric (data) | ☐ |
| 9 | 23 Jul | **Fix latency methodology** | Stop HTTP-leg latency; use true end-to-end; report **P50 & P95**; avoid averages-only. | Methodology (data) | ☐ |
| 10 | 23 Jul | **Operation-level reporting** | Break down health by operation/tool, not connector rollups: PatchItem, GetTable, GetFileItem, GetFileContentByPath, CreateFile. | Metric (data) | ☐ |
| 11 | 23 Jul | **Clean denominator** | Exclude ConsentPending calls from reliability calculations. | Methodology (data) | ☐ |

## P1 — July direction (2–16 Jul 2026)

| # | Date | Ask | Detail | Type | Status |
|---|------|-----|--------|------|--------|
| 12 | 16 Jul | **Add WorkIQ section** | Expand scorecard coverage to include a WorkIQ metrics/dashboard section after current work. | Structure (data) | ☐ |
| 13 | 10 Jul | **Reliability-first model** | Order: (1) tool reliability (2) task success (3) JTBD/scenario success (4) attributed losses (5) DSAT last. Not DSAT-first. | Structure | ☐ |
| 14 | 10 Jul | **Tool-failure fix list** | Top failing ODSP tools, error-code breakdown, impact-ranked failures. | Metric (data) | ☐ |
| 15 | 10 Jul | **Never-recovered task analysis** | "Poison slice": user job, tool involved, why recovery failed. | Metric (data) | ☐ |
| 16 | 10 Jul | **Cross-agent comparison view** | Same ODSP tools across Cowork / Scout / Copilot Studio → tool issue vs agent misuse. | Metric (data) | ☐ |
| 17 | 10 Jul | **Reach: absolute + share** | Show ODSP footprint as absolute counts AND share of platform, side-by-side. | Metric (data) | ☐ |
| 18 | 9 Jul | **Task funnel table** | Tasks that called ODSP → received ODSP response → completed successfully with ODSP. | Metric (data) | ☐ |
| 19 | 7 Jul | **Validate every Cowork metric** | Cross-check all Cowork numbers vs authoritative dashboards; reconcile discrepancies. | Data fidelity | ☐ |
| 20 | 5 Jul | **Standardized weekly metric table** | Cowork Usage (reach, retention, tasks, tool-call volume) + ODSP-in-Cowork (user share, tenant share, tool-call share), with Last Wk / This Wk / Diff. | Metric (data) | ☐ |

## P2 — Methodology & framing (2 Jul 2026)

| # | Date | Ask | Detail | Type | Status |
|---|------|-----|--------|------|--------|
| 21 | 2 Jul | **Methodology slide** | Metric definitions + how each metric is calculated. | Docs | ☐ |
| 22 | 2 Jul | **Calculation transparency** | Clarify audience-group interpretation & calculation assumptions. | Docs | ☐ |
| 23 | 2 Jul | **Measure scenarios, not just tools** | Luca's guidance: metrics reflect user intent, ODSP participation, outcome quality. | Narrative | ☐ |

---

## Categorization

- **Safe to apply without new data** (labels / structure / ordering / docs): #5, #6, #13, #21, #22, #23
- **Requires sourced telemetry before dashboard values change** (do NOT fabricate): #1, #2, #3, #4, #7, #8, #9, #10, #11, #12, #14, #15, #16, #17, #18, #19, #20

## Source threads (Teams)

- ODSP in AW channel: https://teams.microsoft.com/l/message/19:d1b07db16fb348bb87aabccc09432bb3@thread.v2/1784484219086?context=%7B%22contextType%22:%22chat%22%7D
- 23 Jul accuracy review initiated by Ambal; data provided by Sandeep Yerra (Copilot Studio data team).

> Compiled by GitHub Copilot CLI from WorkIQ search of the ODSP in AW channel. Verify each ask against
> the linked threads before acting; some are strategic direction rather than a single concrete edit.

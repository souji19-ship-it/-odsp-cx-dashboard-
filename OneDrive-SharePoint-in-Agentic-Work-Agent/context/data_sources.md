# Data Sources — ODSP-AW Agent

## Instrumented sources (scraped weekly via Data-Pipeline)

| # | Source | System | Endpoint / Dashboard | Metrics | Dashboard Panel |
|---|--------|--------|---------------------|---------|-----------------|
| 1 | SPARK Core | Nezha | `a82f4c8e-6f29-4402-8fa1-c0af49a5132d` | WAU, DAU, query volume, retention, surfaces, languages | SPARK Usage |
| 2 | SPARK Tenant Deep Dive | Nezha | `p/nGYV1R9kEox/` | Per-tenant WAU, active sites, surface breakdown | SPARK Tenants |
| 3 | IDEAS M365 Workloads | IDEAS AURA API | `ideas.getMetricData()` | WAU/MAU/DAU for all M365 Copilot workloads | M365 Workloads |
| 4 | IDEAS SP Sub-products | IDEAS AURA API | `ideas.callTool('get_metric_data')` | SP/OD sub-product WAU/MAU, new/returning/lapsed | Portfolio |
| 5 | IDEAS Extensibility | IDEAS API | `CopilotExtensibilityDashboard` | SPO agent DAU/WAU/MAU, thumbs-down, return rate | Custom Agents |
| 6 | IDEAS Agent Comparison | IDEAS Cowork Usage | `CopilotCoworkUsage` | Per-agent weekly WAU across all M365 agents | Agent Comparison |
| 7 | Skills (Nezha) | Nezha | Dashboard #7082 | Skills created/used, tenant adoption funnels | Skills |
| 8 | Skills (ADX) | ADX | ADX dashboard `7d0f6d73-...` | Skill adoption %, prompt classification, tool-call matrix | Skills ADX |
| 9 | COGS | Kusto | `LLMAPIRequestTracingEvent_Global` | Tokens, sessions, cost estimates by model/surface | COGS |
| 10 | OCV | OCV Elasticsearch | `ocv.microsoft.com/api/es` | SAT/DSAT daily, category breakdown, reliability | Customer Voice |
| 11 | AI Reach | Power BI | MSIT Power BI reports | R28 viewer counts by AI feature | AI Reach |
| 12 | Autofill | Power BI | MSIT Power BI reports | Tenant/usage counts, PAYG vs SPARK | Autofill |
| 13 | Makers | Nezha | Dashboards #3611, #1814 | Automation funnels, Lists WAU, column metrics | Makers |
| 14 | User Intent | AugLoop | `WorkflowOperationEvent` | Intent categories + thumbs feedback by category | User Intent |

## Not yet instrumented (gaps for scorecard)

| Gap | What's needed | Likely source | Owner to engage |
|-----|---------------|---------------|-----------------|
| **Scout SP integration** | SP content retrieval quality, grounding success | Augloop Kusto — Scout orchestrator events | Roger Gu |
| **Copilot Studio SP integration** | SP tool usage within Copilot Studio custom agents | Augloop or Copilot Studio telemetry | TBD — check with Ashu Rawat |
| **Cross-surface tool success** | Unified "did the SP tool call succeed?" across all agents | Augloop correlation: join tool calls → OCV thumbs | Donovan Isaak (has OCV↔Augloop correlation keys) |
| **COGS database access** | Token/cost data per SP tool call | `inferencedashboardlog` Kusto — need db permissions | Infra team |

## Data freshness

Scrapers run on-demand via `node scrape-<source>.js` in the `Data-Pipeline/` directory.
Target cadence: **every Monday morning** before the Pulse is sent.
Each scraper saves timestamped data to `Data-Public/<source>/` as JSON/CSV (the agent reads it via the `context/data/` junction).
`generate-dashboard-data.js` assembles everything into `dashboard-data.js` for the HTML dashboard.

# OneDrive SharePoint in Agentic Work — Agent

Agency CLI-based agent for tracking, reporting, and exploring how SharePoint integrations perform across M365 agentic experiences — CoWork, Scout, Copilot Studio, and SPARK.

The agent supports two modes:

1. **Conversational exploration** — ask questions about integration health, tool success rates, cost trends, and customer feedback across agentic surfaces.
2. **Templated reporting** — named skills produce consistent outputs for leadership reviews (Monday Pulse, Integration Scorecard, deep dives).

Reports and conversations share one data plane, one vocabulary, and one skill library.

## Quick orientation

| Path | What it is |
|---|---|
| [`AGENTS.md`](AGENTS.md) | Agent spec — role, modes, behavior rules, vocabulary |
| [`context/integration_glossary.md`](context/integration_glossary.md) | Master source of truth for SP agentic integration taxonomy |
| [`context/data_sources.md`](context/data_sources.md) | Data source inventory — what's available, what's scraped, what's missing |
| [`context/strategic_context.md`](context/strategic_context.md) | North Star, BHAGs, OKR alignment, Zach's priorities |
| [`skills/`](skills/) | Packaged workflows (Monday Pulse, Integration Scorecard, etc.) |
| [`queries/`](queries/) | Reusable queries (KQL, API calls) |
| [`scripts/`](scripts/) | Automation scripts (scrape triggers, dashboard generation) |
| [`output/`](output/) | Generated reports and dashboards (gitignored) |
| [`agency.toml`](agency.toml) | Agency CLI config — MCP server wiring |

## Data sources

The agent draws from multiple telemetry systems:

| Source | What it provides | Access |
|---|---|---|
| **Nezha (SPARK)** | WAU, DAU, query volume, retention, top tenants, skills, makers | Corp SSO via Playwright/CDP |
| **IDEAS AURA** | M365 Copilot WAU/MAU across all workloads, sub-product breakdowns | IDEAS API + Corp SSO |
| **IDEAS Extensibility** | SP Agent DAU/WAU/MAU, thumbs-down, return rate | IDEAS API |
| **IDEAS Cowork Usage** | Per-agent WAU comparison (Agent Comparison tab) | IDEAS API |
| **OCV** | Customer feedback — SAT/DSAT, thumbs-down rate by category | OCV Elasticsearch API |
| **ADX** | Skills runtime — adoption, prompt classification, tool-call matrix | ADX dashboard scrape |
| **Kusto (COGS)** | Token volumes, cost estimates by model/surface, cost-per-session | `az login` + Kusto |
| **Power BI** | AI Reach (R28 viewers), Autofill (tenant/usage counts) | Power BI scrape |

### Gaps (not yet instrumented)

| Gap | What's needed | Potential source |
|---|---|---|
| CoWork SP tool calls | Success rate, error rate, latency | Augloop Kusto? |
| Scout SP integration | Content retrieval quality, tool invocation | Augloop Kusto? |
| Copilot Studio SP integration | Tool usage within Copilot Studio agents | TBD |
| Cross-surface tool success | Unified success/fail across all agents | Augloop + OCV correlation |

## First-run setup

1. **Install Agency CLI** (see One Engineering System docs).
2. **Clone the repo:**
   ```
   git clone https://github.com/ambalb_microsoft/OneDrive-SharePoint-in-Agentic-Work
   cd OneDrive-SharePoint-in-Agentic-Work/OneDrive-SharePoint-in-Agentic-Work-Agent
   ```
3. **Install scraping dependencies** (for data refresh):
   ```
   npm install    # in the Data-Pipeline/ scraper dir
   ```
4. **Open in Agency CLI:**
   ```
   agency copilot
   ```
5. **Verify wiring:**
   ```
   /mcp
   ```
   You should see the configured MCP servers listed.

## Weekly workflow

```
Monday AM:
  1. Run scrapers (node scrape-cowork.js etc. in Data-Pipeline/)
  2. Generate dashboard data (node generate-dashboard-data.js)
  3. Ask the agent: "report-monday-pulse"
  4. Review output → send as Pulse email
  5. Publish updated dashboard to SharePoint
```

## Maintainers

- Ambal Balakrishnan (ambalb@microsoft.com)

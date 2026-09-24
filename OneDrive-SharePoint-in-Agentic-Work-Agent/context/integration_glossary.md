# Integration Glossary — OneDrive SharePoint in Agentic Work

> Version: 1.0 | Last updated: June 17, 2026 | Maintainer: Ambal Balakrishnan

This glossary is the **source of truth** for how the ODSP-AW agent translates raw telemetry
into the team's working vocabulary. If the glossary and a query disagree, the glossary wins.

---

## Agentic Surfaces

| Surface ID | Display Name | Description | Data Sources |
|-----------|-------------|-------------|-------------|
| `cowork` | CoWork | M365 Copilot's primary agentic canvas — multi-turn task completion | Agent Comparison (IDEAS), Augloop |
| `scout` | Scout | Deep research agent — multi-step investigation and synthesis | Agent Comparison (IDEAS), Augloop |
| `Copilot Studio` | Copilot Studio | Custom agent builder — declarative and pro-code agents | TBD |
| `spark` | SPARK / Copilot in SharePoint | Native SP AI — FAB, page content, site-scoped copilot | Nezha KAv2, OCV, COGS |
| `bizchat` | BizChat | M365 Copilot Chat — general-purpose assistant | IDEAS AURA |

---

## Metric Definitions

### Usage Metrics

| Metric | Definition | Source |
|--------|-----------|--------|
| **WAU** | Weekly Active Users — distinct users with ≥1 interaction in a Sun–Sat week | Nezha, IDEAS |
| **DAU** | Daily Active Users — distinct users per calendar day | Nezha, IDEAS |
| **MAU** | Monthly Active Users — distinct users in trailing 28 days | IDEAS |
| **Query Volume** | Total conversations/queries initiated per period | Nezha KAv2 |
| **Active Tenants** | Tenants with ≥1 user interaction per week | Nezha KAv2 |
| **Penetration Rate** | SPARK WAU ÷ M365 Copilot All-Up WAU | Derived |
| **Engagement Intensity** | Weekly queries ÷ WAU | Derived |
| **Stickiness (DAU/WAU %)** | % of weekly actives returning on any given day | Derived |

### Quality Metrics

| Metric | Definition | Source |
|--------|-----------|--------|
| **Thumbs-Down Rate (TDR)** | ThumbsDown ÷ (ThumbsUp + ThumbsDown) | OCV |
| **Tool Success Rate** | Successful SP tool calls ÷ total SP tool calls | Augloop (TBD) |
| **Error Rate** | Thumbs reporting "Something went wrong" ÷ total thumbs | OCV |
| **Return Rate** | % of MAU users who return the following month | IDEAS Extensibility |

### Cost Metrics

| Metric | Definition | Source |
|--------|-----------|--------|
| **Cost per Session (est.)** | Estimated $ per session = tokens × price-sheet rate | COGS Kusto |
| **iTPM** | Input tokens per million — net-new tokens per session | COGS Kusto |
| **Cache Hit %** | CachedPromptTokens ÷ total PromptTokens | COGS Kusto |
| **Daily Cost (est.)** | Sum of estimated cost across all models/surfaces per day | COGS Kusto |

### Adoption Metrics

| Metric | Definition | Source |
|--------|-----------|--------|
| **Integration Coverage** | Count of agentic canvases with SP tools enabled ÷ total P0–P1 canvases | Manual tracking |
| **Skills Created** | Cumulative count of SP skills authored | Nezha Skills |
| **Skills Used** | Cumulative count of SP skills invoked | Nezha Skills |
| **Proof Funnel** | Tenant adoption stages: Solitary Explorer → Spread → Consumption → Habit | Nezha Skills |
| **FAB Enablement** | Copilot Licensed → KA Enabled → FAB Exposed (sites, tenants, users) | Nezha KAv2 |

---

## WoW Change Interpretation

| Change | Badge | Interpretation |
|--------|-------|---------------|
| > +10% | 🟢 Strong growth | Call out — what drove it? |
| +3% to +10% | 🟢 Healthy | Normal growth trajectory |
| -3% to +3% | ⚪ Flat | Stable — note if unexpected |
| -3% to -10% | 🟡 Soft | Worth watching — seasonal or concerning? |
| < -10% | 🔴 Alert | Investigate immediately — flag in Pulse |

---

## Surface × Metric Availability Matrix

| Metric | SPARK | CoWork | Scout | Copilot Studio | BizChat |
|--------|-------|--------|-------|-----|---------|
| WAU | ✅ | ✅ (via Agent Comparison) | ✅ (via Agent Comparison) | ❌ | ✅ |
| Query Volume | ✅ | ❌ | ❌ | ❌ | ❌ |
| TDR | ✅ | ❌ | ❌ | ❌ | ❌ |
| Tool Success Rate | ❌ | ❌ | ❌ | ❌ | ❌ |
| Cost per Session | ✅ | ❌ | ❌ | ❌ | ❌ |
| Skills Created/Used | ✅ | ❌ | ❌ | ❌ | ❌ |
| Tenant Adoption | ✅ | ❌ | ❌ | ❌ | ❌ |

**Key insight:** We have deep instrumentation for SPARK but almost nothing for CoWork/Scout/Copilot Studio.
This is the #1 gap to close for a true "SP in Agentic Work" scorecard.

# OneDrive SharePoint in Agentic Work

Tracking how OneDrive and SharePoint (ODSP) integrations perform across M365 agentic surfaces — two families: **ODSP Agents** (Copilot in SharePoint · Copilot in OneDrive · SPARK) and **Agents calling ODSP** (CoWork · Scout · Copilot Studio).

## Structure

```
├── Data-Public/                 # Canonical scraped + ingested telemetry (gitignored, single source of truth)
│   ├── cowork/                  #   CoWork dashboard telemetry + feedback
│   ├── ideas/                   #   Copilot in SharePoint / OneDrive WAU (IDEAS)
│   ├── ocv/                     #   OCV per-surface Copilot thumbs (persisted)
│   └── spark/                   #   SPARK usage + tool health
├── Data-Private/                # gitignored; never read by Agent/LT Dashboard
│   ├── Data-Created/            #   Command Center (ODSP-AW-CC.html) + Dashboard/ + Records/ + the WIP deck
│   └── Data-Given/              #   Sensitive human source (recaps, notes, decks, grounding)
├── Data-Pipeline/               # Scraping infra (CoWork/SPARK/IDEAS/OCV scrapers + lib/)
├── OneDrive-SharePoint-in-Agentic-Work-Agent/   # ODSP-AW Agent (queries Data-Public + Kusto)
├── scripts/                     # Node + PowerShell: validate-cc, cc-maintenance, 7am refresh, archive
└── automation/                  # Scheduled-prompt registry + agent prompt files
```

## Quick Start

**Command Center:** Open `Data-Private/Data-Created/ODSP-AW-CC.html` (the cockpit — Tracker, Dashboards, Insights, Data Health, Operations, Archive).

**Agent:**
```bash
cd OneDrive-SharePoint-in-Agentic-Work-Agent
agency copilot
```

**Data refresh:**
```bash
cd Data-Pipeline
node scrape-cowork.js 2026-06-16 weekly   # CoWork
node scrape-kav2-full.js                   # SPARK
```

## Live Data Access

| Source | Method | Status |
|---|---|---|
| Augloop (SPARK tool calls) | Kusto direct | ✅ |
| OCV (per-surface thumbs + verbatims) | Kusto → persisted to Data-Public/ocv | ✅ |
| COGS (token costs) | Kusto (no db perms yet) | ⚠️ |
| CoWork dashboard (adoption + ODSP tool calls) | Playwright scrape → JSON | ✅ |
| SPARK / Nezha / IDEAS | Playwright scrape → JSON | ✅ |

## Owner
Ambal Balakrishnan · SharePoint AI Team

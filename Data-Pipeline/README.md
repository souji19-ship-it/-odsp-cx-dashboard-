# Data-Pipeline

Scraper infrastructure for **ODSP in Agentic Work**. Playwright/CDP scrapers + Kusto/IDEAS
clients that pull telemetry and write it into the repo-root **`Data-Public/`** (the canonical,
single source of truth read by the Command Center, the LT/Internal dashboards, and the Agent).

> Code only — `node_modules` is gitignored and regenerated on first run (`npm install`).

## Scrapers

| Script | Source | Writes to |
|--------|--------|-----------|
| `scrape-cowork.js` | CoWork tool telemetry + feedback (Nezha, CDP) | `Data-Public/cowork/` |
| `fetch-spark-tool-health.js` | SPARK tool-level success/latency (Nezha, CDP) | `Data-Public/spark/` |
| `scrape-skills.js` | Copilot-in-SharePoint / Skills adoption (Nezha, CDP) | `Data-Public/spark/` |
| `scrape-kav2-full.js` | SPARK full dashboard (WAU/DAU, tenants, surfaces) | `Data-Public/spark/` |
| `scrape-ideas-metrics.js` | IDEAS AURA API — M365 workload metrics | `Data-Public/ideas/` |
| `scrape-ideas-sp-subproducts.js` | IDEAS AURA API — SP/OD sub-product metrics | `Data-Public/ideas/` |
| `nezha-login.js` | One-time interactive sign-in into the debug Edge profile | — |

`lib/` — shared helpers: `cdp-connect` (connect to the debug Edge over CDP), `nezha-auth`,
`nezha-chart-data`, `nav-helpers`, `data-store` (CSV/JSON writer keyed off `ODSP_DATA_DIR`),
`ideas-client` (IDEAS AURA MCP client).

## Setup

```
cd Data-Pipeline
npm install            # one-time; node_modules is gitignored + regenerable (~100 MB)
```

No Playwright browser download is needed — the scrapers use `chromium.connectOverCDP()` to
attach to an **already-running** Edge debug profile (seamless corp SSO), not a launched browser.

## Run

Scrapers connect to a dedicated debug Edge on **CDP port 9222** (`%LOCALAPPDATA%\MSFTReportingEdge`).
Start it once (or let the 7am refresh job auto-launch it):

```
launch-edge-debug.bat        # starts Edge with --remote-debugging-port=9222 on the SSO profile
node scrape-cowork.js        # then run any scraper
```

In normal operation you don't run these by hand — **`scripts/refresh-odsp-aw-data.ps1`** (7am CST)
auto-launches the debug profile, installs deps if missing, runs the CoWork / SPARK / skills
scrapers, drift-checks the output, and posts findings. See the repo-root `README.md` and
`.github/copilot-instructions.md`.

## Conventions

- **Write only to `Data-Public/`** (override the base dir with `ODSP_DATA_DIR`). Never write data
  inside `Data-Pipeline/`.
- `MIN_SCRAPE_AGE_HOURS` (default 6) guards against re-scraping too soon; never overwrite newer data.

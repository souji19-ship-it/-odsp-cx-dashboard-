# scrape-spark-core

Daily-cadence **mini-scraper** for SPARK (Copilot in SharePoint / KAv2) core
usage metrics on Nezha. Lower-cost subset of `/scrape-msft-report` —
scrapes only the two tabs that produce headline WAU/DAU/queries/top-tenants
numbers, in ~3–5 min instead of ~13–15 min.

Reuses `scrape-kav2-full.js`'s per-tab scraper internally — no code duplication.

## Usage

```
/scrape-spark-core
```

## Instructions

When this skill is invoked, execute the following steps:

1. Change to the project directory:
   ```bash
   cd C:\repos\msft-reporting
   ```

2. Check if Edge debugging is running (port **9223** — dedicated profile):
   ```bash
   powershell.exe -Command "Test-NetConnection -ComputerName localhost -Port 9223 -InformationLevel Quiet"
   ```
   If `False`, no action needed — `scrape-kav2-core.js` auto-launches Edge
   with the dedicated `MSFTReportingEdge` user-data-dir on first run.

   > ⚠ Do **not** use port 9222. Port 9222 is the user's main Edge profile
   > with many tabs/service workers; Playwright `connectOverCDP` hangs.
   > Port 9223 + dedicated profile is the supported path.

3. Run the core scraper (force-refresh + rebuild dashboard-data.js):
   ```bash
   MIN_SCRAPE_AGE_HOURS=0 node scrape-kav2-core.js --generate
   ```

   Flags:
   - `--generate` — re-run `generate-dashboard-data.js` after scraping so the
     dashboard reflects the new numbers immediately.

   Environment:
   - `MIN_SCRAPE_AGE_HOURS=0` — bypass the per-tab freshness guard (default 6h).

4. Report:
   - Per-tab `+N new rows / ~M updated` lines from the scraper.
   - If `--generate` was passed: headline numbers from the
     `generate-dashboard-data.js` output (KAv2 WAU, WoW growth).
   - If a tab failed: name it and note it can be re-run by re-invoking the
     skill (Edge stays authenticated between runs).

## What gets scraped

| Top tab | Sub-tab | Outputs (under `data/`) |
|---|---|---|
| `KAv2` | — | `kav2/top-tenants-wau.csv` |
| `KAv2 Growth Analytics` | `Usage` | `kav2-growth-analytics/usage/*.csv` — WAU (all/Prod/MSIT), DAU, weekly query volume, turns/conv R7, query volume by surface + launch origin R7, FAB Exposed user/tenant/site enablement, weekly retention |

These feed `loadKav2()` in `generate-dashboard-data.js`, which produces every
SPARK field on the dashboard's All-Up + Growth + Features & Usage sections.

## Requirements

- Microsoft Edge installed (auto-launched on port 9223 with the dedicated
  `MSFTReportingEdge` user-data-dir).
- One-time SSO: first run requires signing in with @microsoft.com to Nezha.
  Cookies persist in the dedicated profile.

## Notes

- Idempotent: the `data-store` layer upserts timeseries by timestamp, so
  re-scraping the same day is safe.
- For everything else (Skills, AI All-Up, AI Reach, Autofill, Makers, COGS,
  IDEAS, User Intent, …) run `/scrape-msft-report` — weekly cadence is fine
  for those.
- Run `/publish-report` after this skill (with `--generate`) to push the
  updated dashboard.

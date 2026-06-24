# scrape-spark-core

Daily-cadence **mini-scraper** for SPARK (Copilot in SharePoint / KAv2) core usage
metrics on Nezha. Re-uses `scrape-kav2-full.js`'s per-tab scraper internally —
no duplicated browser/Superset logic.

Pulls only the headline numbers:

- **WAU** (all / Prod / MSIT), **DAU**, **weekly query volume**
- Query volume by top **surface** and top **launch origin** (R7)
- **Number of turns per conversation** (R7)
- FAB Exposed **users / tenants / sites** enablement (R7)
- **Weekly retention**
- **Top tenants by WAU**

Wall-clock: ~3–5 min (vs ~12–15 min for the full KAv2 scrape, vs ~13–15 min for
the full report). Use this instead of `/scrape-msft-report` for daily SPARK
refreshes; run the full report weekly (or whenever you need Tools, Localization,
Tenant Deep Dive, Retention deep-dive, Intensity, Top Entry-Points, Starter
Prompts, or Launch Dashboard data).

## Usage

```
/scrape-spark-core
```

Optional flags:

- `--generate` — also rebuild `dashboard-data.js` after scraping so the
  dashboard reflects the new numbers immediately.

Environment:

- `MIN_SCRAPE_AGE_HOURS=0` — bypass the per-tab freshness guard (defaults to
  6h; the daily run typically wants `0`).

## Instructions

When this skill is invoked:

1. Change to the project directory:
   ```bash
   cd C:\repos\msft-reporting
   ```

2. Check if Edge debugging is running on port **9223**:
   ```bash
   powershell.exe -Command "Test-NetConnection -ComputerName localhost -Port 9223 -InformationLevel Quiet"
   ```
   If `False`, no action needed — the scraper auto-launches Edge with the
   dedicated `MSFTReportingEdge` user-data-dir on first run. **Never use port 9222.**

3. Run the core scraper:
   ```bash
   MIN_SCRAPE_AGE_HOURS=0 node scrape-kav2-core.js --generate
   ```

4. Report:
   - Per-tab `+N new rows / ~M updated` lines from the scraper.
   - If `--generate` was passed: headline numbers printed by
     `generate-dashboard-data.js` (KAv2 WAU, WoW growth).
   - If a tab failed: re-run with `node scrape-kav2-core.js` (the auth + Edge
     state is preserved).

## What it scrapes

| Top tab | Sub-tab | Outputs (under `data/`) |
|---|---|---|
| `KAv2` | — | `kav2/top-tenants-wau.csv` |
| `KAv2 Growth Analytics` | `Usage` | `kav2-growth-analytics/usage/*.csv` (WAU, DAU, query volume, turns, launch origins, surfaces, FAB exposed, retention) |

These feed `loadKav2()` in `generate-dashboard-data.js`, which produces every
field on the dashboard's All-Up + Growth + Features & Usage tiles for SPARK.

## Requirements

- Microsoft Edge installed.
- One-time Nezha SSO with @microsoft.com (cookies persist in the dedicated profile).
- Node + repo dependencies installed (same as the full scrape).

## Notes

- Daily cadence is safe — the `data-store` layer upserts timeseries by
  timestamp, so re-scraping the same day is idempotent.
- Run `/scrape-msft-report` weekly for the full set of dashboards (Skills,
  AI All-Up, AI Reach, Autofill, Makers, COGS, etc.) — this skill **only**
  refreshes SPARK core.
- Run `/publish-report` after `--generate` to push the updated dashboard.

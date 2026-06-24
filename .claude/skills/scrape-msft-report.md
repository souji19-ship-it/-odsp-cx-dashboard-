# scrape-msft-report

Scrapes all dashboard data sources in **parallel** via `scrape-all.js`:
KAv2, Skills, AI All-Up, SP/OD sub-products, IDEAS M365 Copilot metrics, Agents I/O
(top tenants by WAU), Makers (Automations, Lists, Doc Libraries), AI Reach (Power BI
screenshots), Autofill (Power BI), and User Intent from Kusto.

## Usage

```
/scrape-msft-report
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
   If False, no action needed — `scrape-all.js` auto-launches Edge with the
   dedicated `MSFTReportingEdge` user-data-dir on first run.

   > ⚠ Do **not** use port 9222. Port 9222 is the user's main Edge profile
   > with many tabs/service workers; Playwright `connectOverCDP` hangs.
   > Port 9223 + dedicated profile is the supported path.

3. Run all scrapers in parallel:
   ```bash
   node scrape-all.js
   ```

   Useful flags:
   - `--browser-concurrency=N` — cap parallel browser scrapers (default `5`).
   - `--only=tag1,tag2`        — run only listed tags.
   - `--skip=tag1,tag2`        — exclude listed tags.
   - `--sequential`            — disable parallelism (debugging only).
   - `--skip-generate`         — skip the final `generate-dashboard-data.js` step.
   - `--no-retry`              — disable the auto-retry-once on failure.
   - `--no-dashboard-prewarm`  — disable fire-and-forget Superset cache pre-warm.
   - `--force` / `--fresh`     — bypass every scraper's freshness guard
     (`MIN_SCRAPE_AGE_HOURS=0` for all children).

   Tags: `kav2`, `all-up`, `makers`, `skills`, `skills-adx`,
   `ai-reach`, `autofill`, `ext-api`, `ideas-sp`, `ideas-m365`, `user-intent`.

   `scrape-all.js` automatically runs `generate-dashboard-data.js` at the end
   (unless `--skip-generate`). No need to run it separately.

4. Report results:
   - Per-scraper success/skipped/failure + duration from the summary table.
     A `↷` mark means the scraper exited cleanly but skipped its work because
     data was still fresh — re-run with `--force` to bypass.
   - Total wall-clock time.
   - **Source freshness audit** from `generate-dashboard-data.js` — flags any
     scraper whose `data/meta/scrape-log.json` entry is >24h old. If any
     headline numbers look suspicious, check this first before publishing.
   - Headline numbers from the `generate-dashboard-data.js` output (KAv2 WAU,
     WoW growth, M365 All Up, AI Reach status, Autofill PAYG/SPARK, etc.).
   - If any scraper failed: name it and note it can be re-run individually via
     `node scrape-all.js --only=<tag>`.

## Scrapers and what they produce

| Tag          | Script                            | Data | Dashboard section |
|--------------|-----------------------------------|------|-------------------|
| `kav2`       | `scrape-kav2-full.js`             | KAv2 WAU/DAU, query volume, surfaces, tools, retention, turn depth | All Up, Growth, Features & Usage |
| `all-up`     | `scrape-all-dashboards.js`        | AI All-Up WAU buckets, R28/R7 feature splits, competition grid | AI All-Up tab |
| `makers`     | `scrape-makers.js`                | Automation creators/count, Lists MAU/WAU/DAU, flow funnels, column metrics, Makers R28 | Makers tab |
| `skills`     | `scrape-skills.js`                | Skills created/used, unique users, tenant adoption | Skills tab |
| `skills-adx` | `scrape-skills-adx.js`            | Skill adoption pie, count distribution, OOB %, prompt classification, tool usage | Skills tab (Agent Runtime) |
| `ai-reach`   | `scrape-ai-reach.js`              | R28 viewer trends (Intranet Reach + Doc Library Reach) | AI Reach tab |
| `autofill`   | `scrape-autofill.js`              | Autofill PAYG/KA tenant + usage trends, customer table | Autofill section |
| `ext-api`    | `scrape-extensibility-api.js`     | SPO Agents Avg DAU/WAU/MAU + extension metrics (IDEAS CopilotExtensibilityDashboard API) | SharePoint Agents tile |
| `ideas-sp`   | `scrape-ideas-sp-subproducts.js`  | SP/OD sub-product WAU/MAU/DAU | M365 / SP sub-products |
| `ideas-m365` | `scrape-ideas-metrics.js`         | M365 Copilot workload WAU | M365 tab |
| `user-intent`| `fetch-user-intent.js`            | User intent categories/sub-categories (Kusto) | Features & Usage tab |
| `cogs`       | `scrape-cogs.js`                  | SPARK KA token cost (sessions, iTokens, cache, output) by (day, surface), Prod + Dogfood — incremental Kusto pull from `LLMAPIRequestTracingEvent_Global` | COGS tab |

## Requirements

- Microsoft Edge installed (auto-launched on port 9223 with the dedicated
  `MSFTReportingEdge` user-data-dir).
- One-time SSO: first run will require signing in with @microsoft.com to Nezha,
  Power BI (`msit.powerbi.com`), and SharePoint. Cookies persist in the
  dedicated profile.
- Azure CLI authenticated (`az login`) — required for `user-intent` (Kusto) and
  `ideas-*` (Graph) scrapers.

## Notes

- Run `/publish-report` after this skill completes to publish to SharePoint.
- `all-up` also scrapes Copilot competition data (non-fatal if it fails).
- `autofill` has a freshness guard — skips if scraped <20h ago. Force with
  `MIN_SCRAPE_AGE_HOURS=0 node scrape-autofill.js`.
- All Nezha/Power BI scrapers connect to Edge via CDP on port 9223 — no
  separate browser launch needed.
- Expected wall-clock: ~13–15 min in parallel (was ~47 min sequential).
  Floor is set by the slowest single scraper (`makers` ≈ 13 min).

# Copilot instructions — ODSP-AW (OneDrive SharePoint in Agentic Work)

This repo is a **data-reporting cockpit**, not a typical application. It tracks how OneDrive/SharePoint
integrations perform across M365 agentic surfaces (CoWork, Scout, Copilot Studio, SPARK) and turns that telemetry
into leadership reporting. Most work happens in a single HTML SPA plus a set of regeneration scripts.

## Architecture (the big picture)

Five parts work together — understanding the seams matters more than any one file:

- **`Data-Private/Data-Created/ODSP-AW-CC.html`** — the cockpit: a **single, self-contained HTML SPA**.
  State lives in inline JS data arrays (`progressBoard`, `memoLog`, `effortTicker`, `statusLog`, the
  governance/Standing-Asks tables, etc.) consumed by `render*` functions in the same file. This is the
  primary file you will edit.
- **`scripts/`** — Node + PowerShell that **regenerate derived pages from the CC** and run automation:
  `validate-cc.js` (syntax-gates the CC), `cc-maintenance.ps1` (validate → snapshot → rebuild
  indexes/memo pages/archives), `build-index.js`, `build-memo-pages.js`, `archive-decisions-activity.js`,
  `archive-eod.ps1` (lean flat archive), `refresh-odsp-aw-data.ps1` (7am data refresh).
- **`Data-Public/` vs `Data-Private/`** — the governance split (both gitignored). `Data-Public/` = scraped
  telemetry, **Agent / LT-Dashboard / Ops-safe**. `Data-Private/` = sensitive human source (recaps, notes,
  decks, grounding), **never read by the Agent or the LT Dashboard**. Never cross this boundary.
- **`OneDrive-SharePoint-in-Agentic-Work-Agent/`** — an **Agency CLI** agent. `agency.toml` wires the MCP
  Kusto servers; `context/data` is a junction to repo-root `Data-Public/`; each `skills/<name>/SKILL.md` is
  a packaged report workflow. **`OneDrive-SharePoint-in-Agentic-Work-Agent/AGENTS.md` is the canonical spec —
  read it before changing anything in the agent.**
- **`Data-Pipeline/`** — the scraper infra: Playwright/CDP
  scrapers + Kusto/IDEAS clients (`lib/`) that write into `Data-Public/`. Code only — `node_modules` is gitignored
  and regenerated on first run (`npm install`, self-healed by `refresh-odsp-aw-data.ps1`).

## Validate / run (there is no app build or unit-test suite)

The validation gate for the cockpit:

```
node scripts/validate-cc.js                  # validate ODSP-AW-CC.html inline <script> syntax (default target)
node scripts/validate-cc.js path/to/file.html  # validate any other HTML file's inline scripts
```

After editing the CC, run the maintenance pipeline (validate + snapshot + regenerate derived pages):

```
scripts/cc-maintenance.ps1                   # run with PowerShell
```

Data + agent:

```
scripts/refresh-odsp-aw-data.ps1             # data refresh: launches the Edge SSO debug profile, scrapes, posts findings
cd Data-Pipeline; npm install; node scrape-cowork.js   # scrapers — write to Data-Public/
cd OneDrive-SharePoint-in-Agentic-Work-Agent; agency copilot   # run the agent
```

## Conventions that are not obvious from one file

- **Always run `node scripts/validate-cc.js` after editing `ODSP-AW-CC.html`.** A syntax error in an inline
  script **aborts** the hourly/nightly jobs — `cc-maintenance.ps1` and `archive-eod.ps1` gate on it.
- **The CC is hand/agent-maintained, not generated.** Edit its inline data arrays directly; `build-index.js`
  and `build-memo-pages.js` then generate the linked index + per-entry pages **from** it — do not hand-edit
  the generated `Records/*.html`.
- **Memos** are `memoLog` entries (`{id:"M000NN", when, cat, q, a}`, newest-first). `a` is an HTML string —
  use **single-quoted** attributes and apostrophes, never a literal `"` inside. `build-memo-pages.js` emits
  `Records/M000NN.html` plus the `Records/ODSP-AW-CC-Memos.html` index.
- **Data integrity (hard rule):** never fabricate or alter a metric; every data point carries its date+time
  and method (scraped / ingested / live) and is verified before any insight. All times are **CST** and labelled.
- **Quality is DSAT% only:** show DSAT (the thumbs-down rate, lower is better — `down / (up + down)`), **never SAT / thumbs-up** — it keeps every surface + agent on one comparable scale.
- **Surface taxonomy (4-layer Reporting Taxonomy):** ODSP Surfaces (Copilot in OneDrive · Copilot in SharePoint — first-party) · ODSP Platform / Enabler (SPARK — the engine underneath) · Agents Calling ODSP (CoWork · Scout — external) · Builder (Copilot Studio — excluded from agent counts). Group and label by layer everywhere.
- **Scrapers write only to `Data-Public/`** (override the base dir with `ODSP_DATA_DIR`). The legacy per-scraper
  `data/` output folders are retired — never write data there.
- **Scheduling:** the recurring cadences run as **CLI-independent Windows Scheduled Tasks** (they fire even when
  the Copilot CLI is closed): hourly maintenance (`cc-maintenance.ps1`) + hourly git commit + hourly OneDrive
  mirror; the 7am data refresh; the 8:15am morning memo + Thu weekly reflection (headless agent tasks). The
  **EOD close-out (1:00 AM CST) + archive (1:45 AM CST) run as daily Windows tasks** (the close-out also runs the archive; can also be started on demand). Restore the tasks with
  `scripts/register-agent-tasks.ps1`; the registry is `automation/schedules.json` (see `automation/RESTORE-SCHEDULES.md`).
- **Resilience:** three nets — hourly git commit (code + docs) + hourly OneDrive mirror + the Data-Private off-OneDrive backup.
  The **Command Center, Dashboard, Records + the `data-provenance.txt` manifest now live under `Data-Private/Data-Created` (off git)**;
  their backup + point-in-time recovery come from the OneDrive mirror + the **off-OneDrive backup** (`scripts/backup-data-private.ps1`:
  a `/MIR` mirror + 14 dated zips, in place of git history). git still versions all **code, scripts + docs**. Only `node_modules` is uncovered (regenerable).
- **Memory policy (per Ambal, Jun 27):** do **NOT** store ODSP-AW-specific facts (cadences, infra, data,
  resilience, conventions) in **Copilot/agent memory** — keep it empty of ODSP-AW facts. The durable rules + facts
  live in the **Operations playbook** (the Command Center), **this file**, `AGENTS.md`, and the scripts. The
  playbook + these instructions are the single source — the agent uses them, it does not memorize them.
- **Commits:** short, descriptive subject lines; the repo also auto-commits hourly.

## Source-of-truth docs

- `OneDrive-SharePoint-in-Agentic-Work-Agent/AGENTS.md` — agent role, data classification, vocabulary, behaviour rules.
- `README.md` — repo structure + quick start.
- The Command Center **Operations tab** (Governance Principles + Standing Asks) — the living playbook of conventions and cadences.

# ODSP-in-Agentic-Work Scorecard — weekly refresh handoff

Self-contained bundle so a colleague can run the **weekly Scorecard refresh** while the owner is OOF.
The Scorecard is a leadership-shared, single-file HTML dashboard covering ODSP health across agent
surfaces (Cowork, Scout, Copilot Studio, …). The refresh is **agent-driven** (headless GitHub
Copilot CLI) because the numbers require judgment (source reconciliation), not a blind scrape.

> **Ground rules (do not break these):**
> 1. **Never fabricate a number.** If a source is unreachable, keep the prior value and log it PENDING.
> 2. **Do NOT auto-update the Cowork tab.** Only touch Cowork if pulled numbers *exactly* match the
>    Cowork dashboard; otherwise leave it and update it manually from Cowork screenshots.
> 3. **No personal names** anywhere on the dashboard — it is shared to leadership.
> 4. **Scout uses week-ending-Saturday trend values**, NOT the ClawpilotUsage headline KPI cards
>    (e.g. WAU for the week Jul 5–11 = **23,216**, not the 24.1K "as-of pull date" card).

## Layout

```
odsp-aw-scorecard/
├─ README.md                                  ← you are here
├─ dashboard/
│  ├─ ODSP-in-Agentic-Work-Scorecard.html     ← the live dashboard (current source of truth)
│  └─ archive/odsp-scorecard-<date>.html       ← weekly snapshots (Sat week-ending dates)
├─ refresh/
│  ├─ run-weekly-refresh.ps1                   ← the wrapper the scheduled task runs
│  ├─ weekly-refresh-prompt.txt                ← instructions handed to the headless agent
│  └─ register-refresh-task.ps1               ← registers the Sunday 07:30 scheduled task
└─ data-pipeline/
   ├─ scrape-scout-clawpilot.js                ← Scout ClawpilotUsage scraper (CDP/Playwright)
   ├─ package.json                             ← node deps (playwright, azure-kusto-data, …)
   └─ clawpilot-capture/dashboard-data.json    ← last-known-good Scout data (seed / fallback)
```

## Prerequisites (one time, on the host machine)

| Tool | Why | Install |
|---|---|---|
| **GitHub Copilot CLI** (`copilot.exe`) | drives the headless refresh | `winget install GitHub.Copilot` then sign in (`copilot`, `/login`) |
| **Node.js 18+** | runs the Scout scraper | `winget install OpenJS.NodeJS.LTS` |
| **Playwright browsers** | scraper connects over CDP | in `data-pipeline/`: `npm install` then `npx playwright install` |
| **Azure CLI** (`az`) | Kusto / CS pulls | `winget install Microsoft.AzureCLI`, then `az login` as your corp account |
| **Microsoft Edge** | debug browser for SSO scrape | already on Windows |
| **git** | commit/push refreshed dashboard | already available |

## One-time setup

```powershell
# 1. Clone (or pull) this repo
git clone https://github.com/souji19-ship-it/-odsp-cx-dashboard-.git
cd -odsp-cx-dashboard-\odsp-aw-scorecard

# 2. Scraper deps
cd data-pipeline
npm install
npx playwright install
cd ..

# 3. Sign in to the tools you'll need
az login                     # corp account with Kusto/CSC access
copilot                      # run once, /login, then exit

# 4. First-time SSO for the Scout scraper — launch the dedicated debug Edge profile and sign in ONCE
#    (the wrapper reuses this MSFTReportingEdge profile so later runs are seamless)
& 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' `
    --remote-debugging-port=9222 --user-data-dir="$env:LOCALAPPDATA\MSFTReportingEdge" `
    --no-first-run --no-default-browser-check
#    In that window, open https://askideas.microsoft.net/provisional/ClawpilotUsage and complete SSO.

# 5. Register the Sunday 07:30 scheduled task (run PowerShell AS ADMIN)
cd refresh
.\register-refresh-task.ps1 -WakeToRun
```

## How the weekly refresh works

Every **Sunday 07:30 local time** the scheduled task runs `run-weekly-refresh.ps1`, which:

1. Ensures debug Edge is up on CDP `:9222` (auto-launches the SSO profile if needed).
2. Notes the `az` identity (for Kusto/CS pulls).
3. Substitutes the real paths into `weekly-refresh-prompt.txt` and invokes the Copilot CLI headless
   (`copilot -p <prompt> --allow-all-tools --no-ask-user`).
4. The agent refreshes **Scout** and **Copilot Studio** for the two most recent complete **Sun–Sat**
   weeks (this-wk vs last-wk, WoW), regenerates that week's **archive** snapshot, verifies the page
   still renders, and (by default) **git commits + pushes** the updated dashboard to `origin/main`.
5. Logs to `refresh/logs/weekly-refresh-<date>.log` and appends a one-liner to
   `refresh/logs/refresh-status.txt`.

**Cowork is deliberately left untouched** unless numbers exactly match the Cowork dashboard.

## Running it on demand (manual)

```powershell
cd odsp-aw-scorecard\refresh
.\run-weekly-refresh.ps1                    # refresh the in-repo dashboard + commit/push
```

Point it at a dashboard that lives in OneDrive instead (and skip the git commit):

```powershell
.\run-weekly-refresh.ps1 `
  -DashboardPath "C:\Users\<you>\OneDrive - Microsoft\ODSP-AW-Dashboard\ODSP-in-Agentic-Work-Scorecard.html" `
  -NoCommit
```

## Machine-state requirements

- **Locked is fine** — an Interactive-logon task runs while the screen is locked.
- The task will **not** run if the user is **signed out**. Keep the host **powered on and signed in**.
- `register-refresh-task.ps1 -WakeToRun` wakes the machine from sleep to run; otherwise a missed run
  catches up on next wake (`StartWhenAvailable`).

## Data sources & known access gaps

Scout all-up comes from the IDEAS provisional **ClawpilotUsage** dashboard
(`https://askideas.microsoft.net/provisional/ClawpilotUsage`), scraped via debug Edge. ODSP-in-Scout
and Copilot Studio signals come from Kusto (CSC prod `fdislandscscprduswus/CSCAnalytics`; CS
CAPAnalytics / `csinternaltelemetry`) and the Omega scorecards (`https://qh.microsoft.com/omega/scorecards`).

| Surface / signal | Status | Gap / ask |
|---|---|---|
| Scout all-up (ClawpilotUsage) | 🟢 via CDP scrape | needs first-run SSO in the debug Edge profile |
| Scout ODSP reach/perf (CSC Kusto) | 🟢 if `az` reachable | official scenario taxonomy still pending (GHE repos 401) |
| Copilot Studio all-up + ODSP | 🟡 partial | no durable Kusto reader on Silver/csinternaltelemetry; history ~30d |
| CS / Scout DSAT attributed to ODSP | 🔴 not available | thumbs are session-level, not tool-level (design constraint) |
| Cowork | ⛔ manual only | do not auto-update; owner supplies screenshots |
| COGS / $ per session | 🔴 blocked | `inferencedashboardlog.westus2` — no DB grant |

If a source is down on a given Sunday, the agent keeps the prior value and marks it **PENDING** in
`refresh/logs/refresh-status.txt` — that is expected behaviour, not an error.

## Troubleshooting

- **Scout numbers didn't move** → debug Edge SSO expired. Re-run step 4 (sign in once), then re-run
  the refresh manually.
- **CS/Kusto skipped** → `az login` expired. Re-authenticate, re-run.
- **Task didn't fire** → machine was signed out or off. Check `refresh/logs/` and
  `Get-ScheduledTaskInfo -TaskName ODSP-AW-Dashboard-Refresh`.
- **Page won't render after a run** → an embedded `</script>` escaped the snapshot. The prompt
  requires `</` → `<\/` when re-serializing `window.SNAP`; restore the newest `.bak` next to the
  dashboard and re-run.

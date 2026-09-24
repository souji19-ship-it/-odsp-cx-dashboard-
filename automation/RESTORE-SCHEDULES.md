# Restoring the ODSP-AW Automation Cadences

There are **two kinds** of cadence, restored two different ways:

1. **Copilot CLI scheduled prompts** — need the live CLI conversation/session context. They live in
   **CLI state, not this repo**, so they vanish on a state reset.
2. **Headless agent Windows Scheduled Tasks** — run `scripts/run-agent-prompt.ps1` (which calls
   `copilot -p`) so the heavier daily/weekly judgment cadences fire **reliably even when no
   interactive CLI is open**. These are OS-level tasks, recreated with one script.

`automation/schedules.json` is the **source of truth** for both.

---

## 1) CLI scheduled prompts (still active)

Only two remain as CLI prompts, because they depend on the live conversation:

| id | cron | when | what it does |
|----|------|------|--------------|
| `hourly-cc-maintenance` | `0 * * * *` | top of every hour | **Judgment only:** audit the "What I Am Working On" board + roll the **Daily Effort Ticker**, then run `scripts/cc-maintenance.ps1`. The deterministic upkeep also runs as the **ODSP-AW-Hourly-Maintenance** Windows task (CLI-independent). |
| `morning-attention` | `0 8 * * *` | 8:00 AM CST daily | Keep the consolidated **"What Needs You"** list (`needFromYou`) in the Tracker current — add new must-acts, re-verify statuses/priority, mark resolved. |

### Restore
Tell the agent:

> **"recreate the CLI schedules from automation/schedules.json"**

The agent reads the `cliSchedules` array and registers each with its `cron` + `prompt`.

---

## 2) Headless agent Windows tasks (the daily/weekly cadences)

| task | trigger | prompt file | what it does |
|------|---------|-------------|--------------|
| `ODSP-AW-Morning-Memo` | Daily 8:15 AM | `automation/prompts/morning-memo.txt` | ONE consolidated daily morning memo (Verdict, State of the Union, Good/Bad, Act/Watch/Amplify, New Findings, Data Freshness, **Pending + What I Need From You**). |
| `ODSP-AW-EOD-Closeout` | **Daily 1:00 AM CST** | `automation/prompts/eod-closeout.txt` | Governance reconcile + Data Health re-verify + **Audit History row** + finalize for the morning memo + `cc-maintenance` + `archive-eod`. Can also be started on demand. |
| `ODSP-AW-Weekly-Reflection` | Thu 10:30 PM | `automation/prompts/weekly-reflection.txt` | Weekly reflection memo (Cadence · Skills · Memory). 20-min cap; clears well before the 1am EOD. |

Each task runs (user `ambalb`, LogonType `Interactive`, RunLevel `Limited`, `StartWhenAvailable`):

```
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden ^
  -File scripts\run-agent-prompt.ps1 -PromptFile automation\prompts\<file> -Name <name>
```

`run-agent-prompt.ps1` pulls latest, invokes
`copilot -p <prompt> --allow-all-tools --allow-all-paths --no-ask-user -s`, then safety-net
commits + pushes (with one pull-rebase retry) and logs to `automation/agent-logs/` (gitignored,
pruned after 30 days).

### Restore
```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\register-agent-tasks.ps1
```
This (re)registers all three tasks idempotently (`-Force`). Verify with:
```powershell
Get-ScheduledTask ODSP-AW-Morning-Memo,ODSP-AW-EOD-Closeout,ODSP-AW-Weekly-Reflection |
  ForEach-Object { $_ | Get-ScheduledTaskInfo } | Select TaskName,NextRunTime
```

> **Security note:** these tasks run the agent **autonomously with full tool access**
> (`--allow-all-tools --allow-all-paths --no-ask-user`). The prompt files are trusted + repo-scoped.

---

## 3) Deterministic Windows tasks (unchanged)

Pure scripts, no agent — listed for completeness:
`ODSP-AW-Daily-Refresh` (7am → `refresh-odsp-aw-data.ps1`),
`ODSP-AW-EOD-Archive` (**daily 1:45 AM CST**, a backstop after the 1am close-out, which also runs it → `archive-eod.ps1`),
`ODSP-AW-Hourly-Maintenance` (hourly → `cc-maintenance.ps1`),
`ODSP-AW-Hourly-Commit` (hourly → `hourly-git-commit.ps1`),
`ODSP-AW-OneDrive-Backup` (hourly → `backup-to-onedrive.ps1`).

---

## Retired cadences
- `nightly-governance-reconcile` (CLI) → now the **ODSP-AW-EOD-Closeout** Windows task.
- morning-memo / weekly-reflection (CLI) → now the **ODSP-AW-Morning-Memo** / **ODSP-AW-Weekly-Reflection** Windows tasks.
- `friday-pulse-prep`, `monthly-mbr` → the Comms / Inform-Team Pulse + MBR cards were retired; no longer standing cadences.

## Why it's robust
- **Thin prompts, version-controlled scripts.** All brittle logic lives in `scripts/` and resolves
  paths from `$PSScriptRoot` / `__dirname`, so a repo rename or move never breaks them.
- **CLI-independent.** The daily/weekly judgment cadences no longer depend on an interactive CLI
  being open + idle; `StartWhenAvailable` catches up a missed run at next logon.
- **Validated.** `cc-maintenance.ps1` runs `validate-cc.js` (and `smoke-cc.js`) first and aborts on a
  broken edit, so a bad change never propagates to the archives.

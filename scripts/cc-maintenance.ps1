# Hourly ODSP-AW Command Center maintenance — repo-root-relative so a rename never breaks it.
# Validates the CC inline scripts and regenerates the
# Decisions + Activity Log archives and the index pages. Silent and idempotent.
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$hub  = Join-Path $root 'Data-Private\Data-Created'
$cc   = Join-Path $hub  'ODSP-AW-CC.html'

# 0b. Refresh the Data Health + Audit "last checked" stamps (deterministic; keeps them current hourly).
node (Join-Path $PSScriptRoot 'stamp-data-health.js')

# 0c. Refresh Backup & Resilience status from the REAL Windows backup tasks (last/next run + result).
& (Join-Path $PSScriptRoot 'stamp-backup-status.ps1')

# 0d. Keep the Daily Effort Ticker's row mechanics current (deterministic; never freezes when the CLI is closed).
node (Join-Path $PSScriptRoot 'roll-ticker.js')

# 0e. Run-watchdog: surface a daily cadence that has run before but went stale (>26h) or failed (a silent regression).
& (Join-Path $PSScriptRoot 'run-watchdog.ps1')

# 1. Validate the Command Center's inline scripts; abort if broken.
node (Join-Path $PSScriptRoot 'validate-cc.js')
if ($LASTEXITCODE -ne 0) { Write-Error 'Command Center validation FAILED - aborting maintenance.'; exit 1 }
# 1b. Runtime smoke test (proxy-mock DOM) - non-blocking; warns if the render path throws at load.
node (Join-Path $PSScriptRoot 'smoke-cc.js')
if ($LASTEXITCODE -ne 0) { Write-Warning 'Command Center SMOKE test failed (render path threw) - investigate.' }

# 2. Regenerate the Decisions + Activity Log archives and the index pages.
node (Join-Path $PSScriptRoot 'archive-decisions-activity.js')
node (Join-Path $PSScriptRoot 'build-index.js')

# 4. Regenerate the per-memo pages (Records/M0000N.html) so every memo is a linked page.
node (Join-Path $PSScriptRoot 'build-memo-pages.js')

Write-Host "CC maintenance complete: validated + archives/indexes regenerated."

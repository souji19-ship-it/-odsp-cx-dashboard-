<#
  run-weekly-refresh.ps1  --  Weekly ODSP-AW Scorecard refresh (Sunday 07:30 America/Los_Angeles).

  PORTABLE handoff version: nothing is hard-coded to a specific user. Paths are auto-detected
  relative to this script (the odsp-aw-scorecard bundle) and can be overridden with parameters.

  Runs the dashboard refresh HEADLESS via the Copilot CLI, driven by weekly-refresh-prompt.txt.
  Refreshes SCOUT + COPILOT STUDIO for the two most recent Sun-Sat weeks and keeps the archive
  links current. Deliberately does NOT auto-update Cowork (see the prompt).

  Steps:
    1. Ensure debug Edge is up on CDP :9222 (dedicated SSO profile) so the Scout ClawpilotUsage
       scraper + any Kusto web pulls authenticate seamlessly.
    2. Note az identity (Kusto pulls use az / DefaultAzureCredential).
    3. Materialize the prompt (substitute {{DASHBOARD}} / {{ARCHIVE}} / {{PIPELINE}} / {{COMMIT}} tokens).
    4. Invoke copilot -p <prompt> autonomously against the bundle root.
    5. Log to refresh\logs\weekly-refresh-<date>.log.

  Register / re-point via register-refresh-task.ps1 (Sunday 07:30 PT).

  USAGE (examples):
    # default: refresh the dashboard shipped inside this repo bundle, then git commit+push
    .\run-weekly-refresh.ps1

    # point at a dashboard that lives in OneDrive instead (no git commit)
    .\run-weekly-refresh.ps1 -DashboardPath "C:\Users\me\OneDrive - Microsoft\ODSP-AW-Dashboard\ODSP-in-Agentic-Work-Scorecard.html" -NoCommit
#>
[CmdletBinding()]
param(
  # Full path to the dashboard HTML to refresh. Default = the copy in this repo bundle.
  [string]$DashboardPath,
  # Archive folder holding odsp-scorecard-<date>.html snapshots. Default = <dashboard dir>\archive.
  [string]$ArchiveDir,
  # data-pipeline folder containing scrape-scout-clawpilot.js. Default = bundle data-pipeline.
  [string]$PipelineDir,
  # Path to copilot.exe. Default = auto-detect (Get-Command, then WinGet install location).
  [string]$Copilot,
  # If set, the refresh will NOT git commit+push (use when the dashboard lives outside the repo, e.g. OneDrive).
  [switch]$NoCommit
)
$ErrorActionPreference = 'Continue'
$refDir  = $PSScriptRoot
$bundle  = Split-Path $refDir -Parent                 # ...\odsp-aw-scorecard
$repoRoot = (& git -C $bundle rev-parse --show-toplevel 2>$null); if (-not $repoRoot) { $repoRoot = $bundle }

if (-not $DashboardPath) { $DashboardPath = Join-Path $bundle 'dashboard\ODSP-in-Agentic-Work-Scorecard.html' }
$dashDir = Split-Path $DashboardPath -Parent
if (-not $ArchiveDir)    { $ArchiveDir  = Join-Path $dashDir 'archive' }
if (-not $PipelineDir)   { $PipelineDir = Join-Path $bundle 'data-pipeline' }

# copilot.exe auto-detect
if (-not $Copilot) {
  $c = (Get-Command copilot -ErrorAction SilentlyContinue).Source
  if (-not $c) { $c = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages\GitHub.Copilot_Microsoft.Winget.Source_8wekyb3d8bbwe\copilot.exe' }
  $Copilot = $c
}
$prompt  = Join-Path $refDir 'weekly-refresh-prompt.txt'
$cdpUrl  = 'http://localhost:9222/json/version'
$doCommit = (-not $NoCommit)

$logDir = Join-Path $refDir 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("weekly-refresh-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd_HHmm'))
function Log($m){ $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m; $line | Tee-Object -FilePath $log -Append }

Log '========== ODSP-AW weekly refresh: START (Scout + CS; Cowork left as-is) =========='
Log "dashboard : $DashboardPath"
Log "archive   : $ArchiveDir"
Log "pipeline  : $PipelineDir"
Log "copilot   : $Copilot"
Log "git commit: $doCommit (repo root: $repoRoot)"

if (-not (Test-Path $prompt))        { Log "FATAL: prompt not found: $prompt"; exit 1 }
if (-not (Test-Path $Copilot))       { Log "FATAL: copilot.exe not found: $Copilot"; exit 1 }
if (-not (Test-Path $DashboardPath)) { Log "FATAL: dashboard not found: $DashboardPath"; exit 1 }

# 1. Debug Edge on CDP 9222 (auto-launch dedicated SSO profile if down)
function Test-Cdp { try { $null = Invoke-WebRequest -Uri $cdpUrl -TimeoutSec 6 -UseBasicParsing; return $true } catch { return $false } }
if (Test-Cdp) { Log 'Debug Edge (CDP 9222): UP' }
else {
  Log 'Debug Edge (CDP 9222): down - launching dedicated debug profile (MSFTReportingEdge, seamless SSO)...'
  $udd  = Join-Path $env:LOCALAPPDATA 'MSFTReportingEdge'
  $edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
  if (Test-Path $edge) {
    Start-Process $edge -ArgumentList "--remote-debugging-port=9222","--user-data-dir=`"$udd`"","--no-first-run","--no-default-browser-check"
    for ($i = 0; $i -lt 12; $i++) { Start-Sleep -Seconds 3; if (Test-Cdp) { break } }
  }
  if (Test-Cdp) { Log 'Debug Edge: launched + reachable on 9222' }
  else { Log 'Debug Edge: could NOT reach 9222 - Scout scraper may be skipped (agent will keep prior numbers).' }
}

# 2. az identity (Kusto / CS pulls)
$who = (az account show --query user.name -o tsv 2>$null)
if ($who) { Log "az identity: $who" } else { Log "WARN: az not logged in - CS/Kusto pulls may be skipped (run 'az login')." }

# 3. Materialize the prompt with resolved paths
$promptText = Get-Content $prompt -Raw -Encoding utf8
$commitLine = if ($doCommit) {
  "After a successful refresh, git add + commit + push the updated dashboard/archive from the repo root ($repoRoot) to origin/main with a message like 'Weekly refresh <SAT>: Scout+CS'."
} else {
  "Do NOT git commit; the dashboard lives outside the repo (e.g. OneDrive) and syncs on its own. Save in place only."
}
$promptText = $promptText.
  Replace('{{DASHBOARD}}', $DashboardPath).
  Replace('{{ARCHIVE}}',   $ArchiveDir).
  Replace('{{PIPELINE}}',  $PipelineDir).
  Replace('{{COMMIT}}',    $commitLine)
$matPrompt = Join-Path $logDir ("prompt-{0}.txt" -f (Get-Date -Format 'yyyy-MM-dd_HHmm'))
$promptText | Out-File -FilePath $matPrompt -Encoding utf8

# 4. Headless Copilot refresh (run from the repo root so git operations resolve)
Log "Running weekly refresh headless via copilot -p (cwd: $repoRoot)"
& $Copilot -p $promptText --allow-all-tools --allow-all-paths --no-ask-user -C $repoRoot 2>&1 | Tee-Object -FilePath $log -Append
Log "copilot finished (exit $LASTEXITCODE)"

# 5. Prune logs older than 60 days
Get-ChildItem $logDir -Filter *.log -EA SilentlyContinue | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-60) } | Remove-Item -Force -EA SilentlyContinue
Log '========== ODSP-AW weekly refresh: DONE =========='

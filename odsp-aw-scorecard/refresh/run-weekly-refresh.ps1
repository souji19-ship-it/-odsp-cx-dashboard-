<#
  run-weekly-refresh.ps1  --  Weekly ODSP-AW Scorecard refresh (Sunday 07:30 America/Los_Angeles).

  Runs the dashboard refresh HEADLESS via the Copilot CLI, driven by weekly-refresh-prompt.txt.
  Refreshes SCOUT + COPILOT STUDIO for the two most recent Sun-Sat weeks and keeps the archive
  links current. Deliberately does NOT auto-update Cowork (see the prompt).

  1. Ensure debug Edge is up on CDP :9222 (dedicated MSFTReportingEdge SSO profile) so the Scout
     ClawpilotUsage scraper + any Kusto web pulls can authenticate seamlessly.
  2. Note az identity (Kusto pulls use az / DefaultAzureCredential).
  3. Invoke copilot -p <prompt> autonomously against the repo, targeting the OneDrive dashboard.
  4. Log to refresh\logs\weekly-refresh-<date>.log.

  Register / re-point via the scheduled task ODSP-AW-Dashboard-Refresh (Sunday 07:30 PT).
#>
$ErrorActionPreference = 'Continue'
$dashDir = 'C:\Users\v-sogattu\OneDrive - Microsoft\ODSP-AW-Dashboard'
$refDir  = Join-Path $dashDir 'refresh'
$prompt  = Join-Path $refDir 'weekly-refresh-prompt.txt'
$repo    = 'C:\Users\v-sogattu\Repo\CXAgent\OneDrive-SharePoint-in-Agentic-Work-main'
$copilot = 'C:\Users\v-sogattu\AppData\Local\Microsoft\WinGet\Packages\GitHub.Copilot_Microsoft.Winget.Source_8wekyb3d8bbwe\copilot.exe'
$cdpUrl  = 'http://localhost:9222/json/version'

$logDir = Join-Path $refDir 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("weekly-refresh-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd_HHmm'))
function Log($m){ $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m; $line | Tee-Object -FilePath $log -Append }

Log '========== ODSP-AW weekly refresh: START (Scout + CS; Cowork left as-is) =========='

if (-not (Test-Path $prompt))  { Log "FATAL: prompt not found: $prompt"; exit 1 }
if (-not (Test-Path $copilot)) { Log "FATAL: copilot.exe not found: $copilot"; exit 1 }

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
if ($who) { Log "az identity: $who" } else { Log "WARN: az not logged in - CS/Kusto pulls may be skipped (run 'az login' as v-sogattu@microsoft.com)." }

# 3. Headless Copilot refresh
$promptText = Get-Content $prompt -Raw -Encoding utf8
Log "Running weekly refresh headless via copilot -p (repo: $repo)"
& $copilot -p $promptText --allow-all-tools --allow-all-paths --no-ask-user -C $repo 2>&1 | Tee-Object -FilePath $log -Append
Log "copilot finished (exit $LASTEXITCODE)"

# 4. Prune logs older than 60 days
Get-ChildItem $logDir -Filter *.log -EA SilentlyContinue | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-60) } | Remove-Item -Force -EA SilentlyContinue
Log '========== ODSP-AW weekly refresh: DONE =========='

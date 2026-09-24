<#
  refresh-odsp-aw-data.ps1
  ODSP-AW daily data refresh + data-overhaul pipeline - scheduled for 7:00 AM CST.

  Steps:
    1. Verify debug Edge is reachable on CDP port 9222 - auto-launches the dedicated
       MSFTReportingEdge profile (seamless corp SSO) if it's not already running.
    2. Run CoWork scraper, SPARK tool-health, and Copilot-in-SP (skills) scraper.
    3. Run a lightweight drift check on Data-Public/cowork/tools.json.
    4. Post morning findings (Good News vs Issues) onto the ODSP, Ambal, and Pulse dashboards.
    5. Write Data-Public/refresh-status.json (read by the Command Center) and append to a log.

  If debug Edge is not running, scrape steps are skipped (recorded as skipped), not failed.
  Start debug Edge with:
    msedge.exe --remote-debugging-port=9222 --user-data-dir="%LOCALAPPDATA%\MSFTReportingEdge"
#>

$ErrorActionPreference = 'Continue'
$root       = 'C:\Repo\OneDrive-SharePoint-in-Agentic-Work'
$reporting  = Join-Path $root 'Data-Pipeline'
$logFile    = Join-Path $root 'scripts\refresh-log.txt'
$statusFile = Join-Path $root 'Data-Public\refresh-status.json'
$cdpUrl     = 'http://localhost:9222/json/version'
$scraperTimeoutSec = 240

function Write-Log([string]$msg) {
  $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  $line = "$ts  $msg"
  Add-Content -Path $logFile -Value $line
  Write-Host $line
}

# Run "node <script>" in <workdir> with a hard timeout (seconds).
# The Playwright scrapers connect over CDP and may not exit cleanly, so we
# cap each one and kill it if it overruns. Returns out/exit/timedOut.
function Invoke-NodeWithTimeout([string]$workdir, [string]$script, [int]$timeoutSec) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName               = 'node'
  $psi.Arguments              = $script
  $psi.WorkingDirectory       = $workdir
  $psi.UseShellExecute        = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError  = $true
  $psi.CreateNoWindow         = $true
  $p = [System.Diagnostics.Process]::Start($psi)
  $outTask = $p.StandardOutput.ReadToEndAsync()
  $errTask = $p.StandardError.ReadToEndAsync()
  if ($p.WaitForExit($timeoutSec * 1000)) {
    $text = ''
    try { $text = ($outTask.Result + $errTask.Result) } catch {}
    return @{ exit = $p.ExitCode; out = $text; timedOut = $false }
  }
  try { $p.Kill() } catch {}
  Start-Sleep -Milliseconds 500
  $text = ''
  try { $text = ($outTask.Result + $errTask.Result) } catch {}
  return @{ exit = $null; out = $text; timedOut = $true }
}

$status = [ordered]@{
  startedAt = (Get-Date).ToString('o')
  edgeUp    = $false
  steps     = @()
  ok        = $false
}

Write-Log '========== ODSP-AW daily refresh: START =========='

# 1. Debug Edge reachable? Auto-launch the dedicated SSO profile if not (autonomous data access).
function Test-Cdp { try { $null = Invoke-WebRequest -Uri $cdpUrl -TimeoutSec 6 -UseBasicParsing; return $true } catch { return $false } }
if (Test-Cdp) {
  $status.edgeUp = $true
  Write-Log 'Debug Edge (CDP 9222): UP'
} else {
  Write-Log 'Debug Edge (CDP 9222): down - launching dedicated debug profile (MSFTReportingEdge, seamless SSO)...'
  $udd  = Join-Path $env:LOCALAPPDATA 'MSFTReportingEdge'
  $edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
  if (Test-Path $edge) {
    Start-Process $edge -ArgumentList "--remote-debugging-port=9222","--user-data-dir=`"$udd`"","--no-first-run","--no-default-browser-check"
    for ($i = 0; $i -lt 12; $i++) { Start-Sleep -Seconds 3; if (Test-Cdp) { break } }
  }
  if (Test-Cdp) { $status.edgeUp = $true; Write-Log 'Debug Edge: launched + reachable on 9222' }
  else { Write-Log 'Debug Edge: could not launch/reach 9222 - scrape steps skipped' }
}

# 2. Scrapers (CoWork, SPARK, Copilot-in-SP)

# Self-heal: Data-Pipeline ships code only (node_modules is gitignored/regenerable). On a fresh checkout
# the first run installs deps once (~tens of MB). Scrapers use chromium.connectOverCDP to the external
# debug Edge, so no Playwright browser engines are needed - we skip that download to stay lean + fast.
$nodeModules = Join-Path $reporting 'node_modules'
if ((Test-Path $reporting) -and -not (Test-Path $nodeModules)) {
  Write-Log 'Data-Pipeline\node_modules missing - installing scraper deps (one-time, browsers skipped)...'
  Push-Location $reporting
  try {
    $env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1'
    & npm install --no-audit --no-fund 2>&1 | Out-Null
    if (Test-Path $nodeModules) { Write-Log 'Scraper deps installed.' }
    else { Write-Log 'WARN: npm install did not create node_modules - scrapes may be skipped.' }
  } catch { Write-Log ('npm install error: ' + $_) }
  Pop-Location
}

$scrapers = @(
  @{ name = 'cowork';            script = 'scrape-cowork.js' },
  @{ name = 'spark-tool-health'; script = 'fetch-spark-tool-health.js' },
  @{ name = 'copilot-in-sp';     script = 'scrape-skills.js' }
)

foreach ($s in $scrapers) {
  $path = Join-Path $reporting $s.script
  if (-not (Test-Path $path)) {
    Write-Log ("Scraper '" + $s.name + "': script not found (" + $s.script + ") - skipped")
    $status.steps += @{ step = $s.name; ran = $false; reason = 'script not found' }
    continue
  }
  if (-not $status.edgeUp) {
    $status.steps += @{ step = $s.name; ran = $false; reason = 'Edge CDP down' }
    continue
  }
  Write-Log ("Running scraper '" + $s.name + "' (" + $s.script + ", " + $scraperTimeoutSec + "s cap)...")
  $r = Invoke-NodeWithTimeout $reporting $s.script $scraperTimeoutSec
  if ($r.out) { Write-Log ($r.out.Trim()) }
  if ($r.timedOut) {
    Write-Log ("Scraper '" + $s.name + "': TIMED OUT after " + $scraperTimeoutSec + "s - killed (CDP scrapers may not exit cleanly; verify output files)")
    $status.steps += @{ step = $s.name; ran = $true; timedOut = $true }
  } else {
    $status.steps += @{ step = $s.name; ran = $true; exit = $r.exit }
  }
}

# 2b. CoWork re-auth surfacing: if the scraper hit a hard corp re-auth it could not self-heal,
#     auto-surface a "What Needs You" item in the Command Center (and resolve it once it self-heals).
$reauthHelper = Join-Path $root 'scripts\surface-cowork-reauth.js'
if (Test-Path $reauthHelper) {
  $r = Invoke-NodeWithTimeout (Join-Path $root 'scripts') 'surface-cowork-reauth.js' 30
  if ($r.out) { Write-Log ('CoWork re-auth check: ' + $r.out.Trim()) }
}

# 3. Lightweight drift check on Data-Public/cowork/tools.json
$cowork = Join-Path $root 'Data-Public\cowork\tools.json'
if (Test-Path $cowork) {
  try {
    $rows = (Get-Content $cowork -Raw | ConvertFrom-Json)
    $count = ($rows.PSObject.Properties | Measure-Object).Count
    Write-Log ("Drift check: Data-Public/cowork/tools.json present, " + $count + " records")
    $status.steps += @{ step = 'drift-check'; ran = $true; records = $count }
  } catch {
    Write-Log 'Drift check: tools.json unreadable/invalid JSON'
    $status.steps += @{ step = 'drift-check'; ran = $true; error = 'invalid json' }
  }
} else {
  Write-Log 'Drift check: Data-Public/cowork/tools.json not found'
  $status.steps += @{ step = 'drift-check'; ran = $false; reason = 'tools.json missing' }
}

# 4. Findings now surface in the 8:15am morning memo (New Findings section), not injected into dashboards.
#    The dashboards are self-contained verified artifacts; inject-findings.js was retired Jun 28, 2026.
$status.steps += @{ step = 'morning-findings'; ran = $false; reason = 'retired - findings now live in the morning memo' }

# 4b. Stamp the audit re-verify date - the 7am refresh re-verifies data freshness + the audit.
node 'C:\Repo\OneDrive-SharePoint-in-Agentic-Work\scripts\stamp-data-health.js' --audit

# 5. Write status + finish
$status.finishedAt = (Get-Date).ToString('o')
$status.ok = $status.edgeUp
$status | ConvertTo-Json -Depth 6 | Set-Content -Path $statusFile -Encoding UTF8
Write-Log ("Wrote status -> " + $statusFile)
Write-Log '========== ODSP-AW daily refresh: DONE =========='

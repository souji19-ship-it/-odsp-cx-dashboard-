#  run-watchdog.ps1 - verify the daily agent cadences actually fired. If a daily task has not run in
#  >26h or its last result was a failure, surface a "What Needs You" item so a silent miss never goes
#  unnoticed (and resolve it once the cadence runs again). Called hourly by cc-maintenance.ps1.
$ErrorActionPreference = 'Continue'
$daily = 'ODSP-AW-Daily-Refresh', 'ODSP-AW-Morning-Memo', 'ODSP-AW-EOD-Closeout'   # all daily-timer cadences (EOD-Closeout = 1:00 AM)
$now = Get-Date
$missed = @()
foreach ($name in $daily) {
  $info = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue | Get-ScheduledTaskInfo -ErrorAction SilentlyContinue
  if (-not $info) { continue }
  $last = $info.LastRunTime
  $res  = $info.LastTaskResult
  # Skip tasks that have never run (year < 2000 sentinel / result 267011) - newly registered or run
  # another way; only flag a cadence that HAS run before but went stale or failed (a silent regression).
  if (-not $last -or $last.Year -lt 2000) { continue }
  $hrs  = ($now - $last).TotalHours
  $okResult = ($res -eq 0 -or $res -eq 267009)   # 0 = success, 267009 = currently running
  if ($hrs -gt 26 -or -not $okResult) {
    $when = $last.ToString('MMM d h:mm tt')
    $missed += ("{0} (last {1}, result {2})" -f $name, $when, $res)
  }
}
$summary = ($missed -join '; ')
$helper = Join-Path $PSScriptRoot 'surface-watchdog.js'
if (Test-Path $helper) { & node $helper $summary }

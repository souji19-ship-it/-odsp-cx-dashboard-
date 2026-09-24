# Refreshes backupStatus in ODSP-AW-CC.html from the REAL Windows backup tasks, so the
# "Backup & Resilience Status" card shows the actual last/next run + result + a live "verified"
# time -- never a hand-set value. Deterministic; run hourly by cc-maintenance.ps1 (+ the
# ODSP-AW-Hourly-Maintenance Windows task), so it stays current even when the Copilot CLI is closed.
$ErrorActionPreference = 'Stop'
$cc = (Resolve-Path (Join-Path $PSScriptRoot '..\Data-Private\Data-Created\ODSP-AW-CC.html')).Path
$cst = [System.TimeZoneInfo]::FindSystemTimeZoneById('Central Standard Time')
function To-CST([datetime]$dt) { [System.TimeZoneInfo]::ConvertTime($dt, $cst) }

$defs = @(
  @{ label = 'Local git commit'; task = 'ODSP-AW-Hourly-Commit';   cadence = 'every hour (~:50)' },
  @{ label = 'OneDrive mirror';  task = 'ODSP-AW-OneDrive-Backup'; cadence = 'every hour (~:55)' }
)
$tasks = foreach ($d in $defs) {
  $info = $null
  try { $info = Get-ScheduledTask -TaskName $d.task -ErrorAction Stop | Get-ScheduledTaskInfo } catch {}
  $last = if ($info -and $info.LastRunTime) { (To-CST $info.LastRunTime).ToString('h:mm tt') } else { '--' }
  $next = if ($info -and $info.NextRunTime) { (To-CST $info.NextRunTime).ToString('h:mm tt') } else { '--' }
  $res  = if ($info -and $info.LastTaskResult -eq 0) { 'ok' } elseif ($info) { 'error 0x{0:X}' -f $info.LastTaskResult } else { 'unknown' }
  [ordered]@{ label = $d.label; task = $d.task; cadence = $d.cadence; last = $last; next = $next; result = $res }
}
$nowCst = To-CST (Get-Date)
$verified = $nowCst.ToString('MMM d, yyyy') + ' ' + [char]0x00B7 + ' ' + $nowCst.ToString('h:mm tt') + ' CST'
$json = ([ordered]@{ verified = $verified; tasks = @($tasks) } | ConvertTo-Json -Compress -Depth 6)

$html = [System.IO.File]::ReadAllText($cc)
$pattern = '/\*BK_STAMP_START\*/[\s\S]*?/\*BK_STAMP_END\*/'
if ($html -notmatch $pattern) { Write-Error 'stamp-backup-status: BK_STAMP markers not found in CC'; exit 1 }
$html = [regex]::Replace($html, $pattern, ('/*BK_STAMP_START*/' + $json.Replace('$', '$$$$') + '/*BK_STAMP_END*/'))
[System.IO.File]::WriteAllText($cc, $html, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ("stamp-backup-status: verified {0} | commit {1} ({2}) | onedrive {3} ({4})" -f $verified, $tasks[0].last, $tasks[0].result, $tasks[1].last, $tasks[1].result)

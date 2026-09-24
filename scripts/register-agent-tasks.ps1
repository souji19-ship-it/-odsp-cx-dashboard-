<#
  register-agent-tasks.ps1 — (re)registers the headless agent cadence Windows Scheduled Tasks
  idempotently (-Force). Run after a machine rebuild or CLI-state reset:

    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\register-agent-tasks.ps1

  Each task runs scripts\run-agent-prompt.ps1, which invokes copilot -p headless so the daily /
  weekly judgment cadences fire reliably even when no interactive CLI is open. See
  automation\RESTORE-SCHEDULES.md and automation\schedules.json for the source of truth.
#>
$ErrorActionPreference = 'Stop'
$repo    = Split-Path $PSScriptRoot -Parent
$wrapper = Join-Path $repo 'scripts\run-agent-prompt.ps1'
$prompts = Join-Path $repo 'automation\prompts'

if (-not (Test-Path $wrapper)) { throw "Wrapper not found: $wrapper" }

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

function Register-AgentTask {
  param($TaskName, $PromptFile, $Name, $Trigger, [int]$LimitMinutes, $Description)
  $promptPath = Join-Path $prompts $PromptFile
  if (-not (Test-Path $promptPath)) { throw "Prompt file not found: $promptPath" }
  $args = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -PromptFile "{1}" -Name {2}' -f $wrapper, $promptPath, $Name
  $action   = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $args -WorkingDirectory $repo
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes $LimitMinutes)
  $reg = @{ TaskName = $TaskName; Action = $action; Settings = $settings; Principal = $principal; Description = $Description; Force = $true }
  if ($Trigger) { $reg.Trigger = $Trigger }   # no trigger = on-demand (runs on Ambal's end-of-day signal)
  Register-ScheduledTask @reg | Out-Null
  Write-Host "registered $TaskName$(if (-not $Trigger) { ' (on-demand)' })"
}

# 1) Morning memo — daily 8:15 AM (30-min cap)
Register-AgentTask -TaskName 'ODSP-AW-Morning-Memo' -PromptFile 'morning-memo.txt' -Name 'morning-memo' `
  -Trigger (New-ScheduledTaskTrigger -Daily -At '8:15AM') -LimitMinutes 30 `
  -Description 'Headless agent: consolidated daily morning memo (8:15am CST). Runs scripts\run-agent-prompt.ps1.'

# 2) EOD close-out — DAILY 1:00 AM CST (can also be started on demand)
Register-AgentTask -TaskName 'ODSP-AW-EOD-Closeout' -PromptFile 'eod-closeout.txt' -Name 'eod-closeout' `
  -Trigger (New-ScheduledTaskTrigger -Daily -At '1:00AM') -LimitMinutes 45 `
  -Description 'Headless agent: EOD governance reconcile + Data Health re-verify + Audit row + finalize for the morning memo + flat archive. Daily 1:00 AM CST (can also be started on demand).'

# 3) Weekly reflection — Thursday 10:30 PM (20-min cap; clears well before the 1am EOD)
Register-AgentTask -TaskName 'ODSP-AW-Weekly-Reflection' -PromptFile 'weekly-reflection.txt' -Name 'weekly-reflection' `
  -Trigger (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Thursday -At '10:30PM') -LimitMinutes 20 `
  -Description 'Headless agent: weekly reflection memo (Thursday 10:30pm CST). Runs scripts\run-agent-prompt.ps1.'

# 4) EOD archive — DAILY 1:45 AM CST (45-min backstop after the close-out, which also invokes the archive).
$archiveAction = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument ('-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f (Join-Path $repo 'scripts\archive-eod.ps1')) -WorkingDirectory $repo
$archiveSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 20)
Register-ScheduledTask -TaskName 'ODSP-AW-EOD-Archive' -Action $archiveAction -Settings $archiveSettings -Principal $principal `
  -Trigger (New-ScheduledTaskTrigger -Daily -At '1:45AM') `
  -Description 'Flat EOD archive (Data-Public provenance manifest + Data-Private off-OneDrive backup). Daily 1:45 AM CST - a backstop after the 1:00 AM close-out, which also runs the archive.' -Force | Out-Null
Write-Host 'registered ODSP-AW-EOD-Archive (daily 1:45 AM)'

Write-Host ''
Write-Host 'Done. Morning-Memo (8:15 AM) + EOD-Closeout (1:00 AM) + EOD-Archive (1:45 AM) + Weekly (Thu 10:30 PM) all run on timers.'
Get-ScheduledTask -TaskName 'ODSP-AW-Morning-Memo','ODSP-AW-EOD-Closeout','ODSP-AW-Weekly-Reflection','ODSP-AW-EOD-Archive' |
  ForEach-Object { $i = $_ | Get-ScheduledTaskInfo; '{0,-28} next: {1}' -f $_.TaskName, $i.NextRunTime }

<#
  register-refresh-task.ps1  --  Register (or re-point) the Windows scheduled task that runs the
  weekly ODSP-AW Scorecard refresh every Sunday 07:30 local time (America/Los_Angeles on the owner's
  box; the trigger fires at 07:30 in whatever the machine's local timezone is).

  Run this ONCE on the machine that will host the refresh, in an ELEVATED PowerShell (Run as admin).

  USAGE:
    # default: task named ODSP-AW-Dashboard-Refresh, runs the bundled run-weekly-refresh.ps1
    .\register-refresh-task.ps1

    # customise the time / task name, or pass extra args to the wrapper (e.g. point at OneDrive)
    .\register-refresh-task.ps1 -Time 07:30 -TaskName ODSP-AW-Dashboard-Refresh `
        -WrapperArgs '-DashboardPath "C:\Users\me\OneDrive - Microsoft\ODSP-AW-Dashboard\ODSP-in-Agentic-Work-Scorecard.html" -NoCommit'

  To remove:  Unregister-ScheduledTask -TaskName ODSP-AW-Dashboard-Refresh -Confirm:$false
#>
[CmdletBinding()]
param(
  [string]$TaskName = 'ODSP-AW-Dashboard-Refresh',
  [string]$Time     = '07:30',                    # local time, Sundays
  [string]$WrapperArgs = '',                       # extra args forwarded to run-weekly-refresh.ps1
  [switch]$WakeToRun                               # wake the machine from sleep to run
)
$ErrorActionPreference = 'Stop'
$wrapper = Join-Path $PSScriptRoot 'run-weekly-refresh.ps1'
if (-not (Test-Path $wrapper)) { throw "run-weekly-refresh.ps1 not found next to this script: $wrapper" }

$psArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$wrapper`""
if ($WrapperArgs) { $psArgs += " $WrapperArgs" }

$action    = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $psArgs
$trigger   = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At $Time
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$settings  = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries `
               -AllowStartIfOnBatteries -RunOnlyIfNetworkAvailable `
               -ExecutionTimeLimit (New-TimeSpan -Hours 4)
$settings.WakeToRun = [bool]$WakeToRun

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Write-Host "Task '$TaskName' exists - updating it." -ForegroundColor Yellow
  Set-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null
} else {
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
    -Description 'Weekly ODSP-AW Scorecard refresh (Scout + Copilot Studio; Cowork left as-is). Sundays 07:30 local.' | Out-Null
  Write-Host "Task '$TaskName' registered." -ForegroundColor Green
}

$t = Get-ScheduledTask -TaskName $TaskName
$info = Get-ScheduledTaskInfo -TaskName $TaskName
Write-Host ""
Write-Host "=== $TaskName ===" -ForegroundColor Cyan
Write-Host ("  Trigger      : Sundays at {0} (local time)" -f $Time)
Write-Host ("  Runs         : powershell.exe {0}" -f $psArgs)
Write-Host ("  WakeToRun    : {0}" -f $t.Settings.WakeToRun)
Write-Host ("  Next run     : {0}" -f $info.NextRunTime)
Write-Host ""
Write-Host "NOTE: an Interactive-logon task runs when the machine is LOCKED, but NOT when the user is"
Write-Host "signed out. Keep the host powered on and signed in (locked is fine)."

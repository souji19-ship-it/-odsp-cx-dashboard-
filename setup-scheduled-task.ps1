# PowerShell Script to Setup Windows Task Scheduler for KAv2 Scraper
# Run as Administrator

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "KAv2 Scraper - Task Scheduler Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Configuration
$TaskName = "KAv2-Metrics-Scraper"
$ScriptPath = "C:\repos\msft-reporting\run-scheduled-silent.bat"
$LogPath = "C:\repos\msft-reporting\logs"

# Create logs directory
if (-not (Test-Path $LogPath)) {
    New-Item -ItemType Directory -Path $LogPath -Force | Out-Null
    Write-Host "[OK] Created logs directory: $LogPath" -ForegroundColor Green
}

Write-Host ""
Write-Host "Schedule Options:" -ForegroundColor Yellow
Write-Host "1. Weekly (Monday at 9:00 AM)" -ForegroundColor White
Write-Host "2. Daily (Every day at 9:00 AM)" -ForegroundColor White
Write-Host "3. Custom (You'll configure manually)" -ForegroundColor White
Write-Host ""

$choice = Read-Host "Select option (1-3)"

# Delete existing task if it exists
$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existingTask) {
    Write-Host "[INFO] Removing existing task..." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

# Create the scheduled task based on choice
switch ($choice) {
    "1" {
        # Weekly - Monday at 9 AM
        Write-Host "[INFO] Creating weekly task (Mondays at 9:00 AM)..." -ForegroundColor Cyan

        $trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At 9am
        $action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$ScriptPath`""
        $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
        $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive

        Register-ScheduledTask -TaskName $TaskName `
            -Trigger $trigger `
            -Action $action `
            -Settings $settings `
            -Principal $principal `
            -Description "Automated KAv2 metrics scraper - runs weekly on Monday mornings"

        Write-Host "[SUCCESS] Task created: Runs every Monday at 9:00 AM" -ForegroundColor Green
    }

    "2" {
        # Daily at 9 AM
        Write-Host "[INFO] Creating daily task (Every day at 9:00 AM)..." -ForegroundColor Cyan

        $trigger = New-ScheduledTaskTrigger -Daily -At 9am
        $action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$ScriptPath`""
        $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
        $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive

        Register-ScheduledTask -TaskName $TaskName `
            -Trigger $trigger `
            -Action $action `
            -Settings $settings `
            -Principal $principal `
            -Description "Automated KAv2 metrics scraper - runs daily at 9 AM"

        Write-Host "[SUCCESS] Task created: Runs every day at 9:00 AM" -ForegroundColor Green
    }

    "3" {
        # Custom - open Task Scheduler
        Write-Host "[INFO] Opening Task Scheduler for manual configuration..." -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Manual Setup Instructions:" -ForegroundColor Yellow
        Write-Host "1. Click 'Create Basic Task' or 'Create Task'" -ForegroundColor White
        Write-Host "2. Name: $TaskName" -ForegroundColor White
        Write-Host "3. Action: Start a program" -ForegroundColor White
        Write-Host "4. Program: cmd.exe" -ForegroundColor White
        Write-Host "5. Arguments: /c `"$ScriptPath`"" -ForegroundColor White
        Write-Host "6. Set your preferred schedule" -ForegroundColor White
        Write-Host ""

        Start-Process "taskschd.msc"
        Start-Sleep -Seconds 2
    }

    default {
        Write-Host "[ERROR] Invalid option selected" -ForegroundColor Red
        exit 1
    }
}

if ($choice -ne "3") {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "Task Details:" -ForegroundColor Cyan
    Write-Host "  Name: $TaskName" -ForegroundColor White
    Write-Host "  Script: $ScriptPath" -ForegroundColor White
    Write-Host "  Logs: $LogPath" -ForegroundColor White
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Next Steps:" -ForegroundColor Yellow
    Write-Host "1. The task will run automatically on schedule" -ForegroundColor White
    Write-Host "2. Check logs in: $LogPath" -ForegroundColor White
    Write-Host "3. View/Edit task: Run 'taskschd.msc' and find '$TaskName'" -ForegroundColor White
    Write-Host "4. Test now: Run this command as admin:" -ForegroundColor White
    Write-Host "   Start-ScheduledTask -TaskName '$TaskName'" -ForegroundColor Cyan
    Write-Host ""

    $testNow = Read-Host "Test the task now? (Y/N)"
    if ($testNow -eq "Y" -or $testNow -eq "y") {
        Write-Host "[INFO] Running task now..." -ForegroundColor Cyan
        Start-ScheduledTask -TaskName $TaskName
        Write-Host "[OK] Task started! Check logs in: $LogPath" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "Setup complete!" -ForegroundColor Green

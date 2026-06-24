# Scheduling Automatic Runs

Guide to setting up automatic scheduled runs for the KAv2 metrics scraper.

## 🎯 **Recommended: Windows Task Scheduler**

Best for enterprise Windows environments. Runs even when not logged in.

### **Quick Setup (PowerShell)**

1. **Open PowerShell as Administrator**
   - Press `Win + X`
   - Click "Windows PowerShell (Admin)" or "Terminal (Admin)"

2. **Run the setup script:**
   ```powershell
   cd C:\repos\msft-reporting
   .\setup-scheduled-task.ps1
   ```

3. **Choose your schedule:**
   - Option 1: **Weekly (Monday at 9 AM)** - Recommended for weekly tracking
   - Option 2: **Daily (Every day at 9 AM)** - For more frequent monitoring
   - Option 3: **Custom** - Set your own schedule

4. **Test the task:**
   ```powershell
   Start-ScheduledTask -TaskName "KAv2-Metrics-Scraper"
   ```

### **Manual Setup (Task Scheduler GUI)**

If you prefer a GUI approach:

1. **Open Task Scheduler**
   - Press `Win + R`, type `taskschd.msc`, press Enter

2. **Create Basic Task**
   - Click "Create Basic Task" in the right panel
   - Name: `KAv2-Metrics-Scraper`
   - Description: `Automated KAv2 metrics extraction`

3. **Set Trigger**
   - Choose: Weekly (or Daily/Monthly)
   - Day: Monday
   - Time: 9:00 AM
   - ✅ Enabled

4. **Set Action**
   - Action: Start a program
   - Program: `cmd.exe`
   - Arguments: `/c "C:\repos\msft-reporting\run-scheduled-silent.bat"`

5. **Additional Settings** (Important!)
   - ✅ Run whether user is logged on or not
   - ✅ Run with highest privileges (if needed)
   - ✅ Allow task to be run on demand
   - ✅ Start the task as soon as possible after a scheduled start is missed

### **What Happens on Each Run?**

1. ✅ Checks if Edge is running with debugging
2. ✅ Launches Edge if needed (with debugging port)
3. ✅ Runs the scraper
4. ✅ Saves CSV and JSON files with timestamps
5. ✅ Logs everything to `logs/scraper-YYYYMMDD-HHMM.log`

---

## 📋 **Log Files**

All runs are logged to help with troubleshooting:

**Location:** `C:\repos\msft-reporting\logs\`

**File format:** `scraper-YYYYMMDD-HHMM.log`

**Example:**
```
logs/
├── scraper-20260217-0900.log
├── scraper-20260224-0900.log
└── scraper-20260303-0900.log
```

**Check logs:**
```bash
# View latest log
type logs\scraper-*.log | more

# View specific log
type logs\scraper-20260217-0900.log
```

---

## 🔍 **Monitoring & Troubleshooting**

### **Check if Task is Running**

```powershell
# View task status
Get-ScheduledTask -TaskName "KAv2-Metrics-Scraper"

# View task history
Get-ScheduledTaskInfo -TaskName "KAv2-Metrics-Scraper"
```

### **Test Task Manually**

```powershell
# Run the task immediately
Start-ScheduledTask -TaskName "KAv2-Metrics-Scraper"
```

### **Common Issues**

**Task runs but no data extracted:**
- Check logs in `logs/` directory
- Ensure you're signed in to Edge with your @microsoft.com account
- Try running `run-scheduled.bat` manually to see errors

**Edge not starting:**
- Edge may be blocked by corporate policy
- Check if you can manually launch Edge with:
  ```
  "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --remote-debugging-port=9222
  ```

**Authentication issues:**
- The task runs under your user account
- You must be signed in to Edge at least once
- Edge will use your saved credentials

---

## 📊 **Viewing Results**

After each scheduled run, new files are created:

```bash
# List recent extractions
ls -lt kav2-*.csv | head -5

# View latest metrics
type kav2-executive-summary-metrics-*.csv | head -20
```

---

## 📧 **Optional: Email Notifications**

Want to receive email when scraper runs?

### **Using PowerShell SendMail**

Create `send-notification.ps1`:

```powershell
# Email configuration
$From = "your-email@microsoft.com"
$To = "your-email@microsoft.com"
$Subject = "KAv2 Metrics Scraped - $(Get-Date -Format 'yyyy-MM-dd')"
$SMTPServer = "smtp.office365.com"
$SMTPPort = 587

# Get latest metrics file
$LatestMetrics = Get-ChildItem "C:\repos\msft-reporting\kav2-executive-summary-metrics-*.csv" |
                 Sort-Object LastWriteTime -Descending |
                 Select-Object -First 1

# Read key metrics
$Content = Get-Content $LatestMetrics.FullName | Select-Object -First 10

$Body = @"
KAv2 Metrics extraction completed.

Latest metrics:
$($Content -join "`n")

Files: $($LatestMetrics.FullName)
"@

# Send email (requires credentials)
$Credential = Get-Credential
Send-MailMessage -From $From -To $To -Subject $Subject -Body $Body `
                 -SmtpServer $SMTPServer -Port $SMTPPort `
                 -Credential $Credential -UseSsl
```

Add to scheduled task:
```bash
powershell -File "C:\repos\msft-reporting\send-notification.ps1"
```

---

## 🔄 **Maintenance**

### **Clean Up Old Files**

Create a cleanup script to keep only recent data:

```bash
# Keep only last 30 days of data
forfiles /p "C:\repos\msft-reporting" /m kav2-*.csv /d -30 /c "cmd /c del @path"
```

### **Archive Old Data**

```bash
# Move old files to archive
mkdir archive\2026\02
move kav2-*-2026-02-*.csv archive\2026\02\
```

---

## ⚙️ **Advanced Options**

### **Change Schedule**

```powershell
# Modify existing task
Set-ScheduledTask -TaskName "KAv2-Metrics-Scraper" -Trigger (New-ScheduledTaskTrigger -Daily -At 8am)
```

### **Disable/Enable Task**

```powershell
# Disable
Disable-ScheduledTask -TaskName "KAv2-Metrics-Scraper"

# Enable
Enable-ScheduledTask -TaskName "KAv2-Metrics-Scraper"
```

### **Delete Task**

```powershell
Unregister-ScheduledTask -TaskName "KAv2-Metrics-Scraper" -Confirm:$false
```

---

## 📅 **Recommended Schedules**

| Frequency | Best For | Schedule |
|-----------|----------|----------|
| **Weekly** | Standard tracking | Monday 9:00 AM |
| **Bi-weekly** | Light monitoring | 1st & 15th at 9:00 AM |
| **Daily** | Intensive tracking | Every day 9:00 AM |
| **Monthly** | Long-term trends | 1st of month 9:00 AM |

**Most common:** Weekly on Monday mornings (captures full previous week)

---

## 🎓 **Tips**

1. **Run during work hours** - Ensures you're logged in
2. **Keep Edge open** - Faster subsequent runs
3. **Monitor logs weekly** - Catch issues early
4. **Archive monthly** - Keep data organized
5. **Review metrics weekly** - Act on insights quickly

---

## 🆘 **Need Help?**

**Check logs first:**
```bash
type logs\scraper-*.log | more
```

**Test manually:**
```bash
run-scheduled.bat
```

**Ask Claude:**
"Help me troubleshoot the scheduled scraper"

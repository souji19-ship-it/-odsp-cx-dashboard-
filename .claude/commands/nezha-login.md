# nezha-login

Navigates to the Nezha dashboard and handles the login flow using the existing Edge CDP session.

## Description

Connects to Edge via CDP (port 9222), navigates to the Nezha dashboard, and clicks through the "Login Required" page using SSO. Run this whenever Nezha shows "Access is Denied" or "Login Required" before scraping.

## Usage

```
/nezha-login
```

## Instructions

When this skill is invoked, execute the following steps:

1. Check Edge CDP is running:
   ```bash
   powershell.exe -Command "Test-NetConnection -ComputerName localhost -Port 9222 -InformationLevel Quiet"
   ```
   If False, launch Edge:
   ```bash
   powershell.exe -Command "Stop-Process -Name msedge -Force -ErrorAction SilentlyContinue; Start-Sleep 5; Start-Process 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' -ArgumentList '--remote-debugging-port=9222','--no-restore','--disable-session-crashed-bubble','--no-first-run'"
   sleep 15
   ```

2. Run the login helper script:
   ```bash
   node nezha-login.js
   ```

3. Report the result — success means the dashboard is now accessible and the scraper can be run.

## What the script does

`nezha-login.js` connects to Edge via CDP, navigates to the Nezha KAv2 dashboard, detects the "Login Required" page, clicks the Login button, waits for SSO to complete via Microsoft Entra ID, and verifies the dashboard loaded successfully by checking for dashboard tabs.

## Notes

- Requires the user to be signed into Edge with their @microsoft.com account (SSO handles the rest automatically)
- If SSO prompts for account selection, the script picks the @microsoft.com work account
- After this succeeds, run `/scrape-msft-report` to scrape the data

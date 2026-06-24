# Claude Code Skills for Microsoft Reporting

This directory contains Claude Code skills for automated report scraping.

## Available Skills

### `/scrape-msft-report`

Automatically scrapes data from Microsoft Nezha reports and saves to CSV files.

**Usage:**
```
/scrape-msft-report
```

Or with a custom URL:
```
/scrape-msft-report https://www.microsoftnezha.com/nezha/dashboard/p/REPORT_ID/
```

**What it does:**
1. Launches Edge with your work profile
2. Connects to the browser automatically
3. Navigates to the report
4. Extracts all table data
5. Saves to timestamped CSV files

**First time setup:**
- Make sure Edge is closed before running
- You may need to sign in with your @microsoft.com account in the Edge window that opens
- After first run, Edge can stay open for faster subsequent runs

## Skill Files

- `scrape-msft-report.md` - Skill definition and instructions
- Located in: `C:\repos\msft-reporting\.claude\skills\`

## Scripts

The main scraper script is: `C:\repos\msft-reporting\run-scraper.js`

You can also run directly with npm:
```bash
npm start
```

## Output

CSV files are saved in: `C:\repos\msft-reporting\`

Format: `report-table{N}-{YYYY-MM-DDTHH-MM-SS}.csv`

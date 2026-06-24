# Microsoft Reporting Data Scraper

Automated tool to extract data from Microsoft Nezha reports using Playwright and Edge browser.

## Setup Complete ✓

All dependencies are installed and ready to use.

## Three Ways to Run

### Option 1: Use Your Existing Edge Profile (Recommended for Corporate)

This uses your regular Edge browser with all your corporate settings and authentication:

```bash
node scrape-with-profile.js
```

**Pros:**
- Uses your existing corporate authentication
- No need to log in again if you're already logged in to Edge
- Respects all corporate policies and settings

**Note:** Close all Edge windows before running this script.

### Option 2: Two-Step Authentication

If Option 1 doesn't work, use this two-step process:

**Step 1:** Authenticate once (saves credentials)
```bash
node authenticate.js
```
- Edge will open
- Log in manually
- Navigate to the report page
- Press ENTER in the terminal when you see the report
- Your auth state will be saved to `auth.json`

**Step 2:** Run the scraper anytime
```bash
node scrape-report.js
```
- Uses the saved authentication
- Extracts data automatically
- Saves to timestamped CSV files

## What Gets Saved

- **CSV files**: `report-table1-YYYY-MM-DDTHH-MM-SS.csv`
  - One file per table found on the page
  - Timestamped so you can track data over time
- **Debug files** (if no tables found):
  - `page-screenshot.png` - Full page screenshot
  - `page-source.html` - Raw HTML for inspection

## Troubleshooting

### Edge is already running
- Close all Edge windows before running `scrape-with-profile.js`
- Or use Option 2 instead

### Different Edge Profile
Edit `scrape-with-profile.js` line 21:
```javascript
args: ['--profile-directory=Profile 1']  // Change 'Default' to 'Profile 1', etc.
```

### No tables found
The script will save a screenshot and HTML source to help identify the data structure. We can then update the extraction logic.

## Report URL

Currently configured for:
- https://www.microsoftnezha.com/nezha/dashboard/p/r2YgM22yDQv/

To change the report URL, edit the `reportUrl` variable in the script you're using.

## Data Directory Structure

```
msft-reporting/
├── authenticate.js           # One-time authentication
├── scrape-report.js         # Main scraper (uses auth.json)
├── scrape-with-profile.js   # Uses existing Edge profile
├── auth.json                # Saved authentication (if using Option 2)
├── report-table1-*.csv      # Extracted data files
└── page-screenshot.png      # Debug screenshot (if needed)
```

## Next Steps

1. Try running `node scrape-with-profile.js` first
2. If that doesn't work, try the two-step process with `authenticate.js`
3. Once it works, you can schedule this to run periodically to collect data over time

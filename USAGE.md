# KAv2 Metrics Scraper - Usage Guide

Automated extraction of Knowledge Agent v2 (KAv2) metrics from Microsoft Nezha dashboard.

## 🎯 Quick Start

### Using Claude Code Skill

Simply ask Claude:
```
/scrape-msft-report
```
or
```
Run the KAv2 scraper
```

### Manual Usage

```bash
cd C:\repos\msft-reporting
npm start
```

## 📊 What Gets Extracted

The scraper navigates through **two specific tabs** on the dashboard:

### Tab 1: KAv2 Executive Summary

**PMF (Product-Market Fit) Metrics:**
- KA weekly return rate
- Weekly kept rate
- Monthly Return Rate (For Builders)

**Usage Metrics:**
- Weekly Active Users (WAU)
- Weekly active users WoW% (Week-over-Week growth)
- Opt-in Tenants

**Persona Breakdown Table:**
- Content Creator (WAU, Usage WoW%, Weekly Kept, Kept WoW%)
- Content Consumer (WAU, Usage WoW%, Weekly Kept, Kept WoW%)
- Content Manager (WAU, Usage WoW%, Weekly Kept, Kept WoW%)
- Site Manager (WAU, Usage WoW%, Weekly Kept, Kept WoW%)

**Tools Usage Table:**
- Top 10 tool chains invoked by query volume

### Tab 2: KAv2 Growth Analytics

**Unique Growth Metrics:**
- Daily Active Usage (DAU)
- Weekly Active Usage
- Monthly Active Usage
- Weekly Query Volume
- Weekly Conversation Volume

**Distribution Data:**
- Turn distribution (conversation depth)
- Query volume by surface (SharePoint Pages, DocLib, etc.)

## 📁 Output Files

All files are timestamped for tracking over time:

### Per Tab Files:
```
kav2-executive-summary-metrics-{timestamp}.csv    # 31 metrics
kav2-executive-summary-table1-{timestamp}.csv     # Headers
kav2-executive-summary-table2-{timestamp}.csv     # Persona breakdown
kav2-executive-summary-table3-{timestamp}.csv     # Headers
kav2-executive-summary-table4-{timestamp}.csv     # Tool chains

kav2-growth-analytics-metrics-{timestamp}.csv     # 36 metrics
kav2-growth-analytics-table1-{timestamp}.csv      # Headers
kav2-growth-analytics-table2-{timestamp}.csv      # Persona data
kav2-growth-analytics-table3-{timestamp}.csv      # Headers
kav2-growth-analytics-table4-{timestamp}.csv      # Tool chains
```

### Aggregated Files:
```
dashboard-complete-{timestamp}.json               # All data in JSON format
dashboard-final-{timestamp}.png                   # Screenshot of final state
```

## 🔧 Available Commands

```bash
npm start                # Run the tab-based scraper (default)
npm run scrape-kav2     # Same as start
npm run scrape-legacy   # Old single-page scraper (not recommended)
```

## 📝 Latest Results Example

From run on 2026-02-14:

**Executive Summary Tab:**
- WAU: 54.2k users
- WoW Growth: -2.72%
- Return Rate: 16.41%
- Top Persona: Content Creators (31.2k, 58% of total)

**Growth Analytics Tab:**
- Daily Active Usage: 492
- Weekly Active Usage: 2.31k
- Weekly Query Volume: 7.58k
- Weekly Conversation Volume: 3.73k

## 🔄 How It Works

1. **Launches Edge** with remote debugging (port 9222)
2. **Navigates** to Knowledge Agent Metrics dashboard
3. **Clicks "KAv2 Executive Summary" tab**
   - Waits for data to load
   - Extracts all metrics and tables
4. **Clicks "KAv2 Growth Analytics" tab**
   - Waits for data to load
   - Extracts all metrics and tables
5. **Saves everything** with clear labels per tab
6. **Creates aggregated JSON** with all data

## ⚙️ Setup (Already Complete)

- ✅ Node.js v24.13.1 and Playwright 1.58.2 installed
- ✅ Edge browser configured with debugging
- ✅ Claude Code skill created
- ✅ Scripts ready to run

## 🔍 Troubleshooting

**Edge not connecting?**
```bash
# Close all Edge windows
taskkill /F /IM msedge.exe /T

# Launch with debugging
start "" "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --remote-debugging-port=9222

# Wait and run scraper
sleep 5
npm start
```

**Tabs not clicking?**
- Make sure you're signed in with your @microsoft.com account
- The scraper handles "WIP" suffix automatically
- Check the screenshot file to see final state

**Data not loading?**
- Increase wait time in `scrape-dashboard-tabs.js` (currently 8 seconds)
- Some dashboards are slow to load

## 📈 Tracking Over Time

Since all files include timestamps:
- **Weekly tracking**: Run weekly to track trends
- **Excel analysis**: Import CSVs directly
- **Power BI**: Use JSON files for dashboards
- **Trend analysis**: Compare timestamped files

## 📊 Data Structure

### Metrics CSV Format
```csv
Metric,Value
"KA weekly return rate","16.41"
"Weekly Active Users","54.2k"
"[KAv2] Daily Active Usage","492"
...
```

### Complete JSON Format
```json
{
  "timestamp": "2026-02-14T18:21:21.000Z",
  "url": "https://...",
  "tabs": {
    "KAv2 Executive Summary": {
      "metrics": { ... },
      "tables": [ ... ]
    },
    "KAv2 Growth Analytics": {
      "metrics": { ... },
      "tables": [ ... ]
    }
  }
}
```

## 🎓 Key Metrics Definitions

- **WAU**: Weekly Active Users - unique users who engaged in a week
- **WoW%**: Week-over-Week percentage change
- **Return Rate**: % of users who return after first use
- **Kept Rate**: % of users who remain active over time
- **DAU**: Daily Active Users
- **Query Volume**: Number of queries/requests
- **Conversation Volume**: Number of conversations started

## 💡 Best Practices

- **Run Weekly**: Monday mornings to capture previous week's data
- **Keep Edge Open**: Faster subsequent runs
- **Archive Old Files**: Move to `/archive/{year}/{month}/` structure
- **Excel Pivot Tables**: Easy analysis of persona trends
- **Git Tracking**: Commit CSVs to track history

## 🚀 Advanced Usage

### Compare Week-over-Week
```bash
# Run this week
npm start

# Compare with last week's files
# Files are named with timestamps for easy comparison
```

### Extract Specific Metrics
```bash
# Search for specific metrics across runs
grep "Weekly Active Users" kav2-executive-summary-metrics-*.csv
```

### Build Time Series
Import all timestamped CSVs into Excel/Python/R for trend analysis.

## 📞 Need Help?

- Check `README.md` for project overview
- Check `.claude/skills/README.md` for skill documentation
- Ask Claude Code: "How do I use the KAv2 scraper?"
- Review screenshot files for debugging

## 🔮 Future Enhancements

Potential additions:
- Automated weekly scheduling (Windows Task Scheduler)
- Email reports with key metrics
- Alerts on threshold breaches
- Multi-dashboard aggregation
- Historical trend charts

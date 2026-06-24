# publish-report

Publishes the dashboard and raw data CSVs to SharePoint.

## Instructions

When invoked:

1. **Always regenerate dashboard data first** — `publish-to-sharepoint.js` does NOT regenerate it automatically. Without this step, the published dashboard will show stale data (whatever was last generated, potentially days old):
   ```
   node generate-dashboard-data.js
   ```
   Check the output — it prints the latest KAv2 WAU date. If the date looks stale (more than a few days behind today), warn the user before proceeding.

2. Run the publish script from the project root:
   ```
   node publish-to-sharepoint.js
   ```
   - Auth uses Azure CLI silently (no browser sign-in needed).

3. Report the result to the user:
   - The SharePoint URL of the published dashboard
   - Number of data files uploaded
   - Any errors encountered

## Target location

- Dashboard: `https://microsoft.sharepoint-df.com/teams/SPAI/Shared%20Documents/Stats/dashboard-sharepoint.html`
- Raw data: `https://microsoft.sharepoint-df.com/teams/SPAI/Shared%20Documents/Stats/data/`

The dashboard is published as a self-contained HTML file (data inlined) so it works without any local files.

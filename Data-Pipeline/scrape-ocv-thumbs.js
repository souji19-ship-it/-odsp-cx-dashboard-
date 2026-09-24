// Scrape OCV per-surface ODSP Copilot thumbs (L3) -> Data-Public/ocv/odsp-copilot-thumbs.json
// Confirmed mapping (Ambal, Jun 27): FeatureArea == 'Copilot ODSP Apps', FeedbackType ThumbsUp/Down,
// sliced by UiHost + FeatureName. Clean 0/1 thumbs (NOT the 0.78-2.7 survey Rating). Persisted to disk so
// the Data Health L3 is file-backed + auditable (closes the M00078 live-query gap).
const { Client, KustoConnectionStringBuilder } = require('azure-kusto-data');
const { DefaultAzureCredential } = require('@azure/identity');
const fs = require('fs');
const path = require('path');

const CLUSTER = 'https://ocvkustov2.westcentralus.kusto.windows.net';
const DB = 'OneCustomerVoice';
const DAYS = parseInt(process.env.OCV_DAYS || '30', 10);
const OUTDIR = process.env.ODSP_DATA_DIR ? path.join(process.env.ODSP_DATA_DIR, 'ocv') : path.join(__dirname, '..', 'Data-Public', 'ocv');

const Q = `OcvItems
| where Timestamp > ago(${DAYS}d)
| where FeatureArea == 'Copilot ODSP Apps'
| where FeedbackType in ('ThumbsUp','ThumbsDown')
| summarize Count=count() by UiHost, FeatureName, FeedbackType
| order by Count desc`;

// Host -> surface. OneDrive hosts vs SharePoint hosts; empty/ambiguous host -> Unattributed (no fabrication).
function surfaceOf(uiHost) {
  const h = (uiHost || '').toLowerCase();
  if (!h) return 'Unattributed';
  if (/onedrive|^odb$|^odc$|odcwac/.test(h)) return 'Copilot in OneDrive';
  if (/sharepoint|oneup|customcopilotwebpart|ngsp|^wac$|vibesite/.test(h)) return 'Copilot in SharePoint';
  return 'Other';
}

(async () => {
  const kcsb = KustoConnectionStringBuilder.withTokenCredential(CLUSTER, new DefaultAzureCredential());
  const client = new Client(kcsb);
  const resp = await client.execute(DB, Q);
  const t = resp.primaryResults[0];
  const cols = t.columns.map(c => c.name);
  const rows = [];
  for (const r of t.rows()) { const o = {}; cols.forEach((c, i) => o[c] = r.getValueAt(i)); rows.push(o); }
  client.close();

  const surf = {};
  for (const row of rows) {
    const s = surfaceOf(row.UiHost);
    surf[s] = surf[s] || { ups: 0, downs: 0 };
    if (row.FeedbackType === 'ThumbsUp') surf[s].ups += row.Count; else surf[s].downs += row.Count;
  }
  for (const s in surf) { const x = surf[s]; x.total = x.ups + x.downs; x.upRatePct = x.total ? Math.round(1000 * x.ups / x.total) / 10 : null; }

  const out = {
    source: 'OCV OcvItems (live Kusto, persisted)',
    cluster: CLUSTER, db: DB, featureArea: 'Copilot ODSP Apps',
    metric: '0/1 thumbs via FeedbackType ThumbsUp/Down; upRate = ups/(ups+downs)',
    attribution: 'surface inferred from UiHost; empty/ambiguous host -> Unattributed (confirm SharePoint sub-feature set with the dashboard owner before publishing)',
    windowDays: DAYS, pulledAt: new Date().toISOString(),
    perSurface: surf, rows
  };
  fs.mkdirSync(OUTDIR, { recursive: true });
  const outfile = path.join(OUTDIR, 'odsp-copilot-thumbs.json');
  fs.writeFileSync(outfile, JSON.stringify(out, null, 2));
  console.log('OCV thumbs -> ' + outfile + ' (' + rows.length + ' rows)');
  console.log('per-surface: ' + JSON.stringify(surf));
})().catch(e => { console.error('OCV_PULL_ERR: ' + e.message); process.exit(2); });

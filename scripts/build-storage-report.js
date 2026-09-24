// Measures the workspace's storage split across the main pieces + the total, injects a storageReport
// into ODSP-AW-CC.html between /*STORAGE_REPORT_START*/ and /*STORAGE_REPORT_END*/, and upserts a daily
// end-of-day history row so any bloat (in any piece) shows up over time. Idempotent — re-run anytime
// (wired into cc-maintenance.ps1 hourly + archive-eod.ps1 nightly).
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CC = path.join(ROOT, 'Data-Private', 'Data-Created', 'ODSP-AW-CC.html');

// Recursive size in bytes. Uses lstat so Windows junctions (e.g. the agent's context/data -> Data-Public)
// are treated as symlinks and skipped — avoids double-counting and walk loops. node_modules is excluded
// everywhere: it is regenerable cache (gitignored + excluded from backups), so counting it would make the
// report swing ~100MB whenever scrapers self-heal their deps — a misleading number, not managed storage.
function dirSize(p) {
  let total = 0, entries;
  try { entries = fs.readdirSync(p, { withFileTypes: true }); } catch (e) { return 0; }
  for (const e of entries) {
    if (e.name === 'node_modules') continue;
    const f = path.join(p, e.name);
    try {
      const st = fs.lstatSync(f);
      if (st.isSymbolicLink()) continue;
      total += st.isDirectory() ? dirSize(f) : st.size;
    } catch (e2) {}
  }
  return total;
}
const mb = b => Math.round(b / 1048576 * 10) / 10;
const sz = rel => dirSize(path.join(ROOT, rel));

const archive = 0; // the CC Archive folder was removed Jun 27 - the provenance manifest lives flat in Data-Private/Data-Created (now off git; git no longer holds CC history)
const createdAll = sz('Data-Private/Data-Created');
const dataPublic = sz('Data-Public');
const dataPrivate = Math.max(sz('Data-Private') - createdAll, 0); // grounding only - exclude the nested Command Center so it is not double-counted
const git = sz('.git');
const dataPipeline = sz('Data-Pipeline');
const agent = sz('OneDrive-SharePoint-in-Agentic-Work-Agent');
const total = dirSize(ROOT);
const ccDeliverables = Math.max(createdAll - archive, 0);
const accounted = archive + dataPublic + dataPrivate + git + dataPipeline + agent + ccDeliverables;
const other = Math.max(total - accounted, 0);

const pieces = [
  { name: 'Data-Pipeline (scrapers \u00b7 code only)', mb: mb(dataPipeline), kind: 'regenerable' },
  { name: 'Data-Public (scraped telemetry)', mb: mb(dataPublic), kind: 'regenerable' },
  { name: 'Data-Given (sensitive grounding)', mb: mb(dataPrivate), kind: 'keep' },
  { name: '.git (version history)', mb: mb(git), kind: 'keep' },
  { name: 'Command Center + deliverables', mb: mb(ccDeliverables), kind: 'keep' },
  { name: 'Agent', mb: mb(agent), kind: 'keep' },
  { name: 'Other', mb: mb(other), kind: '' }
].filter(p => p.mb > 0).sort((a, b) => b.mb - a.mb);

const todayISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }); // YYYY-MM-DD
const updated = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
// `pipeline` = scraper-infra size over time (was msft-reporting ~110MB, now Data-Pipeline ~0.2MB). Old
// history rows carry the legacy `msft` key; the CC render falls back to it so the slim-down stays visible.
const todayRow = { date: todayISO, totalMb: mb(total), archive: mb(archive), dataPublic: mb(dataPublic), dataPrivate: mb(dataPrivate), pipeline: mb(dataPipeline), git: mb(git) };

let html = fs.readFileSync(CC, 'utf8');
const re = /\/\*STORAGE_REPORT_START\*\/[\s\S]*?\/\*STORAGE_REPORT_END\*\//;
if (!re.test(html)) { console.error('build-storage-report: markers not found in CC'); process.exit(1); }

// preserve prior daily history, replace today's row (end-of-day upsert), keep ~60 days
let history = [];
try {
  const inner = html.match(re)[0].replace('/*STORAGE_REPORT_START*/', '').replace('/*STORAGE_REPORT_END*/', '');
  const prev = JSON.parse(inner);
  if (Array.isArray(prev.history)) history = prev.history.filter(h => h.date !== todayISO);
} catch (e) {}
history.unshift(todayRow);
history.sort((a, b) => (a.date < b.date ? 1 : -1));
history = history.slice(0, 60);

const obj = { updated, totalMb: mb(total), pieces, history };
html = html.replace(re, '/*STORAGE_REPORT_START*/' + JSON.stringify(obj) + '/*STORAGE_REPORT_END*/');
fs.writeFileSync(CC, html);
console.log('build-storage-report: total ' + obj.totalMb + ' MB across ' + pieces.length + ' pieces; history ' + history.length + ' day(s)');

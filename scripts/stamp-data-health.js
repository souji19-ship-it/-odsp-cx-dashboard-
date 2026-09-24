// Maintains the Data Health + Audit stamps (dhStamps) in ODSP-AW-CC.html. Run hourly by
// cc-maintenance.ps1 (+ the ODSP-AW-Hourly-Maintenance Windows task) so the stamps never go stale
// even when the Copilot CLI is closed. Honest, content-based dating (never hand-set):
//   cowork/spark/ideas = REAL last-modified date of each canonical Data-Public source file
//   dataUpdated        = the freshest of those (the "last updated" for the DATA sections)
//   auditVerified      = the last FULL audit re-verify date; bumped ONLY when run with --audit (the
//                        7am refresh + nightly close-out, which actually re-verify), preserved otherwise
//   checked            = when this script last inspected the files (run-time, not a content date)
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const CC = path.join(ROOT, 'Data-Private', 'Data-Created', 'ODSP-AW-CC.html');
const DP = path.join(ROOT, 'Data-Public');
const TZ = { timeZone: 'America/Chicago' };
const MD = Object.assign({ month: 'short', day: 'numeric' }, TZ);
const MDY = Object.assign({ year: 'numeric', month: 'short', day: 'numeric' }, TZ);
const MDYT = Object.assign({ year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }, TZ);
const HM = Object.assign({ hour: 'numeric', minute: '2-digit' }, TZ);
// Exact "Jun 27, 2026 · 2:30 AM CST" for the per-cell Data Inventory provenance (read live from file mtime).
const fmtWhen = (ms) => ms ? (new Date(ms).toLocaleString('en-US', MDY) + ' · ' + new Date(ms).toLocaleTimeString('en-US', HM) + ' CST') : '\u2014';

function mtimeMs(rel) { try { return fs.statSync(path.join(DP, rel)).mtimeMs; } catch (e) { return 0; } }
function newestMs(dir) {
  let best = 0;
  (function walk(p) {
    let es; try { es = fs.readdirSync(p, { withFileTypes: true }); } catch (e) { return; }
    for (const e of es) {
      const f = path.join(p, e.name);
      if (e.isDirectory()) walk(f);
      else if (/\.(json|csv)$/i.test(e.name) && !/scrape-log|_scrape-meta|_manifest/i.test(e.name)) {
        try { const m = fs.statSync(f).mtimeMs; if (m > best) best = m; } catch (e2) {}
      }
    }
  })(path.join(DP, dir));
  return best;
}
const fmt = (ms, opt) => ms ? new Date(ms).toLocaleString('en-US', opt) : '—';

const coworkMs = mtimeMs('cowork/tools.json');
const sparkMs = mtimeMs('spark/dashboard-api-response.json');
const sparkToolMs = mtimeMs('spark/spark-tool-health.json');
// SPARK tool-health (AugLoop) can return an error payload (cluster timeout) yet still write a fresh-mtime
// file; detect that so we never stamp an erroring source as fresh data (a freshness label must reflect a real pull).
const sparkToolErr = (() => { try { const o = JSON.parse(fs.readFileSync(path.join(DP, 'spark/spark-tool-health.json'), 'utf8')); return !!(o && ((o.summary && o.summary.error) || (o.daily_trend && o.daily_trend.error))); } catch (e) { return false; } })();
const ideasMs = newestMs('ideas');
const dataMaxMs = Math.max(coworkMs, sparkMs, ideasMs);

let html = fs.readFileSync(CC, 'utf8');
const re = /\/\*DH_STAMP_START\*\/([\s\S]*?)\/\*DH_STAMP_END\*\//;
const cur = re.exec(html);
if (!cur) { console.error('stamp-data-health: markers not found in CC'); process.exit(1); }
let prevAudit = fmt(Date.now(), MDY);
try { const o = JSON.parse(cur[1]); if (o.auditVerified) prevAudit = o.auditVerified; } catch (e) { /* first run */ }
const reVerify = process.argv.includes('--audit');
const auditVerified = reVerify ? fmt(Date.now(), MDY) : prevAudit;

const stamps = {
  checked: fmt(Date.now(), MDYT),
  cowork: fmt(coworkMs, MD),
  spark: fmt(sparkMs, MD),
  sparkTool: sparkToolErr ? '\u26a0\ufe0f erroring' : fmt(sparkToolMs, MD),
  ideas: fmt(ideasMs, MD),
  dataUpdated: fmt(dataMaxMs, MDY),
  auditVerified: auditVerified,
};
html = html.replace(re, '/*DH_STAMP_START*/' + JSON.stringify(stamps) + '/*DH_STAMP_END*/');

// ---- Per-source provenance for the Data Inventory ledger: PULLED (scrape/ingest time) + DATA AS-OF
//      (the date the data itself represents). BOTH read live from the real files — never hand-set.
function readJsonDP(rel) { try { return JSON.parse(fs.readFileSync(path.join(DP, rel), 'utf8')); } catch (e) { return null; } }
function csvLast(rel) { // last row's first column (data Date) + its scraped_at column, as ms
  try {
    const lines = fs.readFileSync(path.join(DP, rel), 'utf8').trim().split(/\r?\n/);
    if (lines.length < 2) return {};
    const sIdx = lines[0].split(',').indexOf('scraped_at');
    const last = lines[lines.length - 1].split(',');
    const dd = new Date(last[0]); const sd = sIdx >= 0 ? new Date(last[sIdx]) : null;
    return { date: isNaN(dd) ? 0 : dd.getTime(), scraped: sd && !isNaN(sd) ? sd.getTime() : 0 };
  } catch (e) { return {}; }
}
const fmtDay = (ms) => ms ? new Date(ms).toLocaleString('en-US', MDY) : '\u2014';
const prov = (pulledMs, asOfMs, asOfLabel) => ({ pulled: fmtWhen(pulledMs), asOf: asOfMs ? fmtDay(asOfMs) : (asOfLabel || '\u2014') });

const cMeta = readJsonDP('cowork/_scrape-meta.json') || {};
const cPulledMs = cMeta.scrapedAt ? new Date(cMeta.scrapedAt).getTime() : coworkMs;
const cAsOfMs = cMeta.date ? new Date(cMeta.date + 'T12:00:00Z').getTime() : 0;
const spWau = csvLast('ideas/m365-copilot/copilot-in-sharepoint-wau.csv');
const odWau = csvLast('ideas/sp-subproducts/od-all-up-wau.csv');
const spSub = csvLast('ideas/sp-subproducts/sp-all-up-wau.csv');
const ocvMs = mtimeMs('ocv/odsp-copilot-thumbs.json');

const dhSrc = {
  coworkTools:    prov(cPulledMs, cAsOfMs),
  coworkSummary:  prov(cPulledMs, cAsOfMs),
  coworkFunnel:   prov(cPulledMs, cAsOfMs),
  coworkFeedback: prov(mtimeMs('cowork/feedback.json'), 0, 'weekly'),
  ideasSp:        prov(spWau.scraped, spWau.date),
  ideasOd:        prov(odWau.scraped, odWau.date),
  ideasSpSub:     prov(spSub.scraped, spSub.date),
  sparkWau:       prov(sparkMs, 0, 'weekly'),
  sparkRet:       prov(mtimeMs('spark/kav2/weekly-retention.csv'), 0, 'weekly'),
  sparkTool:      sparkToolErr ? prov(0, 0, '\u26a0\ufe0f source erroring (AugLoop)') : prov(sparkToolMs, 0, 'rolling 7d'),
  ocvThumbs:      prov(ocvMs, 0, 'rolling 30d'),
};
const reSrc = /\/\*DH_SOURCES_START\*\/([\s\S]*?)\/\*DH_SOURCES_END\*\//;
if (reSrc.test(html)) html = html.replace(reSrc, '/*DH_SOURCES_START*/' + JSON.stringify(dhSrc) + '/*DH_SOURCES_END*/');

fs.writeFileSync(CC, html);
console.log('stamp-data-health: checked ' + stamps.checked + ' | data ' + stamps.dataUpdated + ' (cowork ' + stamps.cowork + ' / spark ' + stamps.spark + ' / ideas ' + stamps.ideas + ') | auditVerified ' + stamps.auditVerified + (reVerify ? ' (re-verified now)' : ''));

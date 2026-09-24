// Regenerates a frozen HTML archive of the Decisions Made + Activity Log
// sections from the ODSP-AW Command Center. Run at the top of every hour.
const fs = require('fs');
const path = require('path');
const CC_DIR = path.resolve(__dirname, '..', 'Data-Private', 'Data-Created');
const SRC = path.join(CC_DIR, 'ODSP-AW-CC.html');
const OUT_ACTIVITY = path.join(CC_DIR, 'Records', 'activity-log.html');
const OUT_DECISIONS = path.join(CC_DIR, 'Records', 'decisions-made.html');
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

const html = fs.readFileSync(SRC, 'utf8');

// 1. Activity Log (from the statusLog data array)
let activity = '<p style="color:#95a3b8">(activity log not found)</p>';
const sl = html.match(/const statusLog=(\[[\s\S]*?\]);/);
if (sl) {
  let data = null;
  try { data = eval('(' + sl[1] + ')'); } catch (e) { data = null; }
  if (data) {
    const tc = { build:'#1d9bf0', analysis:'#fbbf24', data:'#36d399' };
    const tl = { build:'BUILD', analysis:'ANALYSIS', data:'DATA' };
    activity = data.map(function (day) {
      return '<h3>' + esc(day.date) + '</h3>' + day.entries.map(function (e) {
        return '<div class="entry"><div class="t">' + esc((e.date ? e.date + ' · ' : '') + e.time + ' CST') + '</div><div>' +
          '<div class="row1"><span class="tag" style="color:' + (tc[e.type] || '#95a3b8') + '">' + (tl[e.type] || '') + '</span><strong>' + esc(e.title) + '</strong></div>' +
          '<div class="d">' + esc(e.detail) + '</div></div></div>';
      }).join('');
    }).join('');
  }
}

// 2. Decisions Made (raw inner HTML of the section)
let decisions = '<p style="color:#95a3b8">(decisions not found)</p>';
const dm = html.match(/<h3>🧭 Decisions Made<\/h3>([\s\S]*?)<\/section>/);
if (dm) decisions = dm[1]
  .replace(/<p class="dm-archive-link"[\s\S]*?<\/p>/g, '')   // CC-only "view full" link
  .replace(/ class="dm-extra"/g, '');                          // un-hide the extra rows in the archive

const now = new Date();
const stamp = now.toLocaleString('en-US', { timeZone:'America/Chicago', weekday:'short', year:'numeric', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });

const STYLE = ':root{--bg:#0f1419;--card:#1a2332;--text:#e7e9ea;--accent:#1d9bf0;--good:#36d399;--warn:#fbbf24;--bad:#f87171;--line:#314155;--muted:#95a3b8}' +
  '*{box-sizing:border-box}body{margin:0;font-family:"Segoe UI",system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);line-height:1.5}' +
  '.wrap{max-width:1000px;margin:0 auto;padding:36px 24px 60px}h1{font-size:24px;margin:0 0 4px}h3{font-size:14px;margin:20px 0 8px;color:var(--muted)}' +
  '.stamp{display:inline-block;margin:10px 0 18px;font-size:12px;color:var(--muted);background:rgba(29,155,240,.1);border:1px solid rgba(29,155,240,.25);padding:4px 12px;border-radius:20px}' +
  '.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px 20px;margin-bottom:18px}' +
  'table{width:100%;border-collapse:collapse;font-size:13.5px}th,td{text-align:left;padding:9px 11px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.05em}.nowrap{white-space:nowrap}.table-wrap{overflow-x:auto}' +
  '.entry{display:grid;grid-template-columns:160px 1fr;gap:14px;padding:11px 0;border-bottom:1px solid var(--line)}.entry .t{color:var(--muted);font-size:13px;font-weight:600}.entry .row1{display:flex;align-items:center;gap:8px;margin-bottom:3px}.entry .tag{font-size:10px;font-weight:700;letter-spacing:.08em}.entry .d{color:var(--muted);font-size:13px}' +
  'a{color:#7ec8ff;text-decoration:none}';
function page(title, body) {
  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>' + title + '</title><style>' + STYLE + '</style></head><body><div class="wrap">' +
    '<h1>' + title + '</h1>' +
    '<div class="stamp">Frozen snapshot &middot; ' + esc(stamp) + ' CST &middot; regenerated at the top of every hour</div>' +
    body + '</div></body></html>';
}
const decisionsDoc = page('🧭 Decisions Made — Archive', '<div class="card">' + decisions + '</div>');
const activityDoc = page('📜 Activity Log — Archive', '<div class="card">' + activity + '</div>');
fs.writeFileSync(OUT_DECISIONS, decisionsDoc, 'utf8');
fs.writeFileSync(OUT_ACTIVITY, activityDoc, 'utf8');
console.log('Wrote ' + OUT_DECISIONS + ' (' + decisionsDoc.length + ' bytes)');
console.log('Wrote ' + OUT_ACTIVITY + ' (' + activityDoc.length + ' bytes)');

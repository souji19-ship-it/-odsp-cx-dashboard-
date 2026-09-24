// Generates one standalone HTML page per Memo (Records/M0000N.html) from the
// memoLog array in ODSP-AW-CC.html. Idempotent — overwrites on every run, so
// future memos get a page automatically (wired into cc-maintenance.ps1).
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CC = path.join(ROOT, 'Data-Private', 'Data-Created', 'ODSP-AW-CC.html');
const OUTDIR = path.join(ROOT, 'Data-Private', 'Data-Created', 'Records');

const html = fs.readFileSync(CC, 'utf8');

// --- extract the memoLog array with a string-aware bracket scan ---
const marker = 'const memoLog=';
const mi = html.indexOf(marker);
if (mi < 0) { console.error('build-memo-pages: memoLog not found'); process.exit(1); }
let i = html.indexOf('[', mi);
const start = i;
let depth = 0, inStr = false, esc = false;
for (; i < html.length; i++) {
  const ch = html[i];
  if (inStr) {
    if (esc) esc = false;
    else if (ch === '\\') esc = true;
    else if (ch === '"') inStr = false;
    continue;
  }
  if (ch === '"') inStr = true;
  else if (ch === '[') depth++;
  else if (ch === ']') { depth--; if (depth === 0) { i++; break; } }
}
const arrayText = html.slice(start, i);
let memoLog;
try { memoLog = eval('(' + arrayText + ')'); }
catch (e) { console.error('build-memo-pages: eval memoLog failed:', e.message); process.exit(1); }

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function page(m, genDate) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${m.id} - ODSP-AW Memo</title>
<style>
:root{--bg:#ffffff;--card:#ffffff;--soft:#f4f6f9;--text:#1b1f24;--accent:#0f6cbd;--good:#107c10;--warn:#b26b00;--bad:#c4314b;--line:#e3e8ef;--muted:#5b6675}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.65 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:960px;margin:0 auto;padding:34px 26px 80px}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
.back{display:inline-block;font-size:13px;font-weight:600;margin-bottom:22px;color:var(--accent)}
.meta{font-size:11.5px;color:var(--muted);letter-spacing:.08em;text-transform:uppercase;font-weight:700;margin-bottom:9px}
h1{font-size:24px;line-height:1.3;margin:0 0 20px;letter-spacing:-.01em;color:#0d1117}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:30px 34px;box-shadow:0 1px 3px rgba(16,22,30,.04),0 8px 26px rgba(16,22,30,.05)}
.answer{font-size:14.5px;line-height:1.7;word-wrap:break-word}
.answer>:first-child{margin-top:0}
.answer strong{color:#0d1117;font-weight:650}
.answer p{margin:11px 0}
.answer .muted{color:var(--muted);font-weight:400}
.answer .lead{background:#eef5fc;border-left:3px solid var(--accent);border-radius:10px;padding:16px 18px;margin:0 0 22px;font-size:15px;line-height:1.62}
.answer .focus{background:#fff7e6;border:1px solid #f0dba8;border-left:3px solid #b26b00;border-radius:10px;padding:14px 18px;margin:0 0 22px;font-size:15px;line-height:1.6}
.answer .toc{background:var(--soft);border:1px solid var(--line);border-radius:12px;padding:16px 20px;margin:0 0 26px}
.answer .toc-title{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0 0 10px}
.answer .toc ol{margin:0;padding-left:20px;columns:2;column-gap:30px}
.answer .toc li{margin:4px 0;line-height:1.45;font-size:13.5px;break-inside:avoid}
.answer h2{font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--accent);margin:32px 0 13px;padding-bottom:8px;border-bottom:2px solid var(--line);scroll-margin-top:14px}
.answer h3{font-size:14.5px;font-weight:700;color:#0d1117;margin:20px 0 8px}
.answer ul{margin:9px 0;padding-left:20px}
.answer li{margin:6px 0;line-height:1.6}
.answer table{width:100%;border-collapse:collapse;margin:12px 0 16px;font-size:12.5px}
.answer thead th{color:var(--muted);font-size:11px;letter-spacing:.04em;text-transform:uppercase;font-weight:700;text-align:left;padding:8px 11px;border-bottom:2px solid var(--line);background:var(--soft)}
.answer tbody td{padding:9px 11px;text-align:left;vertical-align:top;border-bottom:1px solid var(--line)}
.answer tbody tr:nth-child(even){background:#fafbfd}
.answer tbody tr:last-child td{border-bottom:none}
.answer .note{margin:28px 0 0;font-size:12.5px;color:var(--muted);font-style:italic;border-top:1px solid var(--line);padding-top:16px}
.foot{margin-top:28px;font-size:12px;color:var(--muted);border-top:1px solid var(--line);padding-top:14px}
</style></head>
<body><div class="wrap">
<a class="back" href="../ODSP-AW-CC.html">&larr; ODSP-AW Command Center &middot; Tracker</a>
<div class="meta">&#128221; Memo ${m.id} &middot; ${escapeHtml(m.cat || '')} &middot; ${escapeHtml(m.when || '')}</div>
<h1>${m.q}</h1>
<div class="card"><div class="answer">${m.a}</div></div>
<div class="foot">ODSP-AW Command Center &middot; Memo ${m.id} &middot; page generated ${escapeHtml(genDate)} CST &middot; verify data against source before sharing externally.</div>
</div></body></html>`;
}

if (!fs.existsSync(OUTDIR)) fs.mkdirSync(OUTDIR, { recursive: true });
const genDate = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });
let n = 0;
memoLog.forEach(function (m) {
  if (!m || !m.id) return;
  if (m.file) return; // memo points at an existing Records page; no generated page
  fs.writeFileSync(path.join(OUTDIR, m.id + '.html'), page(m, genDate));
  n++;
});
console.log('build-memo-pages: wrote ' + n + ' memo page(s) to Records/ (M0000N.html)');

// --- memo index (Records/ODSP-AW-CC-Memos.html) — the "view all" target for the Archive memo card ---
var idxRows = memoLog.map(function (m) {
  if (!m || !m.id) return '';
  var href = m.file || (m.id + '.html');
  return '<tr><td class="id"><a href="' + href + '">' + escapeHtml(m.id) + '</a></td>' +
    '<td class="when">' + escapeHtml(m.when || '') + '</td>' +
    '<td class="cat">' + escapeHtml(m.cat || '') + '</td>' +
    '<td><a href="' + href + '">' + escapeHtml(m.q || '') + '</a></td></tr>';
}).join('');
var idxPage = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>Memo Log - ODSP-AW</title><style>' +
  ':root{--bg:#ffffff;--card:#ffffff;--soft:#f4f6f9;--text:#1b1f24;--accent:#0f6cbd;--line:#e3e8ef;--muted:#5b6675}' +
  '*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif}' +
  '.wrap{max-width:980px;margin:0 auto;padding:28px 22px 60px}a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}' +
  '.back{display:inline-block;font-size:13px;font-weight:600;margin-bottom:18px;opacity:.85}h1{font-size:22px;margin:0 0 4px}' +
  '.sub{color:var(--muted);font-size:13px;margin:0 0 20px}table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}' +
  'th,td{border-bottom:1px solid var(--line);padding:10px 12px;text-align:left;vertical-align:top;font-size:13.5px}th{background:rgba(29,155,240,.12);font-size:12px;text-transform:uppercase;letter-spacing:.05em}' +
  'td.id a{font-family:Consolas,monospace;font-weight:700}td.when{color:var(--muted);font-size:12px;white-space:nowrap}td.cat{color:var(--accent);font-size:12px;font-weight:600;white-space:nowrap}' +
  '</style></head><body><div class="wrap">' +
  '<a class="back" href="../ODSP-AW-CC.html">&larr; ODSP-AW Command Center</a>' +
  '<h1>&#128221; Memo Log</h1><p class="sub">All ' + memoLog.length + ' memos, newest first &middot; generated ' + escapeHtml(genDate) + ' CST</p>' +
  '<table><thead><tr><th>Memo</th><th>When</th><th>Category</th><th>Question</th></tr></thead><tbody>' + idxRows + '</tbody></table>' +
  '</div></body></html>';
fs.writeFileSync(path.join(OUTDIR, 'ODSP-AW-CC-Memos.html'), idxPage);
console.log('build-memo-pages: wrote memo index (ODSP-AW-CC-Memos.html, ' + memoLog.length + ' memos)');

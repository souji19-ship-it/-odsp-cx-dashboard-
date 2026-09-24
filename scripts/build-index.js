// Builds an index page (Comms, Findings, Connections, Attention) from the consolidated entries/ folder.
// Each deliverable HTML becomes one entry; newest (highest number) first.
// Re-run anytime (hourly job) so newly created files auto-appear.
const fs = require('fs');
const path = require('path');
const CC = path.resolve(__dirname, '..', 'Data-Private', 'Data-Created') + path.sep;

function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

const STYLE =
  ':root{--bg:#0f1419;--card:#1a2332;--text:#e7e9ea;--accent:#1d9bf0;--good:#36d399;--warn:#fbbf24;--bad:#f87171;--line:#314155;--muted:#95a3b8}' +
  '*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:"Segoe UI",Arial,sans-serif;line-height:1.5}' +
  '.wrap{max-width:920px;margin:0 auto;padding:36px 24px 64px}h1{margin:0 0 4px;font-size:26px}' +
  '.sub{color:var(--muted);font-size:13px;margin:0 0 4px}.back{display:inline-block;margin:8px 0 24px;font-size:13px;color:#7ec8ff;text-decoration:none}' +
  '.entry{display:flex;gap:18px;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px 22px;margin-bottom:16px}' +
  '.num{flex:0 0 64px;height:64px;border-radius:14px;background:rgba(29,155,240,.12);border:1px solid rgba(29,155,240,.3);color:#9bd4ff;font-size:20px;font-weight:800;display:flex;align-items:center;justify-content:center}' +
  '.body{flex:1;min-width:0}.body h2{margin:0 0 4px;font-size:17px}.file{color:var(--muted);font-size:12px;font-family:Consolas,monospace}' +
  '.open{display:inline-block;margin-top:10px;background:rgba(54,211,153,.12);border:1px solid rgba(54,211,153,.35);color:#89f0c4;padding:7px 14px;border-radius:9px;font-size:13px;font-weight:600;text-decoration:none}';

function buildIndex(folder, prefix, indexFile, icon, indexTitle, label) {
  const dir = path.join(CC, folder);
  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith(prefix) && f.endsWith('.html') && f !== indexFile)
    .sort().reverse();   // descending = newest first
  const entries = files.map(function (f) {
    let title = f;
    try { const m = fs.readFileSync(path.join(dir, f), 'utf8').match(/<title>([^<]*)<\/title>/); if (m) title = m[1].trim(); } catch (e) {}
    const num = (f.match(/\d{3,4}/) || ['—'])[0].replace(/^0+/, '');
    return '<section class="entry"><div class="num">#' + esc(num) + '</div><div class="body">' +
      '<h2>' + esc(title) + '</h2><div class="file">' + esc(f) + '</div>' +
      '<a class="open" href="./' + f + '" target="_blank">Open →</a></div></section>';
  }).join('');
  const stamp = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + indexTitle + '</title><style>' + STYLE + '</style></head><body><div class="wrap">' +
    '<h1>' + icon + ' ' + indexTitle + '</h1>' +
    '<div class="sub">' + files.length + ' ' + label + ' · newest first · regenerated ' + esc(stamp) + ' CST</div>' +
    '<a class="back" href="../ODSP-AW-CC.html">← Command Center</a>' +
    (entries || '<p class="sub">No items yet.</p>') +
    '</div></body></html>';
  fs.writeFileSync(path.join(dir, indexFile), html, 'utf8');
  console.log('Wrote ' + folder + '/' + indexFile + ' (' + files.length + ' items)');
}

buildIndex('Records', 'Comms', 'ODSP-AW-CC-Comms.html', '📎', 'ODSP-AW-CC-Comms', 'communications & documents');
buildIndex('Records', 'Findings', 'ODSP-AW-CC-Fings.html', '🩺', 'ODSP-AW-CC-Fings', 'findings');
buildIndex('Records', 'Connections', 'ODSP-AW-CC-Connections.html', '🔗', 'ODSP-AW-CC-Connections', 'connections');
buildIndex('Records', 'Attention', 'ODSP-AW-CC-Attention.html', '🔔', 'ODSP-AW-CC-Attention', 'attention items');

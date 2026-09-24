// Keeps the Daily Effort Ticker honest + deterministic so it never freezes OR shows a fresh
// timestamp on stale numbers. Run hourly by cc-maintenance.ps1 (+ the ODSP-AW-Hourly-Maintenance
// Windows task), so the ticker rolls even when the Copilot CLI is closed.
//
// Each run, for TODAY's row (CST) it recomputes — straight from the day's work log (the
// progressBoard) so it matches the stated methodology "estimated from the day's work log
// (board categories)":
//   • prompts  = number of board rows logged today (one row per ask; an approximate proxy)
//   • ops/data/ins = HOURS, = today's logged work span split by category share, where
//       Operations = UI / Operational / Governance, Data = Data, Insights = Strategic.
// Then it refreshes the WHEN stamp. Figures are approximate (the "~" + the row note say so).
const fs = require('fs');
const path = require('path');
const CC = path.join(__dirname, '..', 'Data-Private', 'Data-Created', 'ODSP-AW-CC.html');
let s = fs.readFileSync(CC, 'utf8');
const EOL = s.includes('\r\n') ? '\r\n' : '\n';
const tnow = new Date();
const today = tnow.toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric' });

// 1) Refresh the WHEN stamp (date + time CST) — shows when the ticker was last rolled/recomputed.
const stampNow = today + ' · ' + tnow.toLocaleString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit', hour12: true }) + ' CST';
const ta = s.indexOf('/*TICKER_STAMP_START*/'), tb = s.indexOf('/*TICKER_STAMP_END*/');
if (ta >= 0 && tb > ta) { s = s.slice(0, ta) + '/*TICKER_STAMP_START*/"' + stampNow + '"/*TICKER_STAMP_END*/' + s.slice(tb + '/*TICKER_STAMP_END*/'.length); }

// 2) Derive today's prompts + Ops/Data/Insights hours from today's board rows.
const OPS = { UI: 1, Operational: 1, Governance: 1 }, DATA = { Data: 1 }, INS = { Strategic: 1 };
let prompts = 0, ops = 0, data = 0, ins = 0;
const ba = s.indexOf('const progressBoard=[');
const bb = s.indexOf('const tickerStamp', ba);
if (ba >= 0 && bb > ba) {
  const rows = s.slice(ba, bb).split('{id:"pb').slice(1);
  let oC = 0, dC = 0, iC = 0; const mins = [];
  rows.forEach(function (c) {
    const tsm = /ts:"([^"]*)"/.exec(c); if (!tsm || tsm[1].indexOf(today) < 0) return;
    prompts++;
    const cm = /cat:"([^"]*)"/.exec(c); const cat = cm ? cm[1] : '';
    if (OPS[cat]) oC++; else if (DATA[cat]) dC++; else if (INS[cat]) iC++; else oC++;
    const tm = /·\s*([0-9]{1,2}):([0-9]{2})\s*(AM|PM)/.exec(tsm[1]);
    if (tm) { let h = (+tm[1]) % 12; if (tm[3] === 'PM') h += 12; mins.push(h * 60 + (+tm[2])); }
  });
  const span = mins.length ? (Math.max.apply(null, mins) - Math.min.apply(null, mins)) / 60 : 0;
  const tot = oC + dC + iC || 1;
  ops = Math.round(span * oC / tot);
  data = Math.round(span * dC / tot);
  ins = Math.round(span * iC / tot);
  // keep a category visible even on a short span where hours round to 0
  if (span > 0) { if (oC && !ops) ops = 1; if (dC && !data) data = 1; if (iC && !ins) ins = 1; }
}

// 3) Build today's row and place it at the top of effortTicker (replace if present, else prepend).
const note = 'Auto-estimated each hour by roll-ticker from the day work-log board categories (Operations = UI/Operational/Governance, Data = Data, Insights = Strategic), split over the logged work span. Prompts = the number of asks logged on the board today. Figures are approximate.';
const newRow = '{date:"' + today + '", prompts:' + prompts + ', ops:' + ops + ', data:' + data + ', ins:' + ins + ', inProgress:true, note:"' + note + '"}';

const marker = 'const effortTicker=[';
const mi = s.indexOf(marker);
if (mi < 0) { console.error('roll-ticker: effortTicker not found'); process.exit(1); }
const o1 = s.indexOf('{', mi + marker.length);
const o2 = s.indexOf('}', o1);
const firstRow = s.slice(o1, o2 + 1);
const dm = /date:"([^"]+)"/.exec(firstRow);
if (dm && dm[1] === today) {
  s = s.slice(0, o1) + newRow + s.slice(o2 + 1);
  console.log('roll-ticker: recomputed today (' + today + ') -> prompts ' + prompts + ', ops ' + ops + 'h / data ' + data + 'h / ins ' + ins + 'h; stamp ' + stampNow + '.');
} else {
  const prior = firstRow.replace('inProgress:true', 'inProgress:false');
  s = s.slice(0, o1) + newRow + ',' + EOL + '      ' + prior + s.slice(o2 + 1);
  console.log('roll-ticker: opened today (' + today + ') -> prompts ' + prompts + ', ops ' + ops + 'h / data ' + data + 'h / ins ' + ins + 'h; closed prior row; stamp ' + stampNow + '.');
}
fs.writeFileSync(CC, s);

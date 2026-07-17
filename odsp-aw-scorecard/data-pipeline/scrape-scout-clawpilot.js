'use strict';
/* scrape-scout-clawpilot.js — CDP-capture the IDEAS provisional ClawpilotUsage dashboard.
   Connects to debug Edge (port 9222), opens the dashboard, records all JSON/data network
   responses + dumps visible tables. First run needs interactive corp SSO in the debug window. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = 'https://askideas.microsoft.net/provisional/ClawpilotUsage';
const OUT = path.join(__dirname, 'clawpilot-capture');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const ctx = browser.contexts()[0] || await browser.newContext();
  const page = await ctx.newPage();

  const captured = [];
  page.on('response', async (resp) => {
    try {
      const url = resp.url();
      const ct = (resp.headers()['content-type'] || '').toLowerCase();
      if (!/json|text\/plain/.test(ct)) return;
      if (/\.(js|css|png|svg|woff|ico)(\?|$)/i.test(url)) return;
      const body = await resp.text();
      if (body.length < 40) return;
      // keep only bodies that look like data (arrays / numeric-heavy)
      if (!/[\[{]/.test(body)) return;
      const isDash = /dynamic-dashboards/i.test(url);
      if (isDash) {
        const nm = url.includes('ClawpilotUsage') ? 'full-summary' : 'full-dashboards';
        fs.writeFileSync(path.join(OUT, nm + '.json'), body);
        process.stderr.write(`  SAVED FULL ${nm} (${body.length}b)\n`);
      }
      captured.push({ url, status: resp.status(), ct, len: body.length, body: body.slice(0, isDash ? 200 : 20000) });
      process.stderr.write(`  captured ${resp.status()} ${url.slice(0,90)} (${body.length}b)\n`);
    } catch {}
  });

  process.stderr.write(`Navigating to ${URL} ...\n`);
  try { await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 }); } catch (e) { process.stderr.write('goto: ' + e.message + '\n'); }

  // Give SSO + dashboard data time to load; poll for tables/numbers.
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(3000);
    const title = await page.title().catch(() => '');
    const url = page.url();
    process.stderr.write(`  t+${(i+1)*3}s url=${url.slice(0,70)} title="${title.slice(0,50)}" captured=${captured.length}\n`);
    if (/login|signin|sign in/i.test(url + title)) continue; // still on SSO
    if (captured.length > 0 && i > 3) break;
  }

  // Dump DOM text + any tables
  const dom = await page.evaluate(() => {
    const tables = [...document.querySelectorAll('table')].map(t => t.innerText.slice(0, 4000));
    const kpis = [...document.querySelectorAll('[class*=kpi],[class*=card],[class*=metric],[class*=tile]')]
      .map(e => e.innerText.trim()).filter(x => x && x.length < 400).slice(0, 60);
    return { url: location.href, title: document.title, bodyText: document.body.innerText.slice(0, 8000), tables, kpis };
  }).catch(e => ({ error: e.message }));

  fs.writeFileSync(path.join(OUT, 'network.json'), JSON.stringify(captured, null, 2));
  fs.writeFileSync(path.join(OUT, 'dom.json'), JSON.stringify(dom, null, 2));
  process.stderr.write(`\nSaved ${captured.length} network bodies + DOM to ${OUT}\n`);
  console.log(JSON.stringify({ finalUrl: dom.url, title: dom.title, captured: captured.length, tables: (dom.tables||[]).length, kpis: (dom.kpis||[]).length }));
  await page.close();
  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });

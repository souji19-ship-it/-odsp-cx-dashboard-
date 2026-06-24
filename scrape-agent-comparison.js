'use strict';

/**
 * scrape-agent-comparison.js
 *
 * Scrapes the "Agent Comparison" tab on the IDEAS Copilot Cowork Usage
 * standalone report:
 *   https://askideas.microsoft.net/AppsStandaloneReports/CopilotCoworkUsage
 *
 * Data path:
 *   The page renders the dashboard into a self-contained iframe (blob: URL).
 *   The full agent-comparison dataset is embedded in that iframe as a
 *   gzipped + base64-encoded CSV in a JS variable `CSV_TOP_AGENTS`.
 *
 *   We:
 *     1. Connect to Edge over CDP, navigate to the report (auth = AAD SSO).
 *     2. Wait for the blob iframe to load.
 *     3. Pull the iframe HTML, extract the CSV_TOP_AGENTS literal.
 *     4. base64-decode + gunzip + parse CSV.
 *     5. Aggregate weekly rows (TrendType=RL7) by (Date, ExtensionName) —
 *        summing ActiveUserCount across all tenant/frontier breakdowns.
 *        This matches the dashboard's "All" filter behaviour.
 *     6. Upsert one CSV per agent under data/agent-comparison/.
 *
 * Output: data/agent-comparison/{agent-slug}.csv
 *   columns: Date,WAU,AppType,scraped_at
 *
 * Plus a meta file data/agent-comparison/_agents.json listing every
 * agent with its display name, AppType, slug, latest WAU, latest date.
 *
 * Usage:
 *   node scrape-agent-comparison.js
 *   MIN_SCRAPE_AGE_HOURS=0 node scrape-agent-comparison.js   # force re-scrape
 */

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

const { connectToEdge } = require('./lib/cdp-connect');
const store = require('./lib/data-store');

const REPORT_URL = 'https://askideas.microsoft.net/AppsStandaloneReports/CopilotCoworkUsage';
const TAB_PATH   = 'agent-comparison';
const MIN_SCRAPE_AGE_HOURS = parseInt(process.env.MIN_SCRAPE_AGE_HOURS || '6', 10);

// ── Helpers ───────────────────────────────────────────────────────────────────

// "5/30/2026" → "2026-05-30"
function normalizeDate(s) {
  if (!s) return '';
  const m = String(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return s;
  const [, mo, d, y] = m;
  return `${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = lines[0].split(',');
  return lines.slice(1).map(line => {
    const vals = line.split(',');
    const row = {};
    for (let i = 0; i < headers.length; i++) row[headers[i]] = vals[i] ?? '';
    return row;
  });
}

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function fmt(n) {
  if (n == null || isNaN(n)) return '-';
  return n >= 1_000_000 ? `${(n/1_000_000).toFixed(1)}M`
       : n >= 1_000     ? `${(n/1_000).toFixed(1)}K`
       : String(n);
}

// ── Iframe / CSV extraction ───────────────────────────────────────────────────

async function loadReportPage(page) {
  console.log(`  → Navigating to ${REPORT_URL}`);
  await page.goto(REPORT_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  // The dashboard is rendered inside a blob: iframe that is built client-side
  // after the SPA mounts. Poll for it AND for the embedded CSV payload —
  // the tab buttons render before the (large) data literal is in place.
  console.log('  → Waiting for blob iframe with CSV payload');
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const frame = page.frames().find(f => f.url().startsWith('blob:'));
    if (frame) {
      const ready = await frame.evaluate(
        () => document.body && document.body.innerHTML.length > 5_000_000 &&
              document.documentElement.outerHTML.indexOf('CSV_TOP_AGENTS') > -1
      ).catch(() => false);
      if (ready) return frame;
    }
    await page.waitForTimeout(2000);
  }
  throw new Error('Timed out waiting for dashboard iframe with CSV_TOP_AGENTS payload');
}

async function getCsvTopAgents(frame) {
  // Grab the full iframe document HTML, locate the CSV_TOP_AGENTS literal.
  console.log('  → Pulling iframe HTML to extract CSV_TOP_AGENTS');
  const html = await frame.evaluate(() => document.documentElement.outerHTML);
  const marker = 'let CSV_TOP_AGENTS = `';
  const start  = html.indexOf(marker);
  if (start < 0) throw new Error('CSV_TOP_AGENTS declaration not found in iframe HTML');
  const contentStart = start + marker.length;
  const end = html.indexOf('`', contentStart);
  if (end < 0) throw new Error('CSV_TOP_AGENTS closing backtick not found');
  const b64 = html.slice(contentStart, end);
  if (!b64.startsWith('H4sI')) {
    throw new Error(`CSV_TOP_AGENTS payload does not look gzipped (first 8: ${b64.slice(0,8)})`);
  }
  const buf = Buffer.from(b64, 'base64');
  const csv = zlib.gunzipSync(buf).toString('utf8');
  console.log(`  ✓ Extracted ${(buf.length/1024).toFixed(1)} KB gzip → ${(csv.length/1024).toFixed(1)} KB CSV`);
  return csv;
}

// ── Aggregation ───────────────────────────────────────────────────────────────

/**
 * Convert raw CSV rows → per-agent weekly time series.
 * Matches the dashboard's "All" filter (no Frontier/Internal restriction):
 *   For each (Date, ExtensionName), sum ActiveUserCount across the
 *   IsMSFTTenant × IsFrontierTenant breakdowns that share that key.
 *   AppType is taken as the first non-empty value seen.
 */
function aggregateWeekly(rawRows) {
  const weekly = rawRows.filter(r => r.TrendType === 'RL7');
  // key = `${date}\u0001${name}` — kept simple to avoid string allocs
  const byKey = new Map();
  for (const r of weekly) {
    const name = r.ExtensionName;
    if (!name) continue;
    const date = normalizeDate(r.Date);
    if (!date) continue;
    const k = `${date}\u0001${name}`;
    const wau = Number(r.ActiveUserCount || 0);
    const prev = byKey.get(k);
    if (prev) {
      prev.WAU += wau;
    } else {
      byKey.set(k, {
        Date: date, ExtensionName: name, AppType: r.AppType || '', WAU: wau,
      });
    }
  }
  // Group by agent
  const byAgent = new Map();
  for (const r of byKey.values()) {
    if (!byAgent.has(r.ExtensionName)) {
      byAgent.set(r.ExtensionName, { name: r.ExtensionName, appType: r.AppType, rows: [] });
    }
    const a = byAgent.get(r.ExtensionName);
    a.rows.push({ Date: r.Date, WAU: r.WAU, AppType: r.AppType });
    if (!a.appType && r.AppType) a.appType = r.AppType;
  }
  // Sort rows per agent
  for (const a of byAgent.values()) {
    a.rows.sort((x, y) => x.Date.localeCompare(y.Date));
  }
  return byAgent;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║      IDEAS Agent Comparison Scraper                        ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  console.log(`Started: ${new Date().toLocaleString()}\n`);

  if (!store.shouldScrape(TAB_PATH, MIN_SCRAPE_AGE_HOURS)) {
    const last = store.getLastScrapeTime(TAB_PATH);
    const ageH = ((Date.now() - last.getTime()) / 3_600_000).toFixed(1);
    console.log(`↷ Skipping — last scraped ${last.toLocaleString()} (${ageH}h ago).`);
    console.log('  Pass MIN_SCRAPE_AGE_HOURS=0 to force a re-scrape.');
    return;
  }

  const { page } = await connectToEdge();
  try {
    const frame = await loadReportPage(page);
    const csv   = await getCsvTopAgents(frame);

    const raw  = parseCsv(csv);
    const byAgent = aggregateWeekly(raw);
    console.log(`  ✓ Parsed ${raw.length} CSV rows → ${byAgent.size} agents (Weekly / RL7)`);

    // Upsert each agent
    let totalAdded = 0, totalUpdated = 0;
    const meta = [];
    for (const a of byAgent.values()) {
      const slug = slugify(a.name);
      const chartTitle = a.name;
      const s = store.upsertTimeseries(
        TAB_PATH, chartTitle,
        ['Date', 'WAU', 'AppType'],
        a.rows, 'Date',
      );
      totalAdded   += s.added;
      totalUpdated += s.updated;
      const last = a.rows[a.rows.length - 1];
      meta.push({
        slug, name: a.name, appType: a.appType,
        latestWau: last?.WAU ?? null, latestDate: last?.Date ?? null,
        weeks: a.rows.length,
      });
    }

    // Write the index file
    meta.sort((a, b) => (b.latestWau || 0) - (a.latestWau || 0));
    const metaPath = path.join(store.DATA_DIR, TAB_PATH, '_agents.json');
    fs.writeFileSync(metaPath, JSON.stringify({
      scraped_at: new Date().toISOString(),
      source:     REPORT_URL,
      agents:     meta,
    }, null, 2));
    console.log(`  ✓ Wrote agent index → ${path.relative(process.cwd(), metaPath)}`);

    store.recordScrapeTime(TAB_PATH, {
      agents:        byAgent.size,
      rows_added:    totalAdded,
      rows_updated:  totalUpdated,
    });

    // Print top-10 summary
    console.log('\n── Top 10 agents (latest week) ──────────────────────────────');
    for (const m of meta.slice(0, 10)) {
      console.log(`  ${m.name.padEnd(30)} ${fmt(m.latestWau).padStart(8)}  (${m.latestDate})`);
    }
    console.log(`\n💾 +${totalAdded} new rows, ~${totalUpdated} updated across ${byAgent.size} agents`);
    console.log(`\nCompleted: ${new Date().toLocaleString()}`);
    console.log('✅ Done\n');
  } finally {
    // Don't close the page — keep the user's tab usable for next run
  }
}

// connectToEdge() keeps a CDP socket open which prevents Node from exiting.
// Force exit on success so scrape-all.js's orchestrator doesn't stall.
main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('\n❌ Fatal error:', err.message);
    console.error(err.stack);
    process.exit(1);
  });

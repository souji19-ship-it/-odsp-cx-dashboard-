'use strict';

/**
 * scrape-kav2-full.js
 *
 * Full KAv2 dashboard scraper.
 *
 * What this does differently from scrape-all-dashboards.js:
 *   - Intercepts the Superset chart data API calls as the page loads so we
 *     capture the full underlying dataset (every row of every timeseries),
 *     not just the summary value currently visible in the DOM.
 *   - Structured output per tab: one JSON file per tab with chart metadata +
 *     complete data, plus per-chart CSVs for timeseries and table charts.
 *   - Covers all sub-tabs of KAv2 Growth Analytics (Usage, Tools and task
 *     complexity, Intensity of usage, Starter Prompts analysis, Retention,
 *     Top Entry-Points) and the KAv2 summary tab.
 *
 * Usage:
 *   node scrape-kav2-full.js                   # scrape all tabs
 *   node scrape-kav2-full.js --tab Usage        # single tab
 *   SEND_EMAIL=0 node scrape-kav2-full.js       # suppress downstream
 */

const fs = require('fs');
const path = require('path');

const { connectToEdge, CDP_URL } = require('./lib/cdp-connect');
const { ensureLoggedIn } = require('./lib/nezha-auth');
const { captureDashboardCharts } = require('./lib/nezha-chart-data');
const store = require('./lib/data-store');

const MIN_SCRAPE_AGE_HOURS = parseInt(process.env.MIN_SCRAPE_AGE_HOURS || '6');

// ── Dashboard config ──────────────────────────────────────────────────────────

const KAV2_URL =
  'https://www.microsoftnezha.com/nezha/dashboard/a82f4c8e-6f29-4402-8fa1-c0af49a5132d/' +
  '?native_filters_key=iOIcu0pfBE05BLfowV8-q5iq1KeUnErct0NSidwW-ANMHTtA0GKIlMh2lZR8fpA3';

// Top-level tabs (the browser tabs in the Superset dashboard top nav)
// Sub-tab list refreshed 2026-06-14 against /p/m84JwjlzDVa/ permalink.
// Newly added since launch: Launch Dashboard - June 15, Localization,
// Tenant Deep Dive, Retention and repeat usage (renames "Retention").
// Skipped on purpose: "[Do not use] WIP Funnel".
const TOP_TABS = {
  'KAv2': null,           // no sub-tabs to iterate
  'KAv2 Growth Analytics': [
    'Launch Dashboard - June 15',
    'Usage',
    'Tools and task complexity',
    'Localization',
    'Tenant Deep Dive',
    'Retention and repeat usage',
    'Intensity of usage',
    'Top Entry-Points',
    'Starter Prompts analysis',
  ],
};

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const singleTabArg = (() => {
  const i = args.indexOf('--tab');
  return i >= 0 ? args[i + 1] : null;
})();

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║          KAv2 Full Dashboard Scraper                       ║');
  console.log('║          (intercepts Superset chart API for full data)     ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  console.log(`Started: ${new Date().toLocaleString()}\n`);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);

  try {
    // ── Connect to Edge (auto-launches if not already running with CDP) ──────────
    const { page } = await connectToEdge();

    // ── Ensure Nezha login ────────────────────────────────────────────────────
    console.log('\n── Authentication ──────────────────────────────────────────');
    const loggedIn = await ensureLoggedIn(page, KAV2_URL);
    if (!loggedIn) {
      throw new Error('Could not authenticate with Nezha. Manual login may be required.');
    }

    // ── Scrape each top-level tab ─────────────────────────────────────────────
    const allResults = {};

    for (const [topTabName, subTabs] of Object.entries(TOP_TABS)) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`TOP TAB: ${topTabName}`);
      console.log('='.repeat(60));

      if (subTabs === null) {
        // No sub-tabs — scrape the tab directly
        const result = await scrapeTab(page, topTabName, null, timestamp);
        allResults[topTabName] = result;
      } else {
        // Iterate sub-tabs
        allResults[topTabName] = {};

        // Determine which sub-tabs to scrape
        const tabsToScrape = singleTabArg
          ? subTabs.filter(t => t.toLowerCase() === singleTabArg.toLowerCase())
          : subTabs;

        if (tabsToScrape.length === 0) {
          console.log(`  ⚠️  No sub-tab matching --tab "${singleTabArg}" in ${topTabName}`);
          continue;
        }

        for (const subTab of tabsToScrape) {
          console.log(`\n── Sub-tab: ${subTab} ─────────────────────────────────────`);
          const result = await scrapeTab(page, topTabName, subTab, timestamp);
          allResults[topTabName][subTab] = result;
        }
      }
    }

    // ── Save combined summary ─────────────────────────────────────────────────
    const summaryFile = `kav2-full-summary-${timestamp}.json`;
    fs.writeFileSync(summaryFile, JSON.stringify(allResults, null, 2));
    console.log(`\n✓ Combined summary saved: ${summaryFile}`);

    console.log(`\nCompleted: ${new Date().toLocaleString()}`);
    console.log('✅ Done\n');

  } catch (err) {
    console.error('\n❌ Fatal error:', err.message);
    console.error(err.stack);
    // Best-effort debug screenshot
    await captureErrorScreenshot().catch(() => {});
    process.exit(1);
  }
}

// ── Per-tab scraper ───────────────────────────────────────────────────────────

/**
 * Scrape a single tab (and optional sub-tab).
 * Navigates to the dashboard, clicks the appropriate tab(s), waits for all
 * chart API responses to settle, and saves the results.
 *
 * @param {import('playwright').Page} page
 * @param {string} topTabName - e.g. "KAv2 Growth Analytics"
 * @param {string|null} subTabName - e.g. "Usage", or null
 * @param {string} timestamp - ISO-based slug for filenames
 * @returns {Promise<object>} captured chart data
 */
async function scrapeTab(page, topTabName, subTabName, timestamp) {
  const label   = subTabName ? `${topTabName} › ${subTabName}` : topTabName;
  const tabPath = store.tabToPath(topTabName, subTabName);

  // ── Skip if recently scraped ──────────────────────────────────────────────
  if (!store.shouldScrape(tabPath, MIN_SCRAPE_AGE_HOURS)) {
    const last = store.getLastScrapeTime(tabPath);
    const ageH = ((Date.now() - last.getTime()) / 3_600_000).toFixed(1);
    console.log(`\n↷ Skipping "${label}" — last scraped ${last.toLocaleString()} (${ageH}h ago, < ${MIN_SCRAPE_AGE_HOURS}h threshold)`);
    console.log('  Pass MIN_SCRAPE_AGE_HOURS=0 to force a re-scrape.');
    return null;
  }

  console.log(`\nScraping: ${label}`);

  const result = await captureDashboardCharts(page, KAV2_URL, {
    settleMs: 12000,
    timeout: 150000,

    onLoaded: async (p) => {
      console.log(`  → Clicking top tab: "${topTabName}"`);
      await findAndClickTab(p, topTabName, 'tab');

      if (subTabName) {
        console.log(`  → Clicking sub-tab: "${subTabName}"`);
        await page.waitForTimeout(1500);
        await findAndClickTab(p, subTabName, 'tab');
      }

      await p.evaluate(() => window.scrollTo(0, 0));
      await p.waitForTimeout(2000);
    },
  });

  // ── Write to data store ───────────────────────────────────────────────────
  let tsAdded = 0, tsUpdated = 0, snapAdded = 0, chartsStored = 0;

  for (const [title, chart] of Object.entries(result.charts)) {
    const data = chart.data;
    if (!data?.data?.length) continue;

    if (data.timeColumn) {
      // Timeseries — upsert by timestamp
      const s = store.upsertTimeseries(tabPath, title, data.colnames, data.data, data.timeColumn);
      tsAdded   += s.added;
      tsUpdated += s.updated;
    } else {
      // Snapshot — append dated block
      const s = store.appendSnapshot(tabPath, title, data.colnames, data.data);
      snapAdded += s.added;
    }
    chartsStored++;
  }

  store.recordScrapeTime(tabPath, {
    charts: Object.keys(result.charts).length,
    timeseries_added: tsAdded,
    timeseries_updated: tsUpdated,
    snapshot_rows_added: snapAdded,
  });

  // Summary
  const total    = Object.keys(result.charts).length;
  const withData = Object.values(result.charts).filter(c => c.data?.data?.length > 0).length;
  const domOnly  = Object.values(result.charts).filter(c => c.data === null).length;
  console.log(`  📊 ${total} chart(s): ${withData} with API data, ${domOnly} DOM-only`);
  console.log(`  💾 Store: +${tsAdded} new rows, ~${tsUpdated} updated (timeseries) | +${snapAdded} snapshot rows`);

  return result;
}

// ── Tab click helper ──────────────────────────────────────────────────────────

const ESCAPE = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Find and click a tab using three progressively looser strategies.
 * Uses force: true on all clicks to bypass overlay elements.
 */
async function findAndClickTab(page, tabText, role = 'tab') {
  // Strategy 1: exact role match (case-insensitive partial)
  try {
    await page.getByRole(role, { name: new RegExp(ESCAPE(tabText), 'i') })
      .first().click({ timeout: 15000, force: true });
    return;
  } catch {}

  // Strategy 2: drop the last word (handles "KAv2 Growth Analytics - WIP" type suffixes)
  const withoutLast = tabText.split(' ').slice(0, -1).join(' ');
  if (withoutLast) {
    try {
      await page.getByRole(role, { name: new RegExp(ESCAPE(withoutLast), 'i') })
        .first().click({ timeout: 10000, force: true });
      return;
    } catch {}
  }

  // Strategy 3: getByText (any element)
  try {
    await page.getByText(tabText, { exact: false }).first().click({ timeout: 10000, force: true });
    return;
  } catch {}

  // Diagnostic: log what tabs are actually available
  const available = await page.evaluate((r) => {
    return Array.from(document.querySelectorAll(`[role="${r}"]`))
      .map(t => t.textContent?.trim()).filter(Boolean);
  }, role).catch(() => []);

  if (available.length) {
    console.log(`  🔍 Available [role="${role}"]s: ${available.join(' | ')}`);
  }

  throw new Error(`Could not find ${role}: "${tabText}"`);
}


// ── Error screenshot ──────────────────────────────────────────────────────────

async function captureErrorScreenshot() {
  try {
    const { chromium } = require('playwright');
    const browser = await chromium.connectOverCDP(CDP_URL).catch(() => null);
    if (!browser) return;
    const p = browser.contexts()[0]?.pages()[0];
    if (!p) return;
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    await p.screenshot({ path: `kav2-error-${ts}.png`, fullPage: true });
    console.error(`  📸 Debug screenshot: kav2-error-${ts}.png`);
  } catch {}
}

// ── Exports (for slimmer scrapers like scrape-kav2-core.js) ───────────────────

module.exports = {
  KAV2_URL,
  TOP_TABS,
  scrapeTab,
  findAndClickTab,
  captureErrorScreenshot,
};

// ── Run ───────────────────────────────────────────────────────────────────────

// Note on process.exit(0):
// connectToEdge() holds a Playwright CDP socket open which keeps the Node event
// loop alive indefinitely. Without an explicit exit, this process hangs after
// "✅ Done" and never releases its slot in scrape-all.js's browser concurrency
// limiter — blocking the orchestrator for tens of minutes.
if (require.main === module) {
  main().then(() => process.exit(0));
}


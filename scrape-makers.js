'use strict';

/**
 * scrape-makers.js
 *
 * Scrapes all data sources backing the "Makers" dashboard tab:
 *
 *   1. All-up Makers R28          (explore /p/6XJKk6pRJzK/)
 *   2. Automations dashboard      (dashboard 3611, L28 filter via native_filters_key)
 *   3. Document Libraries created (explore slice 56176, last 28 days by day)
 *   4. Lists dashboard — Main tab (dashboard 1814: MAU/WAU/DAU, active lists, engaged users)
 *   5. Lists — Automations tab    (flow completions, setups, creation intents)
 *   6. Lists — Columns tab        (Quick Steps MAU, column count percentiles, column types)
 *   7. Lists — SPAI tab           (top 50 tool chains, PowerApps Custom Forms MAU)
 *
 * Usage:
 *   node scrape-makers.js
 *   MIN_SCRAPE_AGE_HOURS=0 node scrape-makers.js   # force re-scrape all
 */

const { connectToEdge }        = require('./lib/cdp-connect');
const { ensureLoggedIn }       = require('./lib/nezha-auth');
const { captureDashboardCharts } = require('./lib/nezha-chart-data');
const store                    = require('./lib/data-store');
const { findAndClickTab }      = require('./lib/nav-helpers');

// ── URLs ──────────────────────────────────────────────────────────────────────

const ALL_UP_URL =
  'https://www.microsoftnezha.com/nezha/explore/p/6XJKk6pRJzK/';

const AUTOMATIONS_URL =
  'https://www.microsoftnezha.com/nezha/dashboard/3611/' +
  '?native_filters_key=NkpQHvY6Rk5g2X5gghrA0bZb-ycyEj4Z6rAjY3pjkhRs6mt4E1SSPRgJvWd2frPW';

const DOC_LIBRARIES_URL =
  'https://www.microsoftnezha.com/explore/' +
  '?form_data_key=Mj83eq0V8tMwVi8FojLj9qYq696XZCELoSC5tVHfEcI8HgGD8W4JjGJcFfTeb2pv' +
  '&slice_id=56176&save_action=overwrite';

const LISTS_URL =
  'https://www.microsoftnezha.com/nezha/dashboard/1814/' +
  '?native_filters_key=2uT9jcgQ0saAtOVoz5WE_7OAg1lRjeamBcfCEnMLn0T1je89FNElUT4yMF_E1DIb';

// ── Source definitions ────────────────────────────────────────────────────────

// settleMs: ms of silence after last API response before we declare capture done.
// Lists dashboard is slow; Explore pages are usually fast.

const SOURCES = [
  {
    name:               'Makers All-Up R28',
    path:               'makers/all-up',
    url:                ALL_UP_URL,
    tabClick:           null,
    settleMs:           12000,
    blankFirst:         true,   // discard Superset Redux cache so a fresh chart/data POST fires
    captureUncorrelated: true,  // Explore page — no .chart-slice DOM panels
  },
  {
    name:       'Automations',
    path:       'makers/automations',
    url:        AUTOMATIONS_URL,
    tabClick:   null,
    settleMs:   18000,
    blankFirst: true,  // Superset caches chart data in Redux; navigate away first to force fresh API calls
  },
  {
    name:               'Document Libraries',
    path:               'makers/doc-libraries',
    url:                DOC_LIBRARIES_URL,
    tabClick:           null,
    settleMs:           12000,
    captureUncorrelated: true,  // Explore page — no .chart-slice DOM panels
  },
  {
    name:     'Lists — Main',
    path:     'makers/lists/main',
    url:      LISTS_URL,
    tabClick: null,
    settleMs: 18000,
  },
  {
    name:     'Lists — Automation',
    path:     'makers/lists/automation',
    url:      LISTS_URL,
    tabClick: 'Automation',   // actual tab label (not "Automations")
    settleMs: 15000,
  },
  {
    name:     'Lists — Columns',
    path:     'makers/lists/columns',
    url:      LISTS_URL,
    tabClick: 'Columns',
    settleMs: 20000,  // extra settle for DOM-heavy charts
  },
  {
    name:     'Lists — SPAI',
    path:     'makers/lists/spai',
    url:      LISTS_URL,
    tabClick: 'SPAI',
    settleMs: 20000,  // extra settle for Top 50 tool chains table
  },
];

const MIN_SCRAPE_AGE_HOURS = parseInt(process.env.MIN_SCRAPE_AGE_HOURS || '6');

// ── Per-source scrape ─────────────────────────────────────────────────────────

async function scrapeSource(page, source) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`SOURCE: ${source.name}`);
  console.log(`  store : data/${source.path}`);
  console.log('='.repeat(60));

  if (!store.shouldScrape(source.path, MIN_SCRAPE_AGE_HOURS)) {
    const last = store.getLastScrapeTime(source.path);
    const ageH = ((Date.now() - last.getTime()) / 3_600_000).toFixed(1);
    console.log(`↷ Skipping — scraped ${last.toLocaleString()} (${ageH}h ago). Pass MIN_SCRAPE_AGE_HOURS=0 to force.`);
    return { skipped: true };
  }

  const result = await captureDashboardCharts(page, source.url, {
    settleMs:   source.settleMs,
    blankFirst: source.blankFirst || false,
    timeout:    180000,
    onLoaded: async p => {
      if (source.tabClick) {
        console.log(`  → Clicking "${source.tabClick}" tab`);
        await findAndClickTab(p, source.tabClick);
      }
      await p.evaluate(() => window.scrollTo(0, 0));
      await p.waitForTimeout(3000);
    },
  });

  let tsAdded = 0, tsUpdated = 0, snapAdded = 0;

  // Correlated charts (matched to DOM panel title)
  const allEntries = Object.entries(result.charts);
  // For Explore pages: also store uncorrelated responses (no .chart-slice panels in DOM)
  if (source.captureUncorrelated && result.uncorrelated?.length) {
    for (let i = 0; i < result.uncorrelated.length; i++) {
      const entry = result.uncorrelated[i];
      const title = entry.title || `uncorrelated_${i + 1}`;
      allEntries.push([title, entry]);
    }
    console.log(`  ℹ ${result.uncorrelated.length} uncorrelated response(s) included`);
  }

  for (const [title, chart] of allEntries) {
    const data = chart.data;
    if (!data?.data?.length) {
      if (data === null) console.log(`  ○ "${title}" — DOM-only (no API data captured)`);
      else if (data?.raw)  console.log(`  ⚠ "${title}" — cache-pending response (no data array); will retry next run`);
      else                 console.log(`  ⚠ "${title}" — empty data array (shape: ${JSON.stringify(Object.keys(data || {}))})`);
      continue;
    }

    if (data.timeColumn) {
      const s = store.upsertTimeseries(source.path, title, data.colnames, data.data, data.timeColumn);
      tsAdded += s.added; tsUpdated += s.updated;
      console.log(`  ✓ "${title}" — ${s.added} new rows, ${s.updated} updated (time col: ${data.timeColumn})`);
    } else {
      const s = store.appendSnapshot(source.path, title, data.colnames, data.data);
      snapAdded += s.added;
      console.log(`  ✓ "${title}" — snapshot, ${s.added} rows (cols: ${data.colnames?.slice(0, 4).join(', ')}${data.colnames?.length > 4 ? '…' : ''})`);
    }
  }

  store.recordScrapeTime(source.path, {
    charts:              Object.keys(result.charts).length,
    timeseries_added:    tsAdded,
    timeseries_updated:  tsUpdated,
    snapshot_rows_added: snapAdded,
  });

  const total    = Object.keys(result.charts).length;
  const withData = Object.values(result.charts).filter(c => c.data?.data?.length > 0).length;
  const domOnly  = Object.values(result.charts).filter(c => c.data === null).length;
  console.log(`  📊 ${total} chart(s): ${withData} with API data, ${domOnly} DOM-only`);
  console.log(`  💾 +${tsAdded} new rows, ~${tsUpdated} updated | +${snapAdded} snapshot rows`);

  return { skipped: false, total, withData };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║                Makers Dashboard Scraper                    ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  console.log(`Started: ${new Date().toLocaleString()}\n`);

  // Optional --source=name1,name2 filter (case-insensitive substring match)
  const sourceArg = (process.argv.find(a => a.startsWith('--source=')) || '').split('=')[1] || '';
  const filters = sourceArg.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const sources = filters.length
    ? SOURCES.filter(s => filters.some(f => s.name.toLowerCase().includes(f) || s.path.toLowerCase().includes(f)))
    : SOURCES;
  if (filters.length) console.log(`Filtered to ${sources.length}/${SOURCES.length} sources matching: ${filters.join(', ')}`);
  console.log(`Sources: ${sources.length} (${sources.map(s => s.name).join(', ')})\n`);

  try {
    const { page } = await connectToEdge();

    console.log('── Authentication ──────────────────────────────────────────');
    // Use the Automations dashboard for the login check (requires auth)
    if (!await ensureLoggedIn(page, AUTOMATIONS_URL)) {
      throw new Error('Could not authenticate with Nezha. Manual login may be required.');
    }

    let totalCharts = 0, totalWithData = 0, skipped = 0, failed = 0;
    const failures = [];

    for (const source of sources) {
      try {
        const r = await scrapeSource(page, source);
        if (r.skipped) { skipped++; continue; }
        totalCharts   += r.total;
        totalWithData += r.withData;
      } catch (err) {
        console.error(`\n  ❌ "${source.name}" failed: ${err.message}`);
        failures.push(source.name);
        failed++;
        // Non-fatal — continue with remaining sources
      }
    }

    console.log('\n' + '─'.repeat(60));
    const scraped = sources.length - skipped - failed;
    console.log(`Summary: ${scraped} scraped, ${skipped} skipped, ${failed} failed`);
    if (failures.length) console.log(`  Failed: ${failures.join(', ')}`);
    console.log(`Charts : ${totalCharts} total, ${totalWithData} with API data`);
    console.log(`\nCompleted: ${new Date().toLocaleString()}`);
    console.log(failed > 0 ? '⚠ Done with errors\n' : '✅ Done\n');

    if (failed > 0) process.exit(1);

  } catch (err) {
    console.error('\n❌ Fatal error:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

main().then(() => process.exit(0));

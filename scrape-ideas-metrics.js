'use strict';

/**
 * scrape-ideas-metrics.js
 *
 * Pulls M365 Copilot core product metrics from the IDEAS AURA MCP API
 * and saves them to the incremental CSV data store (same format as
 * scrape-kav2-full.js / lib/data-store.js).
 *
 * Metrics saved (per product):
 *   WAU  → WeeklyActiveUserCount
 *   MAU  → MonthlyActiveUserCount
 *   DAU  → DailyActiveUserCount
 *
 * Products tracked (M365 Copilot Core):
 *   M365 Copilot All Up, Copilot App, Copilot Chat, Teams, Outlook,
 *   Word, Excel, PowerPoint
 *
 * Store layout:
 *   data/ideas/m365-copilot/{product-slug}-wau.csv
 *   data/ideas/m365-copilot/{product-slug}-mau.csv
 *   data/ideas/m365-copilot/{product-slug}-dau.csv
 *
 * Usage:
 *   node scrape-ideas-metrics.js
 *   MIN_SCRAPE_AGE_HOURS=0 node scrape-ideas-metrics.js   # force re-scrape
 *
 * Note on agent metrics (Researcher, Analyst, DA, SPO, CEA, Connectors):
 *   These require IDEAS ExdHbi data access (Copilot Extensibility dataset).
 *   Run `node scrape-ideas-metrics.js --check-agents` to see what's available.
 */

const ideas = require('./lib/ideas-client');
const store = require('./lib/data-store');

const MIN_SCRAPE_AGE_HOURS = parseInt(process.env.MIN_SCRAPE_AGE_HOURS || '6');
const TAB_PATH = 'ideas/m365-copilot';

// Six months of history on first run; subsequent runs use latest-only
const HISTORY_START = '2025-10-01T00:00:00.000Z';

// ── Product config ────────────────────────────────────────────────────────────
// ProductKey values from WeeklyActiveUserCount dimension response.
// label is used as the chart title (and drives the CSV filename slug).

const PRODUCTS = [
  { label: 'M365 Copilot All Up',            productKey: '4999588089921664978'  },
  { label: 'M365 Copilot App',               productKey: '160296164282593305'   },
  { label: 'Copilot Chat in M365 App',       productKey: '-6566398535929515131' },
  { label: 'Copilot in SharePoint',          productKey: '-1708994746388419335' },
  { label: 'Copilot in Teams',               productKey: '-8366661709245694121' },
  { label: 'Copilot in Outlook',             productKey: '-6374993288755689330' },
  { label: 'Copilot in Word',                productKey: '2890872424729376851'  },
  { label: 'Copilot in Excel',               productKey: '2135433928032816823'  },
  { label: 'Copilot in PowerPoint',          productKey: '-4622399698452016147' },
];

const METRIC_CONFIGS = [
  { metricName: 'WeeklyActiveUserCount',  suffix: 'WAU', timeGrain: 'weekly'  },
  { metricName: 'MonthlyActiveUserCount', suffix: 'MAU', timeGrain: 'monthly' },
  { metricName: 'DailyActiveUserCount',   suffix: 'DAU', timeGrain: 'daily'   },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n) {
  if (n == null) return '-';
  return n >= 1_000_000 ? `${(n/1_000_000).toFixed(1)}M`
       : n >= 1_000     ? `${(n/1_000).toFixed(1)}K`
       : String(n);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║      IDEAS M365 Copilot Metrics Scraper                    ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  console.log(`Started: ${new Date().toLocaleString()}\n`);

  // ── Skip check ───────────────────────────────────────────────────────────
  if (!store.shouldScrape(TAB_PATH, MIN_SCRAPE_AGE_HOURS)) {
    const last = store.getLastScrapeTime(TAB_PATH);
    const ageH = ((Date.now() - last.getTime()) / 3_600_000).toFixed(1);
    console.log(`↷ Skipping — last scraped ${last.toLocaleString()} (${ageH}h ago)`);
    console.log('  Pass MIN_SCRAPE_AGE_HOURS=0 to force a re-scrape.');
    return;
  }

  // Determine date range — historical on first run, recent window after that.
  // We can't use "latest only" (null dates) for incremental runs because the
  // IDEAS asset's "latest" pointer lags actual data by 1-2 weeks; querying a
  // 30-day window picks up any newer rows that landed since the last scrape.
  // upsertTimeseries dedupes by Date so overlap is free.
  const lastScrape = store.getLastScrapeTime(TAB_PATH);
  const isFirstRun = !lastScrape;
  const startDate  = isFirstRun
    ? HISTORY_START
    : new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const endDate    = new Date().toISOString();

  if (isFirstRun) {
    console.log(`First run — pulling history from ${HISTORY_START.slice(0, 10)} onward\n`);
  } else {
    console.log(`Incremental run — pulling last 30 days (${startDate.slice(0,10)} → ${endDate.slice(0,10)})\n`);
  }

  // ── Authenticate (will prompt browser if token expired) ──────────────────
  console.log('── Authentication ──────────────────────────────────────────');
  await ideas.getToken();
  console.log('  ✓ Token acquired\n');

  let totalAdded = 0, totalUpdated = 0;
  const summary = [];

  // ── Fetch each metric × product ──────────────────────────────────────────
  for (const { metricName, suffix } of METRIC_CONFIGS) {
    console.log(`── ${suffix} (${metricName}) ──────────────────────────────────`);

    // Fetch all products in one call — IDEAS handles multi-product queries
    const allProductKeys = PRODUCTS.map(p => p.productKey);
    let rows;
    try {
      rows = await ideas.getMetricData(metricName, {
        filters: { ProductKey: allProductKeys },
        selectColumns: `Date,ProductKey,${metricName}`,
        startDate: startDate || undefined,
        endDate:   endDate   || undefined,
      });
    } catch (err) {
      console.error(`  ✗ Failed to fetch ${metricName}: ${err.message}`);
      continue;
    }

    if (!rows.length) {
      console.log(`  ⚠  No rows returned for ${metricName}`);
      continue;
    }

    // Group rows by the hydrated ProductKey name
    const byProduct = new Map();
    for (const row of rows) {
      const pName = row.ProductKey ?? 'Unknown';
      if (!byProduct.has(pName)) byProduct.set(pName, []);
      byProduct.get(pName).push(row);
    }

    // Upsert each product's rows into the store
    for (const product of PRODUCTS) {
      // Match by hydrated name — IDEAS returns the display name when hydrateDimensions=true
      const productRows = byProduct.get(product.label)
        // Fallback: match any key containing the label words
        ?? [...byProduct.entries()]
             .find(([k]) => k.toLowerCase().includes(product.label.toLowerCase().split(' ').slice(-1)[0]))?.[1]
        ?? [];

      if (!productRows.length) continue;

      const chartTitle = `${product.label} ${suffix}`;
      const colnames   = ['Date', metricName];
      const dataRows   = productRows.map(r => ({ Date: r.Date, [metricName]: r[metricName] ?? '' }));

      const s = store.upsertTimeseries(TAB_PATH, chartTitle, colnames, dataRows, 'Date');
      totalAdded   += s.added;
      totalUpdated += s.updated;

      const latest = dataRows.reduce((m, r) => r.Date > m.Date ? r : m, dataRows[0]);
      summary.push({ label: product.label, suffix, value: latest[metricName], date: latest.Date?.slice(0, 10), added: s.added });
      console.log(`  ✓ ${product.label}: ${fmt(latest[metricName])} (${latest.Date?.slice(0,10)}) +${s.added} new rows`);
    }

    console.log();
  }

  // ── Record scrape ─────────────────────────────────────────────────────────
  store.recordScrapeTime(TAB_PATH, {
    products: PRODUCTS.length,
    metrics:  METRIC_CONFIGS.length,
    rows_added:   totalAdded,
    rows_updated: totalUpdated,
  });

  // ── Summary table ─────────────────────────────────────────────────────────
  console.log('\n── Latest values ────────────────────────────────────────────');
  const wauRows = summary.filter(r => r.suffix === 'WAU');
  for (const r of wauRows) {
    console.log(`  ${r.label.padEnd(35)} WAU: ${fmt(r.value).padStart(8)}  (${r.date})`);
  }

  console.log(`\n💾 Store: +${totalAdded} new rows, ~${totalUpdated} updated`);
  console.log(`\nCompleted: ${new Date().toLocaleString()}`);
  console.log('✅ Done\n');
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err.message);
  console.error(err.stack);
  process.exit(1);
});

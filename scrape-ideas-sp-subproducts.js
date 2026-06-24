'use strict';

/**
 * scrape-ideas-sp-subproducts.js
 *
 * Pulls SharePoint and OneDrive sub-product metrics from IDEAS AURA API.
 * Sub-products are filtered by ProductKey + ValuableCopilotInteractionKey.
 *
 * SharePoint sub-products: Knowledge Agent, Authoring Copilot, File skills, Smart section
 * OneDrive sub-products:   Answer Questions, File AI actions
 *
 * Usage:
 *   node scrape-ideas-sp-subproducts.js
 *   MIN_SCRAPE_AGE_HOURS=0 node scrape-ideas-sp-subproducts.js   # force re-scrape
 */

const ideas = require('./lib/ideas-client');
const store = require('./lib/data-store');

const MIN_SCRAPE_AGE_HOURS = parseInt(process.env.MIN_SCRAPE_AGE_HOURS || '6');
const TAB_PATH = 'ideas/sp-subproducts';
const HISTORY_START = '2025-10-01T00:00:00.000Z';

// ── Product / VCI config ──────────────────────────────────────────────────────
// ValuableCopilotInteractionKey is the dimension that breaks SP/OD into sub-products.
// null vciKey = the product-level all-up (no VCI filter).

const PRODUCTS = [
  { label: 'SharePoint All Up',    slug: 'sp-all-up',            productKey: '-1708994746388419335', vciKey: null },
  { label: 'SP Knowledge Agent',   slug: 'sp-knowledge-agent',   productKey: '-1708994746388419335', vciKey: '7751836063088968229' },
  { label: 'SP Authoring Copilot', slug: 'sp-authoring-copilot', productKey: '-1708994746388419335', vciKey: '-7274991059778222850' },
  { label: 'SP File skills',       slug: 'sp-file-skills',       productKey: '-1708994746388419335', vciKey: '-1668121120965307692' },
  { label: 'SP Smart section',     slug: 'sp-smart-section',     productKey: '-1708994746388419335', vciKey: '489257682945185726' },
  // AudienceKey '6955757248617900850' = Commercial — prevents consumer OneDrive data
  // (ConOneDriveCopilotUsage asset, M365 Personal/Family) from contaminating these metrics.
  { label: 'OneDrive All Up',      slug: 'od-all-up',            productKey: '3575013215854186996',  vciKey: null,                   audienceKey: '6955757248617900850' },
  { label: 'OD Answer Questions',  slug: 'od-answer-questions',  productKey: '3575013215854186996',  vciKey: '7653641852674673260',   audienceKey: '6955757248617900850' },
  { label: 'OD File AI actions',   slug: 'od-file-ai-actions',   productKey: '3575013215854186996',  vciKey: '-454487286050267689',   audienceKey: '6955757248617900850' },
];

const METRICS = [
  { name: 'WeeklyActiveUserCount',        suffix: 'wau'      },
  { name: 'MonthlyActiveUserCount',       suffix: 'mau'      },
  { name: 'DailyActiveUserCount',         suffix: 'dau'      },
  { name: 'AverageDAURL7',                suffix: 'avg-dau'  },
  { name: 'WeeklyActionCount',            suffix: 'tries'    },
  { name: 'PercentWAUwith3PlusDaysofUse', suffix: 'pct3days' },
  { name: 'WeeklyNewUserCount',           suffix: 'new-users'},
  { name: 'WeeklyReturningUserCount',     suffix: 'returning'},
  { name: 'WeeklyLapsedUserCount',        suffix: 'lapsed'   },
];

function fmt(n) {
  if (n == null) return '-';
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  if (Math.abs(n) < 10)         return n.toFixed(2);
  return String(Math.round(n));
}

async function fetchMetric(metricName, productKey, vciKey, startDate, endDate, audienceKey) {
  const filters = { ProductKey: [productKey] };
  if (vciKey)      filters.ValuableCopilotInteractionKey = [vciKey];
  if (audienceKey) filters.AudienceKey = [audienceKey];

  const args = {
    metricName,
    hydrateDimensions: true,
    filters: JSON.stringify(filters),
    userPrompt: `scrape-ideas-sp-subproducts: ${metricName}`,
  };
  if (startDate && endDate) { args.startDate = startDate; args.endDate = endDate; }

  const text = await ideas.callTool('get_metric_data', args);
  if (!text) return [];

  // Parse all Data: [...] blocks from response
  const rows = [];
  const re = /Data:\s*(\[[\s\S]*?\])\s*(?:===|$)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    try { rows.push(...JSON.parse(m[1])); } catch {}
  }
  return rows;
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║   IDEAS SP/OD Sub-product Metrics Scraper                  ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  console.log(`Started: ${new Date().toLocaleString()}\n`);

  if (!store.shouldScrape(TAB_PATH, MIN_SCRAPE_AGE_HOURS)) {
    const last = store.getLastScrapeTime(TAB_PATH);
    const ageH = ((Date.now() - last.getTime()) / 3_600_000).toFixed(1);
    console.log(`↷ Skipping — last scraped ${last.toLocaleString()} (${ageH}h ago)`);
    console.log('  Pass MIN_SCRAPE_AGE_HOURS=0 to force a re-scrape.');
    return;
  }

  const lastScrape = store.getLastScrapeTime(TAB_PATH);
  const isFirstRun = !lastScrape;
  const startDate  = isFirstRun
    ? HISTORY_START
    : new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const endDate    = new Date().toISOString();

  console.log(isFirstRun
    ? `First run — pulling history from ${HISTORY_START.slice(0, 10)} onward\n`
    : `Incremental run — pulling last 30 days (${startDate.slice(0,10)} → ${endDate.slice(0,10)})\n`);

  console.log('── Authentication ──────────────────────────────────────────');
  await ideas.getToken();
  console.log('  ✓ Token acquired\n');

  let totalAdded = 0, totalUpdated = 0;

  for (const product of PRODUCTS) {
    console.log(`── ${product.label} ──────────────────────────────────`);

    for (const metric of METRICS) {
      try {
        const rows = await fetchMetric(metric.name, product.productKey, product.vciKey, startDate, endDate, product.audienceKey);
        if (!rows.length) {
          console.log(`  ${metric.suffix}: no data`);
          continue;
        }

        // Normalize rows: Date + metric value
        const normalized = rows
          .filter(r => r[metric.name] != null && r.Date)
          .map(r => ({ Date: r.Date, [metric.name]: r[metric.name] }));

        if (!normalized.length) {
          console.log(`  ${metric.suffix}: 0 valid rows`);
          continue;
        }

        const chartTitle = `${product.slug}-${metric.suffix}`;
        const { added, updated } = store.upsertTimeseries(
          TAB_PATH, chartTitle,
          ['Date', metric.name], normalized, 'Date'
        );
        totalAdded   += added;
        totalUpdated += updated;

        const latest = normalized.at(-1);
        const latestDate = latest?.Date?.slice(0, 10) ?? '?';
        const latestVal  = latest?.[metric.name];
        console.log(`  ${metric.suffix}: ${fmt(latestVal)} (${latestDate}) +${added} new, ~${updated} updated`);

      } catch (err) {
        console.log(`  ${metric.suffix}: ERROR — ${err.message.slice(0, 80)}`);
      }
    }
    console.log();
  }

  store.recordScrapeTime(TAB_PATH, { totalAdded, totalUpdated });

  console.log(`💾 Store: +${totalAdded} new rows, ~${totalUpdated} updated`);
  console.log(`\nCompleted: ${new Date().toLocaleString()}`);
  console.log('✅ Done');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });

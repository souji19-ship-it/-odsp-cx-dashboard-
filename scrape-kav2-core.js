'use strict';

/**
 * scrape-kav2-core.js
 *
 * "Mini" SPARK (Copilot in SharePoint / KAv2) scraper — daily-cadence,
 * low-cost subset of scrape-kav2-full.js.
 *
 * Only scrapes the two tabs that produce the headline metrics:
 *   - "KAv2"                          → top-tenants-wau.csv
 *   - "KAv2 Growth Analytics" › Usage → weekly-active-users, kav2-daily-active-usage,
 *                                       kav2-weekly-conversation-volume,
 *                                       number-of-turns-per-conversation-r7,
 *                                       kav2-query-volume-by-top-{surface,launch-origin}-r7,
 *                                       {site,tenant}-enablement-stats-r7, user-level,
 *                                       weekly-retention, etc.
 *
 * Re-uses the heavy-lifting helpers from scrape-kav2-full.js — no duplicated
 * Playwright / Superset interception code.
 *
 * Run wall-clock: ~3-5 min vs ~12-15 min for the full scraper.
 *
 * Usage:
 *   node scrape-kav2-core.js                    # respects MIN_SCRAPE_AGE_HOURS
 *   MIN_SCRAPE_AGE_HOURS=0 node scrape-kav2-core.js   # force re-scrape
 *   node scrape-kav2-core.js --generate         # also rebuild dashboard-data.js
 */

const { spawnSync } = require('child_process');

const { connectToEdge } = require('./lib/cdp-connect');
const { ensureLoggedIn } = require('./lib/nezha-auth');
const {
  KAV2_URL,
  scrapeTab,
  captureErrorScreenshot,
} = require('./scrape-kav2-full');

// Core tab set. Each entry is [topTabName, subTabName|null].
// Keep this list small — every additional tab roughly doubles wall-clock time.
const CORE_TABS = [
  ['KAv2', null],
  ['KAv2 Growth Analytics', 'Usage'],
];

const RUN_GENERATE = process.argv.includes('--generate');

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║          SPARK (KAv2) Core Daily Scraper                   ║');
  console.log('║          headline WAU/DAU/queries + top tenants only       ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  console.log(`Started: ${new Date().toLocaleString()}`);
  console.log(`Tabs:    ${CORE_TABS.map(([t, s]) => s ? `${t} › ${s}` : t).join(' | ')}\n`);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);

  try {
    const { page } = await connectToEdge();

    console.log('\n── Authentication ──────────────────────────────────────────');
    const loggedIn = await ensureLoggedIn(page, KAV2_URL);
    if (!loggedIn) {
      throw new Error('Could not authenticate with Nezha. Manual login may be required.');
    }

    for (const [topTab, subTab] of CORE_TABS) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`TAB: ${subTab ? `${topTab} › ${subTab}` : topTab}`);
      console.log('='.repeat(60));
      await scrapeTab(page, topTab, subTab, timestamp);
    }

    console.log(`\nCompleted: ${new Date().toLocaleString()}`);
    console.log('✅ Done\n');

    if (RUN_GENERATE) {
      console.log('── Regenerating dashboard-data.js ──────────────────────────');
      const r = spawnSync(process.execPath, ['generate-dashboard-data.js'], {
        stdio: 'inherit',
      });
      if (r.status !== 0) {
        console.error(`generate-dashboard-data.js exited with code ${r.status}`);
        process.exit(r.status || 1);
      }
    }
  } catch (err) {
    console.error('\n❌ Fatal error:', err.message);
    console.error(err.stack);
    await captureErrorScreenshot().catch(() => {});
    process.exit(1);
  }
}

// See note in scrape-kav2-full.js — CDP socket keeps the loop alive.
main().then(() => process.exit(0));

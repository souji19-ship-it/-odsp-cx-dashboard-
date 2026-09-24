'use strict';

/**
 * scrape-skills.js
 *
 * Scrapes the "AI in SharePoint SKILLs" Nezha dashboard (dashboard 7082).
 *
 *   Usage tab    — KPI big-number charts + "Skills Adoption Across Tenants" table.
 *                  Stored under data/skills/
 *
 *   Adoption tab — Two proof-funnel tables:
 *                    "Tenant adoption of skills"   (proof, tenant_count)
 *                    "Site level adoption skills"  (proof, site_count)
 *                  Stored under data/skills-adoption/ — appended as snapshots
 *                  so we can chart proof-layer growth across scrapes.
 *
 * Usage:
 *   node scrape-skills.js
 *   MIN_SCRAPE_AGE_HOURS=0 node scrape-skills.js   # force re-scrape
 */

const { connectToEdge } = require('./lib/cdp-connect');
const { ensureLoggedIn } = require('./lib/nezha-auth');
const { captureDashboardCharts } = require('./lib/nezha-chart-data');
const store = require('./lib/data-store');

const SKILLS_URL =
  'https://www.microsoftnezha.com/nezha/dashboard/7082/' +
  '?native_filters_key=eQ56XXFTXV8sk_ZBoFFj7lvsSsubQzRrdx_FyoyhWDFbUMIOho9oQb2XnBR4aeYW';

const TAB_PATH          = 'skills';
const TAB_PATH_ADOPTION = 'skills-adoption';

// Only these chart titles on the Adoption tab carry new info; everything else
// duplicates the Usage tab and is skipped to avoid double-counting.
const ADOPTION_CHARTS = new Set([
  'Tenant adoption of skills',
  'Site level adoption skills',
]);

const MIN_SCRAPE_AGE_HOURS = parseInt(process.env.MIN_SCRAPE_AGE_HOURS || '6');

// ── Helpers ──────────────────────────────────────────────────────────────────

async function clickAdoptionTab(page) {
  const clicked = await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('[role="tab"], .ant-tabs-tab'));
    const tab = tabs.find(t => /adoption/i.test(t.textContent || ''));
    if (tab) { tab.click(); return true; }
    return false;
  });
  if (!clicked) {
    console.log('    ⚠ Could not find "Adoption" tab — skipping adoption scrape.');
    return false;
  }
  // Give charts a moment to render before captureDashboardCharts's settle loop starts
  await page.waitForTimeout(2500);
  return true;
}

function persistCharts(tabPath, charts, { allowList = null } = {}) {
  let tsAdded = 0, tsUpdated = 0, snapAdded = 0;
  for (const [title, chart] of Object.entries(charts)) {
    if (allowList && !allowList.has(title)) continue;

    const data = chart.data;
    if (!data?.data?.length) {
      console.log(`    ⚠ "${title}" — no API data`);
      continue;
    }

    if (data.timeColumn) {
      const s = store.upsertTimeseries(tabPath, title, data.colnames, data.data, data.timeColumn);
      tsAdded += s.added; tsUpdated += s.updated;
      console.log(`    ✓ "${title}" — ${s.added} new rows, ${s.updated} updated`);
    } else {
      const s = store.appendSnapshot(tabPath, title, data.colnames, data.data);
      snapAdded += s.added;
      console.log(`    ✓ "${title}" — ${s.added} snapshot rows`);
    }
  }
  return { tsAdded, tsUpdated, snapAdded };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║          AI in SharePoint SKILLs Scraper                   ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  console.log(`Started: ${new Date().toLocaleString()}\n`);

  try {
    const { page } = await connectToEdge();

    console.log('── Authentication ──────────────────────────────────────────');
    if (!await ensureLoggedIn(page, SKILLS_URL)) {
      throw new Error('Could not authenticate with Nezha. Manual login may be required.');
    }

    if (!store.shouldScrape(TAB_PATH, MIN_SCRAPE_AGE_HOURS)) {
      const last = store.getLastScrapeTime(TAB_PATH);
      const ageH = ((Date.now() - last.getTime()) / 3_600_000).toFixed(1);
      console.log(`↷ Skipping — scraped ${last.toLocaleString()} (${ageH}h ago). Pass MIN_SCRAPE_AGE_HOURS=0 to force.`);
      console.log('✅ Done\n');
      return;
    }

    // ── Usage tab ────────────────────────────────────────────────────────────
    console.log('\n' + '='.repeat(60));
    console.log('Scraping: AI in SharePoint SKILLs · Usage tab');
    console.log('='.repeat(60));

    const usageResult = await captureDashboardCharts(page, SKILLS_URL, {
      settleMs: 15000,
      timeout:  180000,
      onLoaded: async p => {
        await p.evaluate(() => window.scrollTo(0, 0));
        await p.waitForTimeout(3000);
      },
    });

    const usageStats = persistCharts(TAB_PATH, usageResult.charts);

    // ── Adoption tab (proof funnels) ─────────────────────────────────────────
    // We re-run captureDashboardCharts and click the Adoption tab in onLoaded
    // so the route interceptor sees the API calls triggered by the tab switch.
    console.log('\n' + '='.repeat(60));
    console.log('Scraping: AI in SharePoint SKILLs · Adoption tab');
    console.log('='.repeat(60));

    const adoptionResult = await captureDashboardCharts(page, SKILLS_URL, {
      settleMs: 12000,
      timeout:  180000,
      onLoaded: async p => {
        await p.evaluate(() => window.scrollTo(0, 0));
        await p.waitForTimeout(2000);
        await clickAdoptionTab(p);
      },
    });

    const adoptionStats = persistCharts(
      TAB_PATH_ADOPTION,
      adoptionResult.charts,
      { allowList: ADOPTION_CHARTS },
    );

    // ── Bookkeeping ──────────────────────────────────────────────────────────
    store.recordScrapeTime(TAB_PATH, {
      charts:              Object.keys(usageResult.charts).length,
      timeseries_added:    usageStats.tsAdded,
      timeseries_updated:  usageStats.tsUpdated,
      snapshot_rows_added: usageStats.snapAdded,
    });
    store.recordScrapeTime(TAB_PATH_ADOPTION, {
      charts:              ADOPTION_CHARTS.size,
      snapshot_rows_added: adoptionStats.snapAdded,
    });

    const usageTotal    = Object.keys(usageResult.charts).length;
    const usageWithData = Object.values(usageResult.charts).filter(c => c.data?.data?.length > 0).length;
    console.log(`\n  📊 Usage:    ${usageTotal} chart(s), ${usageWithData} with API data`);
    console.log(`     +${usageStats.tsAdded} new rows, ~${usageStats.tsUpdated} updated, +${usageStats.snapAdded} snapshot rows`);
    console.log(`  📊 Adoption: ${ADOPTION_CHARTS.size} chart(s), +${adoptionStats.snapAdded} snapshot rows`);

    console.log(`\nCompleted: ${new Date().toLocaleString()}`);
    console.log('✅ Done\n');

  } catch (err) {
    console.error('\n❌ Fatal error:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

main().then(() => process.exit(0));

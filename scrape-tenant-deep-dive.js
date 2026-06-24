'use strict';

/**
 * scrape-tenant-deep-dive.js
 *
 * Scrapes the new Tenant Deep Dive Nezha page (/p/nGYV1R9kEox/), which
 * supports a left-pane "Tenant Name" filter. For each of the top-5 tenants
 * (sourced from data/kav2/top-tenants-wau.csv), apply the filter, capture
 * all charts, clear, and continue.
 *
 * Output layout:
 *   data/spark-top-tenants/
 *     all-up/<chart-slug>.csv               — unfiltered snapshot
 *     <tenant-slug>/<chart-slug>.csv        — per-tenant snapshot
 *     meta.json                              — { tenants: [{name, slug, wau}], capturedAt }
 *
 * Each scrape appends a dated block (snapshot mode) so we can track changes
 * over time.
 *
 * Usage:
 *   node scrape-tenant-deep-dive.js
 *   node scrape-tenant-deep-dive.js --tenants 3     # top 3 only
 *   MIN_SCRAPE_AGE_HOURS=0 node scrape-tenant-deep-dive.js
 */

const fs = require('fs');
const path = require('path');

const { connectToEdge } = require('./lib/cdp-connect');
const { ensureLoggedIn } = require('./lib/nezha-auth');
const {
  getDomChartMeta,
  parseSupsersetResponse,
  scrollToTriggerLazyLoad,
} = require('./lib/nezha-chart-data');
const store = require('./lib/data-store');

const TENANT_DD_URL = 'https://www.microsoftnezha.com/nezha/dashboard/p/nGYV1R9kEox/';
const TENANT_FILE = path.join(__dirname, 'data', 'kav2', 'top-tenants-wau.csv');

const MIN_SCRAPE_AGE_HOURS = parseInt(process.env.MIN_SCRAPE_AGE_HOURS || '6');

// CLI
const args = process.argv.slice(2);
const TOP_N = (() => {
  const i = args.indexOf('--tenants');
  return i >= 0 ? Math.max(1, parseInt(args[i + 1] || '5')) : 5;
})();

// Slug for filesystem segments (matches data-store.chartToSlug rules)
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

// ── Helpers ───────────────────────────────────────────────────────────────────

function readTopTenants(n) {
  if (!fs.existsSync(TENANT_FILE)) {
    throw new Error(`Top tenants source not found: ${TENANT_FILE}\n` +
      'Run scrape-kav2-full.js first to populate it.');
  }
  // Reuse the same approach as generate-dashboard-data.js:
  //   keep latest scrape per tenant, sort by WAU descending.
  const lines = fs.readFileSync(TENANT_FILE, 'utf8').trim().split('\n');
  const header = parseCsvLine(lines[0]);
  const nameIdx = header.indexOf('tenant_lookup_OrganizationName');
  const wauIdx  = header.indexOf('Weekly Active users');
  const tsIdx   = header.indexOf('scraped_at');
  if (nameIdx < 0 || wauIdx < 0) throw new Error('top-tenants-wau.csv missing expected columns');
  const map = new Map();
  for (const line of lines.slice(1)) {
    const v = parseCsvLine(line);
    const name = v[nameIdx];
    const wau  = parseInt(v[wauIdx]);
    const ts   = v[tsIdx] || '';
    if (!name || !wau) continue;
    if (!map.has(name) || ts > map.get(name).ts) map.set(name, { name, wau, ts });
  }
  return [...map.values()].sort((a, b) => b.wau - a.wau).slice(0, n);
}

function parseCsvLine(line) {
  const out = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ;
    } else if (c === ',' && !inQ) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

// ── Per-scenario capture ──────────────────────────────────────────────────────

/**
 * Register Superset chart-data route capture on the page; returns an array
 * that the handler pushes intercepted responses into, and an unroute fn.
 */
async function startCapture(page) {
  const captured = [];
  const patterns = [
    '**/api/v1/chart/data**',
    '**/api/v1/chart/*/data**',
    '**/superset/explore_json**',
    '**/api/v1/explore/**',
  ];
  const handler = async (route, request) => {
    let response;
    try { response = await route.fetch(); }
    catch { await route.continue().catch(() => {}); return; }
    let data = null;
    try { data = await response.json(); } catch {}
    if (data) {
      let body = null;
      try { body = request.postDataJSON(); } catch {}
      captured.push({ url: request.url(), requestBody: body, responseData: data, ts: Date.now() });
    }
    await route.fulfill({ response }).catch(() => {});
  };
  for (const p of patterns) await page.route(p, handler);
  return {
    captured,
    stop: async () => {
      for (const p of patterns) await page.unroute(p, handler).catch(() => {});
    },
    reset: () => { captured.length = 0; },
  };
}

/** Wait until no new responses have been recorded for `settleMs` ms.
 *  Scrolls periodically to trigger lazy-loaded charts. */
async function waitForSettle(page, captured, { settleMs = 12000, timeout = 120000 } = {}) {
  const start = Date.now();
  let last = captured.length, quiet = 0;
  const poll = 1500;
  while (Date.now() - start < timeout) {
    await page.waitForTimeout(poll);
    if (captured.length === last) {
      quiet += poll;
      if (captured.length > 0 && quiet >= settleMs) return;
    } else {
      quiet = 0; last = captured.length;
    }
    // Scroll a bit each cycle so off-screen charts get mounted and fire
    if (Date.now() - start > 3000) {
      await scrollToTriggerLazyLoad(page).catch(() => {});
    }
  }
}

/** Build chart map: { title → { sliceId, chartType, displayedValue, data } }. */
function buildCharts(domCharts, captured) {
  const bySlice = Object.fromEntries(
    domCharts.filter(c => c.sliceId).map(c => [String(c.sliceId), c])
  );
  const charts = {};
  for (const { url, requestBody, responseData } of captured) {
    let sliceId = null;
    if (requestBody) {
      sliceId = requestBody.slice_id ?? requestBody.form_data?.slice_id ?? null;
      if (sliceId) sliceId = String(sliceId);
    }
    if (!sliceId) {
      const m = url.match(/\/chart\/(\d+)\/data/);
      if (m) sliceId = m[1];
    }
    const dom = sliceId ? bySlice[sliceId] : null;
    if (!dom?.title) continue; // skip uncorrelated
    const data = parseSupsersetResponse(responseData);
    // Prefer the most recent capture for a given chart title (re-filter refires).
    charts[dom.title] = {
      sliceId,
      title: dom.title,
      chartType: dom.chartType,
      displayedValue: dom.displayedValue,
      data,
    };
  }
  // Add DOM-only entries for charts we missed in the API capture
  for (const c of domCharts) {
    if (c.title && !charts[c.title]) {
      charts[c.title] = {
        sliceId: c.sliceId, title: c.title, chartType: c.chartType,
        displayedValue: c.displayedValue, data: null,
      };
    }
  }
  return charts;
}

/** Persist captured charts as snapshot CSVs under data/spark-top-tenants/<segment>/. */
function persist(tabPath, charts) {
  let stored = 0, rows = 0;
  for (const [title, c] of Object.entries(charts)) {
    const d = c.data;
    if (!d?.data?.length) continue;
    const r = store.appendSnapshot(tabPath, title, d.colnames, d.data);
    stored++; rows += r.added;
  }
  return { stored, rows };
}

// ── Filter manipulation ───────────────────────────────────────────────────────

/**
 * Apply the Tenant Name filter on the Tenant Deep Dive page.
 * Layout (verified 2026-06-14):
 *   #rc_select_0  → Tenant Name combobox (1000 options)
 *   #rc_select_1  → Tool Invoked combobox
 *   #rc_select_2  → AI vibe builder combobox
 *
 * @param {string|null} tenantName  exact name (case sensitive) or null to clear
 */
async function applyTenantFilter(page, tenantName) {
  // Open the Tenant Name combobox
  const combo = page.locator('#rc_select_0');
  await combo.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
  await combo.click({ timeout: 10000 });
  await page.waitForTimeout(400);

  if (tenantName === null) {
    // Clear flow: press the 'Clear all' button at bottom of filter pane.
    // Falls back to clicking the chip's X if Clear all isn't present.
    try {
      await page.getByRole('button', { name: /^Clear all$/i }).first().click({ timeout: 4000 });
    } catch {
      // Try removing the selected item by clicking its X
      const remove = page.locator('.ant-select-selection-item-remove, [aria-label="close"]').first();
      await remove.click({ timeout: 4000 }).catch(() => {});
    }
  } else {
    // Type into the search box. After clicking, the combobox should be focused.
    await page.keyboard.type(tenantName, { delay: 30 });
    await page.waitForTimeout(1500); // let dropdown populate (slower on first iteration)

    // Try clicking the matching dropdown option (case-sensitive exact match).
    // Superset/AntD renders options inside .ant-select-item-option containers
    // each with a .ant-select-item-option-content child.
    const option = page.locator('.ant-select-item-option').filter({
      has: page.locator('.ant-select-item-option-content', { hasText: tenantName }),
    }).first();

    let clicked = false;
    try {
      await option.waitFor({ state: 'visible', timeout: 10000 });
      await option.click({ timeout: 5000 });
      clicked = true;
    } catch {}

    if (!clicked) {
      // Fallback: press Enter to select the highlighted option.
      console.warn(`    ⚠️  dropdown option not found for "${tenantName}", pressing Enter`);
      await page.keyboard.press('Enter');
    }
    await page.waitForTimeout(400);
    await page.keyboard.press('Escape'); // close dropdown

    // Sanity check — confirm a selection chip with the tenant name is visible.
    const chipVisible = await page.locator('.ant-select-selection-item')
      .filter({ hasText: tenantName }).first()
      .isVisible({ timeout: 2000 }).catch(() => false);
    if (!chipVisible) {
      console.warn(`    ⚠️  no chip for "${tenantName}" detected after selection`);
    }
  }

  // Click Apply filters
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /^Apply filters$/i }).first()
    .click({ timeout: 10000 });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║          SPARK Tenant Deep Dive Scraper                    ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  // Skip-if-recent gate
  const TAB_PATH_ROOT = 'spark-top-tenants';
  const allUpPath = `${TAB_PATH_ROOT}/all-up`;
  if (!store.shouldScrape(allUpPath, MIN_SCRAPE_AGE_HOURS)) {
    const last = store.getLastScrapeTime(allUpPath);
    const ageH = ((Date.now() - last.getTime()) / 3_600_000).toFixed(1);
    console.log(`↷ Skipping — last scraped ${last.toLocaleString()} (${ageH}h ago, < ${MIN_SCRAPE_AGE_HOURS}h threshold)`);
    console.log('  Pass MIN_SCRAPE_AGE_HOURS=0 to force.');
    return;
  }

  const tenants = readTopTenants(TOP_N);
  console.log(`Top ${tenants.length} tenants:`);
  tenants.forEach((t, i) => console.log(`  ${i+1}. ${t.name}  (WAU=${t.wau.toLocaleString()})`));

  const { page } = await connectToEdge();
  const loggedIn = await ensureLoggedIn(page, TENANT_DD_URL);
  if (!loggedIn) throw new Error('Not authenticated to Nezha');

  // Capture begins before navigation so initial chart fetches are recorded.
  const cap = await startCapture(page);

  try {
    console.log('\n→ Navigating to Tenant Deep Dive page...');
    await page.goto('about:blank').catch(() => {});
    cap.reset();
    await page.goto(TENANT_DD_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);
    await scrollToTriggerLazyLoad(page);
    await waitForSettle(page, cap.captured, { settleMs: 12000, timeout: 150000 });

    // ── Capture all-up ─────────────────────────────────────────────────────────
    console.log(`\n── Capturing ALL-UP (no filter) ──  ${cap.captured.length} responses`);
    const domAllUp = await getDomChartMeta(page);
    const chartsAllUp = buildCharts(domAllUp, cap.captured);
    const allUpRes = persist(allUpPath, chartsAllUp);
    console.log(`  ✓ stored ${allUpRes.stored} charts (${allUpRes.rows} rows)`);

    const meta = {
      capturedAt: new Date().toISOString(),
      url: TENANT_DD_URL,
      tenants: tenants.map(t => ({ name: t.name, slug: slug(t.name), wau: t.wau })),
    };

    // ── Per-tenant ─────────────────────────────────────────────────────────────
    for (let i = 0; i < tenants.length; i++) {
      const t = tenants[i];
      const tenantSlug = slug(t.name);
      const tenantPath = `${TAB_PATH_ROOT}/${tenantSlug}`;
      console.log(`\n── [${i+1}/${tenants.length}] Filtering: "${t.name}" ──`);

      cap.reset();
      try {
        await applyTenantFilter(page, t.name);
      } catch (e) {
        console.error(`  ✗ Could not apply filter: ${e.message}`);
        continue;
      }
      // Wait for chart data refire
      await page.waitForTimeout(2000); // give Superset a beat to fire requests
      await waitForSettle(page, cap.captured, { settleMs: 10000, timeout: 90000 });

      const dom = await getDomChartMeta(page);
      const charts = buildCharts(dom, cap.captured);
      const res = persist(tenantPath, charts);
      console.log(`  ✓ stored ${res.stored} charts (${res.rows} rows, ${cap.captured.length} responses)`);

      store.recordScrapeTime(tenantPath, {
        charts: res.stored, snapshot_rows_added: res.rows, tenant: t.name,
      });

      // Clear the tenant filter before moving on so the next type-ahead starts clean.
      cap.reset();
      try {
        await applyTenantFilter(page, null);
        await page.waitForTimeout(1500);
        await waitForSettle(page, cap.captured, { settleMs: 6000, timeout: 60000 });
      } catch (e) {
        console.warn(`  ⚠️  Clear filter failed: ${e.message}. Reloading page.`);
        cap.reset();
        await page.goto(TENANT_DD_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(3000);
        await waitForSettle(page, cap.captured, { settleMs: 8000, timeout: 90000 });
      }
    }

    store.recordScrapeTime(allUpPath, {
      charts: allUpRes.stored, snapshot_rows_added: allUpRes.rows, scope: 'all-up',
    });

    // Save meta sidecar
    const metaFile = path.join(store.DATA_DIR, TAB_PATH_ROOT, 'meta.json');
    fs.mkdirSync(path.dirname(metaFile), { recursive: true });
    fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2));
    console.log(`\n✓ Meta saved: ${metaFile}`);
    console.log('✅ Done\n');
  } finally {
    await cap.stop();
  }
}

main().then(() => process.exit(0)).catch(e => {
  console.error('\n❌ Fatal:', e.message);
  console.error(e.stack);
  process.exit(1);
});

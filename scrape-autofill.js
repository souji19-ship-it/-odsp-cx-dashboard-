'use strict';

/**
 * scrape-autofill.js
 *
 * Extracts Autofill Power BI data from two report pages.
 *
 * Page 1 (2e184d4dcc249d2bb7b7) — 4 monthly line charts + yearly tenant count:
 *   • "Number of Tenants using Autofill PAYG by Month" → payg-tenants.json
 *   • "Autofill PAYG usage by Month"                  → payg-usage.json
 *   • "Number of Tenants using Autofill KA by Month"  → ka-tenants.json
 *   • "Autofill KA usage by Month"                    → ka-usage.json
 *   • Yearly count table                              → yearly-totals.json
 *
 * Page 2 (ReportSectiondb71a2377c9c6a66b0ee) — 3 area charts + customer table:
 *   • "AutoFillColumn_R28 by Date"   → r28-trend.json
 *   • "AutoFillColumn_R7 by Date"    → r7-trend.json   (optional)
 *   • "AutoFillColumn_Daily by Date" → daily-trend.json (optional)
 *   • Customer snapshot table        → customers.json
 *
 * KPI headlines (latest value from each line chart) are computed by
 * generate-dashboard-data.js from the trend JSON files.
 *
 * Usage:
 *   node scrape-autofill.js
 *   MIN_SCRAPE_AGE_HOURS=0 node scrape-autofill.js
 */

const { connectToEdge } = require('./lib/cdp-connect');
const path = require('path');
const fs   = require('fs');

const P1_URL =
  'https://msit.powerbi.com/groups/477adf33-883f-4f87-8238-3de5afbecb0d' +
  '/reports/b14faa35-d2f7-4f43-995e-578fad352d4c' +
  '/2e184d4dcc249d2bb7b7?experience=power-bi';

const P2_URL =
  'https://msit.powerbi.com/groups/477adf33-883f-4f87-8238-3de5afbecb0d' +
  '/reports/b14faa35-d2f7-4f43-995e-578fad352d4c' +
  '/ReportSectiondb71a2377c9c6a66b0ee?experience=power-bi';

const DATA_DIR      = path.join(__dirname, 'data', 'autofill');
const MIN_AGE_HOURS = parseInt(process.env.MIN_SCRAPE_AGE_HOURS || '6');

// ── Freshness guard ───────────────────────────────────────────────────────────

function shouldScrape() {
  const p = path.join(DATA_DIR, 'scraped-at.txt');
  if (!fs.existsSync(p)) return true;
  const ageH = (Date.now() - fs.statSync(p).mtimeMs) / 3_600_000;
  if (ageH < MIN_AGE_HOURS) {
    console.log(`↷ Skipping — scraped ${ageH.toFixed(1)}h ago. Pass MIN_SCRAPE_AGE_HOURS=0 to force.`);
    return false;
  }
  return true;
}

// ── Power BI helpers ──────────────────────────────────────────────────────────

async function waitForPbiRender(page, extraMs = 6000) {
  await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(extraMs);
  await page.waitForSelector(
    '[class*="spinnerContainer"], [class*="loadingSpinner"], [aria-label="Loading"]',
    { state: 'hidden', timeout: 20000 }
  ).catch(() => {});
  await page.waitForTimeout(1500);
}

async function navigateToPbi(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (e) {
    if (e.message.includes('ERR_ABORTED') && page.url().includes('powerbi.com')) {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    } else throw e;
  }
}

// Exit "Show as a table" focus mode — try button, fall back to re-navigate
async function exitFocusMode(page, fallbackUrl) {
  const clicked = await page.locator('button:has-text("Back to report")')
    .click({ timeout: 6000 }).then(() => true).catch(() => false);
  if (!clicked) {
    await navigateToPbi(page, fallbackUrl);
  }
  await page.waitForTimeout(2000);
}

// ── Grid table extraction (for actual table visuals, already rendered) ────────

// Find a [role="grid"] ElementHandle whose column headers contain the keyword.
// Use when multiple grids coexist on the page (e.g., slicer + main table).
async function findGridByHeader(page, headerKeyword, timeout = 15000) {
  await page.waitForSelector('[role="grid"]', { timeout });
  const handles = await page.locator('[role="grid"]').elementHandles();
  for (const h of handles) {
    const headers = await h.evaluate(g =>
      Array.from(g.querySelectorAll('[role="columnheader"]'))
        .map(x => (x.textContent || '').trim())
    );
    if (headers.some(t => t.includes(headerKeyword))) return h;
  }
  throw new Error(`No [role="grid"] contains "${headerKeyword}" column header`);
}

// Mark all currently-visible grids with a data attribute so a subsequent
// findNewGrid() call can identify a grid that appeared after some action.
async function markExistingGrids(page) {
  await page.evaluate(() => {
    document.querySelectorAll('[role="grid"]').forEach(g => g.setAttribute('data-pre-focus', '1'));
  });
}

// Find a grid that was added after markExistingGrids() — i.e. the one created by
// Power BI's "Show as a table" focus action.
async function findNewGrid(page, timeout = 20000) {
  await page.waitForSelector('[role="grid"]:not([data-pre-focus])', { timeout });
  return await page.locator('[role="grid"]:not([data-pre-focus])').first().elementHandle();
}

// exhaustiveScroll: ignore aria-rowcount and scroll until no new rows found.
// Use for virtualized tables where aria-rowcount reports partial/incorrect counts.
// Caller passes an ElementHandle scoped to the specific grid (so multi-grid pages
// don't bleed rows from neighbouring slicers/tables into the result).
async function extractGrid(page, gridEl, { maxRows = 1000, exhaustiveScroll = false } = {}) {
  await page.waitForTimeout(600);

  const headers = await gridEl.evaluate(g =>
    Array.from(g.querySelectorAll('[role="columnheader"]'))
      .map(h => (h.textContent || '').trim())
  );
  console.log(`  Headers (${headers.length}): ${headers.slice(0, 8).join(' | ')}`);

  const ariaCount = parseInt((await gridEl.getAttribute('aria-rowcount')) || '0');
  const totalRows = exhaustiveScroll ? maxRows : (ariaCount || maxRows);

  const allRows = new Map();

  const extractVisible = () => gridEl.evaluate(g => {
    const out = [];
    for (const row of g.querySelectorAll('[role="row"]')) {
      const cells = Array.from(
        row.querySelectorAll('[role="gridcell"], [role="rowheader"]')
      ).map(c => (c.textContent || '').trim());
      if (!cells.length) continue;
      out.push([cells.join('\x00'), cells]);
    }
    return out;
  });

  const gridBox = await gridEl.boundingBox().catch(() => null);
  const mx = gridBox ? gridBox.x + gridBox.width  / 2 : 740;
  const my = gridBox ? gridBox.y + gridBox.height / 2 : 500;
  await page.mouse.move(mx, my);

  (await extractVisible()).forEach(([k, c]) => allRows.set(k, c));

  let noProgress = 0;
  const limit = Math.min(totalRows - 1, maxRows);
  while (noProgress < 10 && allRows.size < limit) {
    const before = allRows.size;
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(300);
    (await extractVisible()).forEach(([k, c]) => allRows.set(k, c));
    noProgress = allRows.size > before ? 0 : noProgress + 1;
  }

  const rows = Array.from(allRows.values());
  console.log(`  ✓ ${rows.length} rows (aria-rowcount=${ariaCount})`);
  return { headers, rows };
}

// ── Chart → "Show as a table" extraction ─────────────────────────────────────

// Extracts a named chart's data by entering "Show as a table" focus mode.
// Returns { dates, series[] } for time-series charts, or { headers, rows } for tables.
async function showAsTableAndExtract(page, chartAriaLabel, maxRows = 2000) {
  console.log(`  → Extracting "${chartAriaLabel}"...`);

  // Find the chart by exact aria-label (trailing space in PBI labels is common)
  const el = page.locator(`[aria-label="${chartAriaLabel}"], [aria-label="${chartAriaLabel} "]`).first();
  await el.waitFor({ timeout: 15000 });
  await el.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(500);

  // Tag all currently-visible grids so we can find the new focus-mode grid
  // after "Show as a table" opens (Power BI pages often have slicer/table grids
  // already in the DOM).
  await markExistingGrids(page);

  // Open More Options (...) — hover to reveal the button, then JS-click to avoid
  // race conditions where PBI re-renders the button between Playwright's check and action.
  await el.hover({ force: true });
  await page.waitForTimeout(2000);  // wait for hover-reveal animation

  // Try to click via JS (instant, avoids stale-element races)
  const clicked = await page.evaluate(() => {
    const btn = document.querySelector('button[data-testid="visual-more-options-btn"]');
    if (btn) { btn.click(); return true; }
    return false;
  });
  if (!clicked) {
    // Fallback: find via locator and force-click
    console.log('    (JS click missed — falling back to locator force-click)');
    const moreBtn = page.locator('button[data-testid="visual-more-options-btn"]').first();
    await moreBtn.waitFor({ state: 'visible', timeout: 6000 });
    await moreBtn.click({ timeout: 5000, force: true });
  }
  await page.waitForTimeout(500);

  // Click "Show as a table"
  await page.locator('[data-testid="pbimenu-item.Show as a table"]').click({ timeout: 8000, force: true });

  // Scope to the new (focus-mode) grid, not any pre-existing slicer/table grid
  const gridEl = await findNewGrid(page, 20000);
  await page.waitForTimeout(2000);

  // Column headers (scoped to the focus-mode grid only)
  const headers = await gridEl.evaluate(g =>
    Array.from(g.querySelectorAll('[role="columnheader"]'))
      .map(h => (h.textContent || '').trim())
  );
  console.log(`    Headers: ${headers.join(' | ')}`);

  const totalRows = parseInt((await gridEl.getAttribute('aria-rowcount')) || '0');
  const dataRows = totalRows - 1;
  console.log(`    ${dataRows} data rows`);

  const allRows = new Map();

  const extractVisible = () => gridEl.evaluate(g => {
    const out = [];
    for (const row of g.querySelectorAll('[role="row"]')) {
      const hdr = row.querySelector('[role="rowheader"]');
      if (!hdr) continue;
      const key = (hdr.textContent || '').trim();
      if (!key) continue;
      const cells = Array.from(row.querySelectorAll('[role="gridcell"]'))
        .map(c => (c.textContent || '').trim());
      out.push([key, cells]);
    }
    return out;
  });

  const gridBox = await gridEl.boundingBox().catch(() => null);
  const mx = gridBox ? gridBox.x + gridBox.width  / 2 : 740;
  const my = gridBox ? gridBox.y + gridBox.height / 2 : 650;
  await page.mouse.move(mx, my);

  (await extractVisible()).forEach(([k, c]) => allRows.set(k, c));

  let noProgress = 0;
  const limit = Math.min(dataRows, maxRows);
  while (noProgress < 8 && allRows.size < limit) {
    const before = allRows.size;
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(250);
    (await extractVisible()).forEach(([k, c]) => allRows.set(k, c));
    noProgress = allRows.size > before ? 0 : noProgress + 1;
  }
  console.log(`    ✓ ${allRows.size}/${limit} rows collected`);

  // Try to parse as a date-keyed time series
  const parseDate = ds => {
    let d = new Date(ds);
    if (isNaN(d.getTime()) && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(ds)) {
      const [m, day, y] = ds.split('/');
      d = new Date(`${y}-${m.padStart(2, '0')}-${day.padStart(2, '0')}`);
    }
    return d;
  };
  // Use LOCAL date components to avoid UTC midnight rollback across month boundaries
  const localIso = d =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const sorted = Array.from(allRows.entries())
    .map(([key, cells]) => ({ key, d: parseDate(key), cells }))
    .filter(x => !isNaN(x.d.getTime()))
    .sort((a, b) => a.d - b.d);

  const isTimeSeries = sorted.length > 0 && sorted.length === allRows.size;

  if (isTimeSeries) {
    // Return as { dates, series[] }
    const seriesCount = headers.length - 1;
    const seriesVals  = Array.from({ length: seriesCount }, () => []);
    const dates       = [];

    for (const { d, cells } of sorted) {
      dates.push(localIso(d));
      for (let i = 0; i < seriesCount; i++) {
        const raw = (cells[i] || '').replace(/,/g, '');
        seriesVals[i].push(raw === '' ? null : parseFloat(raw) || 0);
      }
    }

    return {
      type: 'timeseries',
      dates,
      series: headers.slice(1).map((name, i) => ({ name, values: seriesVals[i] })),
    };
  }

  // Fall back to raw { headers, rows }
  return {
    type: 'table',
    headers,
    rows: Array.from(allRows.values()),
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║                  Autofill Scraper  v2                      ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  console.log(`Started: ${new Date().toLocaleString()}\n`);

  if (!shouldScrape()) return;

  fs.mkdirSync(DATA_DIR, { recursive: true });

  const results = {};

  try {
    const { page } = await connectToEdge();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.bringToFront().catch(() => {});

    // ════════════════════════════════════════════════════════════════════════
    // PAGE 1 — monthly line charts + yearly tenant count
    // ════════════════════════════════════════════════════════════════════════
    console.log('═══════════════════════════════════════');
    console.log('PAGE 1: monthly line charts + year table');
    console.log('═══════════════════════════════════════\n');

    await navigateToPbi(page, P1_URL);
    await waitForPbiRender(page, 10000);

    const P1_CHARTS = [
      { label: 'Number of Tenants using Autofill PAYG by Month', file: 'payg-tenants.json' },
      { label: 'Autofill PAYG usage by Month',                   file: 'payg-usage.json'   },
      { label: 'Number of Tenants using Autofill KA by Month',   file: 'ka-tenants.json'   },
      { label: 'Autofill KA usage by Month',                     file: 'ka-usage.json'     },
    ];

    for (const { label, file } of P1_CHARTS) {
      // Fresh navigation before every chart — avoids stale hover/focus state
      // left behind by Power BI after previous "Back to report" exits.
      await navigateToPbi(page, P1_URL);
      await waitForPbiRender(page, 8000);
      try {
        const data = await showAsTableAndExtract(page, label);
        fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));
        console.log(`  ✓ ${file} saved (type=${data.type}, rows=${data.dates?.length ?? data.rows?.length})\n`);
        results[file] = true;
      } catch (e) {
        console.log(`  ⚠ "${label}": ${e.message}`);
        console.log(`    ${e.stack?.split('\n').slice(1, 3).join(' | ')}\n`);
        results[file] = false;
      }
      // Next iteration re-navigates; no exitFocusMode needed.
    }

    // Yearly tenant count table (no focus mode needed — it's a regular grid)
    console.log('\n  Yearly tenant count table...');
    try {
      // Page 1 has only one grid (the yearly table), but scope it explicitly anyway.
      const ytGrid = await page.locator('[role="grid"]').first().elementHandle();
      const yt = await extractGrid(page, ytGrid, { maxRows: 10 });
      fs.writeFileSync(path.join(DATA_DIR, 'yearly-totals.json'), JSON.stringify(yt, null, 2));
      console.log('  ✓ yearly-totals.json saved\n');
      results['yearly-totals.json'] = true;
    } catch (e) {
      console.log(`  ⚠ Yearly table: ${e.message}\n`);
      results['yearly-totals.json'] = false;
    }

    // ════════════════════════════════════════════════════════════════════════
    // PAGE 2 — area charts + customer snapshot table
    // ════════════════════════════════════════════════════════════════════════
    console.log('═══════════════════════════════════════');
    console.log('PAGE 2: area charts + customer table');
    console.log('═══════════════════════════════════════\n');

    await navigateToPbi(page, P2_URL);
    await waitForPbiRender(page, 10000);

    // Customer snapshot table — sort by R28 desc so we capture top customers, not
    // the first alphabetical slice that the virtualized table renders by default.
    console.log('  Customer snapshot table...');
    try {
      // The table is below the area charts — scroll the PBI canvas to reveal it.
      await page.evaluate(() => {
        const scroll = document.querySelector('[class*="canvasScrollbar"], [class*="reportPage"], .scroll-wrapper');
        if (scroll) scroll.scrollTop = scroll.scrollHeight;
        else window.scrollBy(0, 3000);
      });
      await page.waitForTimeout(2500);

      // Page 2 has 2 grids (a small date-slicer + the actual customer table).
      // Pick the one whose headers include "Tenant" — that's the customer table.
      const custGrid = await findGridByHeader(page, 'Tenant');

      // Click the AutoFillColumn_R28 column header within THIS grid to sort desc
      // so the top customers + Grand Total row are in the first visible rows
      // (virtualized table = can't scroll all rows).
      const r28Header = await custGrid.evaluateHandle(g =>
        Array.from(g.querySelectorAll('[role="columnheader"]'))
          .find(h => (h.textContent || '').includes('AutoFillColumn_R28'))
      );
      const headerVisible = await r28Header.evaluate(el => !!el).catch(() => false);
      if (headerVisible) {
        await r28Header.click({ timeout: 5000 });   // 1st click = ascending
        await page.waitForTimeout(1000);
        await r28Header.click({ timeout: 5000 });   // 2nd click = descending
        await page.waitForTimeout(1500);
        console.log('  Sorted by R28 desc');
      } else {
        console.log('  (R28 header not found — using default sort)');
      }

      const cust = await extractGrid(page, custGrid, { maxRows: 1000, exhaustiveScroll: true });
      fs.writeFileSync(path.join(DATA_DIR, 'customers.json'), JSON.stringify(cust, null, 2));
      console.log(`  ✓ customers.json saved (${cust.rows.length} rows)\n`);
      results['customers.json'] = true;
    } catch (e) {
      console.log(`  ⚠ Customer table: ${e.message}\n`);
      results['customers.json'] = false;
    }

    // Area charts — navigate back first
    await navigateToPbi(page, P2_URL);
    await waitForPbiRender(page, 8000);

    const P2_CHARTS = [
      { label: 'AutoFillColumn_R28 by Date',   file: 'r28-trend.json'   },
      { label: 'AutoFillColumn_R7 by Date',    file: 'r7-trend.json'    },
      { label: 'AutoFillColumn_Daily by Date', file: 'daily-trend.json' },
    ];

    for (const { label, file } of P2_CHARTS) {
      await navigateToPbi(page, P2_URL);
      await waitForPbiRender(page, 8000);
      try {
        const data = await showAsTableAndExtract(page, label);
        fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));
        console.log(`  ✓ ${file} saved (type=${data.type}, rows=${data.dates?.length ?? data.rows?.length})\n`);
        results[file] = true;
      } catch (e) {
        console.log(`  ⚠ "${label}": ${e.message}`);
        console.log(`    ${e.stack?.split('\n').slice(1, 3).join(' | ')}\n`);
        results[file] = false;
      }
    }

    // ── Save timestamp ────────────────────────────────────────────────────
    fs.writeFileSync(path.join(DATA_DIR, 'scraped-at.txt'), new Date().toISOString());

    // ── Summary ───────────────────────────────────────────────────────────
    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));
    for (const [file, ok] of Object.entries(results)) {
      console.log(`${ok ? '✓' : '⚠'} ${file}`);
    }
    console.log('='.repeat(60));
    console.log(`\nCompleted: ${new Date().toLocaleString()}`);
    console.log('✅ Done\n');

  } catch (err) {
    console.error('\n❌ Fatal error:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

main().then(() => process.exit(0));

'use strict';

/**
 * scrape-ai-reach.js
 *
 * Extracts AI Reach Power BI data by switching each chart to "Show as a table"
 * mode, then scrolling through the virtualized grid to collect all rows.
 *
 * Two report pages are scraped (each its own URL):
 *   Intranet Reach    — visual: "AI INTRANET REACH - R28 TREND"
 *   Doc Library Reach — visual: "AI DOC LIBS REACH - R28 TREND"
 *
 * Output files (data/ai-reach/):
 *   intranet-reach.json    — R28 viewer counts by intranet feature
 *   doc-library-reach.json — R28 viewer counts by doc-library feature
 *   scraped-at.txt         — ISO timestamp
 *
 * Usage:
 *   node scrape-ai-reach.js
 *   MIN_SCRAPE_AGE_HOURS=0 node scrape-ai-reach.js   # force re-scrape
 */

const { connectToEdge } = require('./lib/cdp-connect');
const path = require('path');
const fs   = require('fs');

const PAGES = [
  {
    label: 'intranet-reach',
    url: 'https://msit.powerbi.com/groups/c83f6f58-7a8f-44bc-a6a3-1877cea06db5' +
         '/reports/64a53afb-a071-4d6c-8e8d-effb5153a663' +
         '/dd97518dc74b0493e353?experience=power-bi',
  },
  {
    label: 'doc-library-reach',
    url: 'https://msit.powerbi.com/groups/c83f6f58-7a8f-44bc-a6a3-1877cea06db5' +
         '/reports/64a53afb-a071-4d6c-8e8d-effb5153a663' +
         '/9aaf19b67473474490c1?experience=power-bi',
  },
];

const DATA_DIR = path.join(__dirname, 'data', 'ai-reach');
const MIN_SCRAPE_AGE_HOURS = parseInt(process.env.MIN_SCRAPE_AGE_HOURS || '6');

// ── Freshness check ───────────────────────────────────────────────────────────

function shouldScrape() {
  const p = path.join(DATA_DIR, 'intranet-reach.json');
  if (!fs.existsSync(p)) return true;
  const ageH = (Date.now() - fs.statSync(p).mtimeMs) / 3_600_000;
  if (ageH < MIN_SCRAPE_AGE_HOURS) {
    console.log(`↷ Skipping — scraped ${ageH.toFixed(1)}h ago. Pass MIN_SCRAPE_AGE_HOURS=0 to force.`);
    return false;
  }
  return true;
}

// ── Wait for Power BI to render ───────────────────────────────────────────────

async function waitForPbiRender(page, extraMs = 6000) {
  await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(extraMs);
  await page.waitForSelector(
    '[class*="spinnerContainer"], [class*="loadingSpinner"], [aria-label="Loading"]',
    { state: 'hidden', timeout: 20000 }
  ).catch(() => {});
  await page.waitForTimeout(1500);
}

// ── Extract chart data via "Show as a table" + virtual scroll ─────────────────

async function showAsTableAndExtract(page, label) {
  console.log(`  Extracting ${label} via "Show as a table"...`);

  // Remove 1Password notification via JS (it intercepts pointer events on the More Options button)
  await page.evaluate(() => {
    document.querySelectorAll('com-1password-notification').forEach(el => el.remove());
  });
  await page.waitForTimeout(300);

  // Hover over the line chart visual to surface the header icon buttons
  await page.locator('[aria-roledescription="Line chart"]').first().hover();
  await page.waitForTimeout(1500);

  // Open More Options menu
  await page.locator('button[data-testid="visual-more-options-btn"]').click({ timeout: 6000, force: true });
  await page.waitForTimeout(1500);

  // Switch to table view — try multiple selectors as PBI data-testid may vary
  const showAsTableSelectors = [
    '[data-testid="pbimenu-item.Show as a table"]',
    '[aria-label="Show as a table"]',
    '[role="menuitem"]:has-text("Show as a table")',
    'button:has-text("Show as a table")',
  ];
  let clicked = false;
  for (const sel of showAsTableSelectors) {
    try {
      await page.locator(sel).first().click({ timeout: 3000 });
      clicked = true;
      break;
    } catch {}
  }
  if (!clicked) throw new Error('Could not find "Show as a table" menu item');

  // Wait for the grid to appear
  await page.waitForSelector('[role="grid"]', { timeout: 15000 });
  await page.waitForTimeout(1500);

  // Read column headers (Date + series names)
  const headers = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[role="columnheader"]')).map(h => h.textContent?.trim())
  );
  console.log(`    Headers: ${headers.join(', ')}`);

  // Get scroll container metadata
  const scrollInfo = await page.evaluate(() => {
    const sc   = document.querySelector('.mid-viewport');
    const grid = document.querySelector('[role="grid"]');
    if (!sc) return null;
    return {
      scrollHeight: sc.scrollHeight,
      clientHeight: sc.clientHeight,
      totalRows:    parseInt(grid?.getAttribute('aria-rowcount') || '0'),
    };
  });

  if (!scrollInfo) throw new Error(`Scroll container not found for ${label}`);
  console.log(`    Grid: ${scrollInfo.totalRows} rows, scroll range: ${scrollInfo.scrollHeight}px`);

  // Collect rows by scrolling through the virtualized grid.
  // PBI's pivot table virtual renderer requires real WheelEvents (not scrollTop
  // assignment) to update its row window.  We position the mouse over the grid
  // and use page.mouse.wheel() so CDP sends native scroll events.
  const allRows  = new Map(); // dateString → cell values[]
  const dataRows = scrollInfo.totalRows - 1; // exclude header row

  const extractVisible = () => page.evaluate(() => {
    const out = [];
    for (const row of document.querySelectorAll('[role="row"]')) {
      const dateEl = row.querySelector('[role="rowheader"]');
      if (!dateEl) continue;
      const date = dateEl.textContent?.trim();
      if (!date) continue;
      const cells = Array.from(row.querySelectorAll('[role="gridcell"]'))
        .map(c => c.textContent?.trim() || '');
      out.push([date, cells]);
    }
    return out;
  });

  // Position mouse over the grid so wheel events hit it
  const gridBox = await page.locator('[role="grid"]').boundingBox().catch(() => null);
  const mx = gridBox ? gridBox.x + gridBox.width  / 2 : 740;
  const my = gridBox ? gridBox.y + gridBox.height / 2 : 650;
  await page.mouse.move(mx, my);

  // Collect initial visible rows
  (await extractVisible()).forEach(([d, c]) => allRows.set(d, c));

  // Scroll downward in small wheel increments until no new rows appear
  const WHEEL_DELTA   = 120;   // px per wheel tick (one notch)
  const WAIT_MS       = 250;   // ms between ticks
  const MAX_NO_PROG   = 8;     // stop after N ticks with no new rows
  let noProgress = 0;

  while (noProgress < MAX_NO_PROG && allRows.size < dataRows) {
    const before = allRows.size;
    await page.mouse.wheel(0, WHEEL_DELTA);
    await page.waitForTimeout(WAIT_MS);
    (await extractVisible()).forEach(([d, c]) => allRows.set(d, c));
    noProgress = allRows.size > before ? 0 : noProgress + 1;
  }

  console.log(`  ✓ ${label}: ${allRows.size}/${dataRows} rows collected`);

  // Parse dates and build structured output
  const seriesCount  = headers.length - 1;
  const seriesValues = Array.from({ length: seriesCount }, () => []);
  const dates        = [];

  const sorted = Array.from(allRows.entries())
    .map(([ds, cells]) => {
      // PBI renders dates as M/D/YYYY
      let d = new Date(ds);
      if (isNaN(d.getTime()) && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(ds)) {
        const [m, day, y] = ds.split('/');
        d = new Date(`${y}-${m.padStart(2, '0')}-${day.padStart(2, '0')}`);
      }
      return [d, cells];
    })
    .filter(([d]) => !isNaN(d.getTime()))
    .sort((a, b) => a[0] - b[0]);

  for (const [d, cells] of sorted) {
    dates.push(d.toISOString().slice(0, 10));
    for (let i = 0; i < seriesCount; i++) {
      const raw = (cells[i] || '').replace(/,/g, '');
      seriesValues[i].push(raw === '' ? null : parseFloat(raw) || 0);
    }
  }

  return {
    dates,
    series: headers.slice(1).map((name, i) => ({ name, values: seriesValues[i] })),
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║                  AI Reach Scraper                          ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  console.log(`Started: ${new Date().toLocaleString()}\n`);

  if (!shouldScrape()) return;

  fs.mkdirSync(DATA_DIR, { recursive: true });

  try {
    const { page } = await connectToEdge();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.bringToFront().catch(() => {});

    let anySucceeded = false;
    for (const { label, url } of PAGES) {
      console.log(`\nNavigating to ${label}...`);
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      } catch (navErr) {
        if (navErr.message.includes('ERR_ABORTED') && page.url().includes('powerbi.com')) {
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
        } else throw navErr;
      }

      console.log(`Waiting for ${label} chart to render...`);
      await waitForPbiRender(page, 10000);

      try {
        const data = await showAsTableAndExtract(page, label);
        fs.writeFileSync(path.join(DATA_DIR, `${label}.json`), JSON.stringify(data, null, 2));
        anySucceeded = true;
      } catch (pageErr) {
        console.error(`  ⚠️  Failed to extract ${label}: ${pageErr.message}`);
      }
    }

    if (anySucceeded) {
      fs.writeFileSync(path.join(DATA_DIR, 'scraped-at.txt'), new Date().toISOString());
    }

    console.log(`\nCompleted: ${new Date().toLocaleString()}`);
    console.log('✅ Done\n');

  } catch (err) {
    console.error('\n❌ Fatal error:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

main().then(() => process.exit(0));

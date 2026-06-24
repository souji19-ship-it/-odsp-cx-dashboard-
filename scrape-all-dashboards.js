'use strict';

/**
 * scrape-all-dashboards.js
 *
 * Scrapes four dashboards and produces output files read by the report generators:
 *
 *   1. KAv2 (Knowledge Agent v2) — KAv2 tab + Persona based tab + KAv2 Growth Analytics tab
 *      Outputs: kav2-executive-summary-metrics-{ts}.csv
 *               kav2-executive-summary-table{n}-{ts}.csv   (table charts)
 *               kav2-growth-analytics-metrics-{ts}.csv
 *               kav2-complete-{ts}.json
 *
 *   2. Copilot Extensibility (Competition) — DOM grid extraction (not Superset)
 *      Outputs: copilot-competition-grid-{ts}.csv
 *               copilot-competition-summary-{ts}.csv   (inlined parse-competition-metrics logic)
 *
 *   3. FAB (Floating Action Button) — Superset dashboard via captureDashboardCharts()
 *      Outputs: fab-metrics-{ts}.csv
 *               fab-retention-{ts}.csv
 *               fab-actions-{ts}.csv   (optional)
 *
 *   4. SharePoint AI All-Up — Superset dashboard via captureDashboardCharts()
 *      Outputs: ai-all-up-metrics-{ts}.csv
 *               ai-all-up-table{n}-{ts}.csv
 *               ai-all-up-feature-{slug}-{ts}.csv   (feature-split timeseries)
 *
 * Usage:
 *   node scrape-all-dashboards.js
 *   FORCE=1 node scrape-all-dashboards.js   # skip the recency guard
 */

const fs   = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const { connectToEdge, CDP_URL }      = require('./lib/cdp-connect');
const { captureDashboardCharts }      = require('./lib/nezha-chart-data');
const { findAndClickTab }             = require('./lib/nav-helpers');
const { ensureLoggedIn }              = require('./lib/nezha-auth');

// ── Config ────────────────────────────────────────────────────────────────────

const SKIP_GUARD_HOURS = 20;   // skip if KAv2 JSON output is < this many hours old

const KAV2_URL =
  'https://www.microsoftnezha.com/nezha/dashboard/a82f4c8e-6f29-4402-8fa1-c0af49a5132d/' +
  '?native_filters_key=6FKzlayTLsMAna0Kh_gql5i4DVdcXJS7vhW3VXfxq3IM0tsi495GLon-BzHFEWYV';

const COMP_URL =
  'https://askideas.microsoft.net/dashboard/CopilotExtensibilityDashboard/copilotCommercial';

const FAB_URL  = 'https://www.microsoftnezha.com/nezha/dashboard/4315/';

const AI_ALL_UP_URL =
  'https://www.microsoftnezha.com/nezha/dashboard/3682/' +
  '?native_filters_key=4v6f3MjgDkrMxW-fLhldqrEPg1MV5f5cpEM2ohbwLXWwHNe8swZovIj1P5xmVvpN';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Ensure debug/ sub-directory exists. */
function ensureDebugDir() {
  fs.mkdirSync('debug', { recursive: true });
}

/** Write a 2D array as CSV to the repo root. */
function saveAsCSV(data, filename) {
  const content = data
    .map(row =>
      row.map(cell => {
        const s = String(cell);
        return (s.includes(',') || s.includes('"') || s.includes('\n'))
          ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(',')
    )
    .join('\n');
  fs.writeFileSync(filename, content, 'utf8');
}

/**
 * Build a "Metric,Value" CSV from a map of { chartTitle -> displayedValue }
 * collected from big-number panels.  Table panels are saved separately.
 */
function buildMetricsCSV(metricsMap) {
  return 'Metric,Value\n' +
    Object.entries(metricsMap)
      .filter(([k]) => k.length < 150)
      .map(([k, v]) => `"${k.replace(/"/g, '""')}","${String(v).replace(/"/g, '""')}"`)
      .join('\n');
}

/**
 * Extract bignum display values and table data from a captureDashboardCharts() result.
 *
 * Returns:
 *   { metrics: { chartTitle -> displayedValue },
 *     tables:  [ { title, rows: [[...]] } ]  }
 */
function extractDisplayData(captureResult) {
  const metrics = {};
  const tables  = [];

  for (const [title, chart] of Object.entries(captureResult.charts)) {
    // Big-number chart — use the DOM-rendered value (already formatted for humans)
    if (chart.displayedValue !== null && chart.displayedValue !== undefined) {
      metrics[title] = chart.displayedValue;
      continue;
    }

    // Table chart — extract rows from the API data
    if (chart.data?.data?.length && chart.chartType === 'table') {
      const cols = chart.data.colnames || [];
      const rows = [
        cols,
        ...chart.data.data.map(r => cols.map(c => {
          const v = r[c];
          // Superset API returns __timestamp as epoch ms — convert to YYYY-MM-DD
          if (typeof v === 'number' && v > 1_000_000_000_000) return new Date(v).toISOString().slice(0, 10);
          return v ?? '';
        })),
      ];
      tables.push({ title, rows });
    }
  }

  return { metrics, tables };
}

/**
 * Save KAv2 tab data in the same file format that generate-sharepoint-ai-report.js expects:
 *   {tabSlug}-metrics-{ts}.csv   (Metric,Value)
 *   {tabSlug}-table{n}-{ts}.csv  (raw grid)
 *
 * Also saves the combined JSON for debugging.
 */
function saveKav2TabData(tabSlug, metrics, tables, timestamp) {
  fs.writeFileSync(`${tabSlug}-metrics-${timestamp}.csv`, buildMetricsCSV(metrics), 'utf8');
  tables.forEach((tbl, idx) => {
    saveAsCSV(tbl.rows, `${tabSlug}-table${idx + 1}-${timestamp}.csv`);
  });
}

// ── Skip guard ────────────────────────────────────────────────────────────────

function shouldSkip() {
  if (process.env.FORCE === '1') return false;

  // Look for any kav2-complete-*.json file younger than SKIP_GUARD_HOURS
  try {
    const files = fs.readdirSync('.').filter(f => /^kav2-complete-/.test(f));
    for (const f of files) {
      const ageH = (Date.now() - fs.statSync(f).mtimeMs) / 3_600_000;
      if (ageH < SKIP_GUARD_HOURS) {
        console.log(`↷ Skip guard: "${f}" is ${ageH.toFixed(1)}h old (< ${SKIP_GUARD_HOURS}h). Pass FORCE=1 to override.`);
        return true;
      }
    }
  } catch {}
  return false;
}

// ── KAv2 dashboard ────────────────────────────────────────────────────────────

async function scrapeKav2(page, timestamp) {
  console.log('\n' + '='.repeat(60));
  console.log('DASHBOARD 1: KAv2 Metrics');
  console.log('='.repeat(60));

  const execMetrics  = {};
  const execTables   = [];
  const growthMetrics = {};
  const growthTables  = [];

  // ── Tab 1: KAv2 Executive Summary ─────────────────────────────────────────
  console.log('\n→ KAv2 tab (Executive Summary)...');
  let execResult = await captureDashboardCharts(page, KAV2_URL, {
    settleMs: 15000,
    timeout:  150000,
    onLoaded: async p => {
      await findAndClickTab(p, 'KAv2');
      await p.waitForTimeout(3000);
    },
  });

  let { metrics: m1, tables: t1 } = extractDisplayData(execResult);

  // Validate by chart count — the old DOM-scraped key names don't match Superset panel titles
  const MIN_EXEC_CHARTS = 3;
  if (Object.keys(execResult.charts).length < MIN_EXEC_CHARTS) {
    console.log(`  ⚠️  Only ${Object.keys(execResult.charts).length} charts captured — reloading...`);
    execResult = await captureDashboardCharts(page, KAV2_URL, {
      settleMs: 20000,
      timeout:  180000,
      onLoaded: async p => {
        await findAndClickTab(p, 'KAv2');
        await p.waitForTimeout(5000);
      },
    });
    ({ metrics: m1, tables: t1 } = extractDisplayData(execResult));
  }

  if (Object.keys(execResult.charts).length === 0) {
    throw new Error('KAv2 exec tab: no charts captured after reload.');
  }
  console.log(`  ✓ Captured panels: ${Object.keys(execResult.charts).join(' | ')}`);
  Object.assign(execMetrics, m1);
  execTables.push(...t1);
  console.log(`  ✓ Exec tab: ${Object.keys(execMetrics).length} metrics, ${execTables.length} tables`);

  // ── Tab 1b: Persona based — merge into exec metrics ────────────────────────
  console.log('\n→ Persona based tab...');
  try {
    const personaResult = await captureDashboardCharts(page, KAV2_URL, {
      settleMs: 12000,
      timeout:  90000,
      onLoaded: async p => {
        await findAndClickTab(p, 'Persona based');
        await p.waitForTimeout(3000);
      },
    });
    const { metrics: pm } = extractDisplayData(personaResult);
    // Merge persona metrics into exec (don't overwrite existing keys)
    for (const [k, v] of Object.entries(pm)) {
      if (!execMetrics[k]) execMetrics[k] = v;
    }
    console.log(`  ✓ Persona merged — exec total: ${Object.keys(execMetrics).length} metrics`);
  } catch (e) {
    console.log(`  ⚠️  Persona tab error (non-fatal): ${e.message}`);
  }

  // ── Tab 2: KAv2 Growth Analytics ──────────────────────────────────────────
  console.log('\n→ KAv2 Growth Analytics tab...');
  let growthResult = await captureDashboardCharts(page, KAV2_URL, {
    settleMs: 15000,
    timeout:  150000,
    onLoaded: async p => {
      await findAndClickTab(p, 'KAv2 Growth Analytics');
      await p.waitForTimeout(3000);
    },
  });

  let { metrics: m2, tables: t2 } = extractDisplayData(growthResult);

  const MIN_GROWTH_CHARTS = 3;
  if (Object.keys(growthResult.charts).length < MIN_GROWTH_CHARTS) {
    console.log(`  ⚠️  Only ${Object.keys(growthResult.charts).length} charts — reloading...`);
    growthResult = await captureDashboardCharts(page, KAV2_URL, {
      settleMs: 20000,
      timeout:  180000,
      onLoaded: async p => {
        await findAndClickTab(p, 'KAv2 Growth Analytics');
        await p.waitForTimeout(5000);
      },
    });
    ({ metrics: m2, tables: t2 } = extractDisplayData(growthResult));
  }

  if (Object.keys(growthResult.charts).length === 0) {
    throw new Error('KAv2 Growth tab: no charts captured after reload.');
  }
  console.log(`  ✓ Captured panels: ${Object.keys(growthResult.charts).join(' | ')}`);
  Object.assign(growthMetrics, m2);
  growthTables.push(...t2);
  console.log(`  ✓ Growth tab: ${Object.keys(growthMetrics).length} metrics, ${growthTables.length} tables`);

  // ── Save ───────────────────────────────────────────────────────────────────
  saveKav2TabData('kav2-executive-summary', execMetrics, execTables, timestamp);
  console.log(`  ✓ kav2-executive-summary-metrics-${timestamp}.csv`);

  saveKav2TabData('kav2-growth-analytics', growthMetrics, growthTables, timestamp);
  console.log(`  ✓ kav2-growth-analytics-metrics-${timestamp}.csv`);

  // Combined JSON (for debugging / completeness)
  const combined = {
    timestamp: new Date().toISOString(),
    url: KAV2_URL,
    tabs: {
      'KAv2 Executive Summary': { metrics: execMetrics, metrics_count: Object.keys(execMetrics).length },
      'KAv2 Growth Analytics':  { metrics: growthMetrics, metrics_count: Object.keys(growthMetrics).length },
    },
  };
  fs.writeFileSync(`kav2-complete-${timestamp}.json`, JSON.stringify(combined, null, 2));
  console.log(`  ✓ kav2-complete-${timestamp}.json`);

  console.log('\n✓ KAv2 done');
  return { execMetrics, growthMetrics };
}

// ── Competition dashboard ─────────────────────────────────────────────────────

/**
 * Inline implementation of parse-competition-metrics.js logic.
 * Reads a raw competition grid CSV (2D array) and extracts the All-Up column
 * metrics into copilot-competition-summary-{ts}.csv.
 */
function parseAndSaveCompetitionSummary(gridData, timestamp) {
  const metricRows = {
    'DAU':                  2,
    'WAU':                  3,
    'MAU':                  4,
    'DAU/MAU':              5,
    'Extension-User Pairs': 6,
    'Weekly Return Rate':   21,
    '% Thumbs Down':        19,
  };
  const allUpColIdx = 10;

  const extractedMetrics = {};
  for (const [metricName, rowIdx] of Object.entries(metricRows)) {
    if (rowIdx < gridData.length) {
      const row = gridData[rowIdx];
      const value = row[allUpColIdx] || 'N/A';
      extractedMetrics[metricName] = String(value).replace(/\d{1,2}\/\d{1,2}\/\d{4}/, '').trim();
    }
  }

  const csvLines = ['Metric,Value'];
  for (const [metric, value] of Object.entries(extractedMetrics)) {
    csvLines.push(`"${metric}","${value}"`);
  }

  const outFile = `copilot-competition-summary-${timestamp}.csv`;
  fs.writeFileSync(outFile, csvLines.join('\n') + '\n', 'utf8');
  console.log(`  ✓ Saved competition summary: ${outFile}`);
  return extractedMetrics;
}

async function scrapeCompetition(page, timestamp) {
  console.log('\n' + '='.repeat(60));
  console.log('DASHBOARD 2: Copilot Extensibility (Competition)');
  console.log('='.repeat(60));

  await page.bringToFront().catch(() => {});
  console.log('\nNavigating to competition dashboard...');
  await page.goto(COMP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('load', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(5000);

  // Handle Microsoft account picker / SSO if redirected
  const currentUrl = page.url();
  if (currentUrl.includes('login.microsoft') || currentUrl.includes('login.microsoftonline')) {
    console.log('  → Auth required, handling account picker...');
    try {
      await page.getByText('@microsoft.com').first().click({ timeout: 10000, force: true });
      console.log('  ✓ Selected microsoft.com work account');
    } catch {
      try {
        await page.locator('[role="button"], .tile, .account').first().click({ timeout: 10000, force: true });
        console.log('  ✓ Clicked first account option');
      } catch (e) {
        console.log(`  ⚠️  Could not click account: ${e.message}`);
      }
    }
    try {
      await page.waitForURL(
        url => !url.includes('login.microsoft') && !url.includes('login.microsoftonline'),
        { timeout: 30000 }
      );
      console.log('  ✓ SSO redirect complete');
    } catch {
      console.log('  ⚠️  SSO redirect timed out, continuing...');
    }
  }

  await page.waitForTimeout(20000);
  console.log('→ Extracting competition grid...');

  const gridSelectors = [
    '[role="grid"], [role="table"], [role="treegrid"]',
    'table',
    '[class*="grid"]',
    '[class*="table"]',
  ];

  let competitionDataExtracted = false;
  let savedGridData = null;

  for (const selector of gridSelectors) {
    if (competitionDataExtracted) break;

    const grids = await page.$$(selector);
    console.log(`  Trying "${selector}": found ${grids.length} elements`);

    for (let i = 0; i < grids.length; i++) {
      const gridData = await grids[i].evaluate(gridEl => {
        const rows = [];
        let rowEls = gridEl.querySelectorAll('[role="row"]');
        if (rowEls.length === 0) rowEls = gridEl.querySelectorAll('tr');
        rowEls.forEach(row => {
          const cells = [];
          let cellEls = row.querySelectorAll('[role="gridcell"],[role="cell"],[role="columnheader"]');
          if (cellEls.length === 0) cellEls = row.querySelectorAll('td,th');
          cellEls.forEach(cell => cells.push(cell.textContent.trim()));
          if (cells.length > 0) rows.push(cells);
        });
        return rows;
      });

      if (gridData.length > 0 && gridData[0].length > 5) {
        const filename = `copilot-competition-grid-${timestamp}.csv`;
        saveAsCSV(gridData, filename);
        console.log(`  ✓ Grid saved: ${gridData.length} rows × ${gridData[0].length} cols → ${filename}`);
        savedGridData = gridData;
        competitionDataExtracted = true;

        // Inline competition parsing (replaces parse-competition-metrics.js call)
        parseAndSaveCompetitionSummary(gridData, timestamp);
        break;
      }
    }
  }

  if (!competitionDataExtracted) {
    console.log('  ⚠️  No data grid found with any selector');
    ensureDebugDir();
    const debugPath = path.join('debug', `competition-debug-${timestamp}.png`);
    await page.screenshot({ path: debugPath, fullPage: true });
    console.log(`  📸 Debug screenshot: ${debugPath}`);
  }

  console.log('\n✓ Competition done');
  return { extracted: competitionDataExtracted };
}

// ── FAB dashboard ─────────────────────────────────────────────────────────────

async function scrapeFab(page, timestamp) {
  console.log('\n' + '='.repeat(60));
  console.log('DASHBOARD 3: FAB (Floating Action Button)');
  console.log('='.repeat(60));

  // Required keys for validation
  const requiredOpenedKey = 'Unique Users Opened FAB (WoW R28)';
  const requiredActedKey  = 'Unique Users Acted on FAB (WoW R28)';

  console.log('\nCapturing FAB dashboard...');
  let fabResult = await captureDashboardCharts(page, FAB_URL, {
    settleMs: 15000,
    timeout:  150000,
  });

  let { metrics, tables } = extractFabDisplayData(fabResult);

  // Retry if required keys missing
  const missing = [requiredOpenedKey, requiredActedKey].filter(k => !metrics[k]);
  if (missing.length > 0) {
    console.log(`  ⚠️  Missing: ${missing.join(', ')} — reloading...`);
    fabResult = await captureDashboardCharts(page, FAB_URL, {
      settleMs: 20000,
      timeout:  180000,
    });
    ({ metrics, tables } = extractFabDisplayData(fabResult));
  }

  if (!metrics[requiredOpenedKey]) {
    throw new Error(`FAB: required key "${requiredOpenedKey}" never loaded.`);
  }
  if (!metrics[requiredActedKey]) {
    throw new Error(`FAB: required key "${requiredActedKey}" never loaded.`);
  }

  // Save fab-metrics-*.csv (Metric,Value format)
  const metricsRows = [['Metric', 'Value']];
  for (const [k, v] of Object.entries(metrics)) {
    metricsRows.push([k, v]);
  }
  saveAsCSV(metricsRows, `fab-metrics-${timestamp}.csv`);
  console.log(`  ✓ fab-metrics-${timestamp}.csv (${metricsRows.length - 1} metrics)`);

  // Save retention and actions tables
  const retentionTable = tables.find(t => t.isRetention);
  const actionsTable   = tables.find(t => !t.isRetention);

  if (retentionTable?.rows.length > 0) {
    saveAsCSV(retentionTable.rows, `fab-retention-${timestamp}.csv`);
    console.log(`  ✓ fab-retention-${timestamp}.csv (${retentionTable.rows.length} rows)`);
  } else {
    console.log('  ⚠️  FAB retention table not found');
  }

  if (actionsTable?.rows.length > 0) {
    saveAsCSV(actionsTable.rows, `fab-actions-${timestamp}.csv`);
    console.log(`  ✓ fab-actions-${timestamp}.csv (${actionsTable.rows.length} rows)`);
  }

  if (metrics['Unique Users Seen FAB']) {
    console.log(`  ✓ "Saw FAB" metric captured: ${metrics['Unique Users Seen FAB']}`);
  } else {
    console.log('  ⚠ "Saw FAB" metric not found — open-rate funnel will be skipped');
  }

  console.log('\n✓ FAB done');
  return { metrics, retentionRows: retentionTable?.rows.length ?? 0 };
}

/**
 * Extract FAB metrics and tables from a captureDashboardCharts() result.
 *
 * Big-number panels → metrics map.
 * Table panels      → classified as retention (has date rows) or actions.
 * SVG/funnel panels → attempt to extract "Seen FAB" total.
 *
 * Returns { metrics: {}, tables: [{ title, rows, isRetention }] }
 */
function extractFabDisplayData(captureResult) {
  const metrics = {};
  const tables  = [];

  for (const [title, chart] of Object.entries(captureResult.charts)) {
    // Big-number: use the DOM-rendered display value
    if (chart.displayedValue !== null && chart.displayedValue !== undefined) {
      metrics[title] = chart.displayedValue;
      continue;
    }

    // Table or retention chart — Superset's "retention" viz type has tabular API data
    // but renders with a custom component (no <table> in the DOM), so chartType === 'retention'
    if (chart.data?.data?.length && (chart.chartType === 'table' || chart.chartType === 'retention')) {
      const cols = chart.data.colnames || [];
      const rows = [cols, ...chart.data.data.map(r => cols.map(c => String(r[c] ?? '')))];
      const firstText = rows.slice(0, 3).map(r => r[0] || '').join(' ');
      const isRetention = /start\s*date/i.test(firstText) || /\d{4}-\d{2}-\d{2}/.test(firstText) ||
                          title.toLowerCase().includes('retention');
      tables.push({ title, rows, isRetention });
      continue;
    }

    // SVG / funnel chart — try to pull "Seen FAB" count from displayedSubtitle labels
    if (chart.displayedSubtitle && chart.chartType !== 'unknown') {
      const labels = chart.displayedSubtitle.split(' | ');
      for (let i = 0; i < labels.length; i++) {
        if (labels[i].toLowerCase().includes('seen fab')) {
          for (let j = i + 1; j < Math.min(i + 8, labels.length); j++) {
            if (/^\d{4,}$/.test(labels[j].replace(/,/g, ''))) {
              metrics['Unique Users Seen FAB'] = labels[j];
              break;
            }
          }
          break;
        }
      }
    }
  }

  return { metrics, tables };
}

// ── SharePoint AI All-Up dashboard ───────────────────────────────────────────

async function scrapeAiAllUp(page, timestamp) {
  console.log('\n' + '='.repeat(60));
  console.log('DASHBOARD 4: SharePoint AI All-Up');
  console.log('='.repeat(60));

  const metricsMap = {};
  let tableIdx = 1;

  // ── Default tab: Objective 0 Dashboard ────────────────────────────────────
  console.log('\n→ Scraping default tab (Objective 0 Dashboard)...');
  const okrResult = await captureDashboardCharts(page, AI_ALL_UP_URL, {
    settleMs: 18000,
    timeout:  150000,
  });

  const { metrics: okrMetrics, tables: okrTables } = extractDisplayData(okrResult);
  Object.assign(metricsMap, okrMetrics);
  for (const tbl of okrTables) {
    saveAsCSV(tbl.rows, `ai-all-up-table${tableIdx}-${timestamp}.csv`);
    console.log(`  ✓ ai-all-up-table${tableIdx}-${timestamp}.csv ("${tbl.title}", ${tbl.rows.length} rows)`);
    tableIdx++;
  }

  // Also save timeseries chart data from the OKR tab (e.g. WAU trend, MAU)
  for (const [title, chart] of Object.entries(okrResult.charts)) {
    if (!chart.data?.data?.length || chart.data.timeColumn === null) continue;
    const cols = chart.data.colnames || [];
    const header = cols.map(c => c === '__timestamp' ? 'Date' : c);
    const rows = [header, ...chart.data.data.map(row =>
      cols.map(col => {
        const v = row[col];
        if (col === '__timestamp' && typeof v === 'number') return new Date(v).toISOString().slice(0, 10);
        return v == null ? '' : String(v);
      })
    )];
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
    saveAsCSV(rows, `ai-all-up-feature-${slug}-${timestamp}.csv`);
    console.log(`  ✓ ai-all-up-feature-${slug}-${timestamp}.csv (${rows.length - 1} rows × ${header.length} cols)`);
  }

  console.log(`  ✓ Objective 0 tab: ${Object.keys(okrMetrics).length} bignum metrics, ${okrTables.length} tables`);

  // ── Copilot OKR tab — has AI Usage MAU, WoW retention, Engage metrics ─────
  console.log('\n→ Copilot OKR tab...');
  try {
    const copilotOkrResult = await captureDashboardCharts(page, AI_ALL_UP_URL, {
      settleMs: 18000,
      timeout:  150000,
      onLoaded: async p => {
        await findAndClickTab(p, 'Copilot OKR');
        await p.waitForTimeout(3000);
      },
    });
    const { metrics: copilotOkrMetrics } = extractDisplayData(copilotOkrResult);
    for (const [k, v] of Object.entries(copilotOkrMetrics)) {
      if (!metricsMap[k]) metricsMap[k] = v;
    }
    console.log(`  ✓ Copilot OKR tab: ${Object.keys(copilotOkrMetrics).length} bignum metrics`);
  } catch (e) {
    console.log(`  ⚠️  Copilot OKR tab error: ${e.message}`);
  }

  // ── Feature Split tab ──────────────────────────────────────────────────────
  console.log('\n→ Feature Split tab...');
  try {
    const featureResult = await captureDashboardCharts(page, AI_ALL_UP_URL, {
      settleMs: 25000,   // ECharts timeseries charts settle slowly
      timeout:  180000,
      onLoaded: async p => {
        await findAndClickTab(p, 'Feature Split');
        await p.waitForTimeout(5000);
      },
    });

    const { metrics: featureMetrics, tables: featureTables } = extractDisplayData(featureResult);

    // Merge new bignum values into metrics
    for (const [k, v] of Object.entries(featureMetrics)) {
      if (!metricsMap[k]) metricsMap[k] = v;
    }

    // Save feature-split tables and timeseries
    for (const tbl of featureTables) {
      const slug = tbl.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
      saveAsCSV(tbl.rows, `ai-all-up-feature-${slug}-${timestamp}.csv`);
      console.log(`  ✓ ai-all-up-feature-${slug}-${timestamp}.csv (${tbl.rows.length} rows, table)`);
    }

    for (const [title, chart] of Object.entries(featureResult.charts)) {
      if (!chart.data?.data?.length || chart.data.timeColumn === null) continue;
      const cols = chart.data.colnames || [];
      const header = cols.map(c => c === '__timestamp' ? 'Date' : c);
      const rows = [header, ...chart.data.data.map(row =>
        cols.map(col => {
          const v = row[col];
          if (col === '__timestamp' && typeof v === 'number') return new Date(v).toISOString().slice(0, 10);
          return v == null ? '' : String(v);
        })
      )];
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
      saveAsCSV(rows, `ai-all-up-feature-${slug}-${timestamp}.csv`);
      console.log(`  ✓ ai-all-up-feature-${slug}-${timestamp}.csv (${rows.length - 1} rows × ${header.length} cols)`);
    }

    const loaded = Object.keys(featureResult.charts).join(' | ');
    console.log(`  ✓ Feature Split panels: ${loaded || '(none)'}`);

  } catch (e) {
    console.log(`  ⚠️  Feature Split tab error: ${e.message}`);
    ensureDebugDir();
    const debugPath = path.join('debug', `ai-all-up-feature-debug-${timestamp}.png`);
    await page.screenshot({ path: debugPath, fullPage: true }).catch(() => {});
    console.log(`  📸 Debug screenshot: ${debugPath}`);
  }

  // Save combined metrics CSV (updated with any Feature Split bignum additions)
  const metricsRows = [['Metric', 'Value'], ...Object.entries(metricsMap)];
  saveAsCSV(metricsRows, `ai-all-up-metrics-${timestamp}.csv`);
  console.log(`  ✓ ai-all-up-metrics-${timestamp}.csv (${metricsRows.length - 1} KPI metrics)`);

  console.log('\n✓ SharePoint AI All-Up done');
  return { metricsMap };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function scrapeAllDashboards() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║          Combined Dashboard Scraper                        ║');
  console.log('║          KAv2 + Competition + FAB + AI All-Up              ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  console.log(`Started: ${new Date().toLocaleString()}\n`);

  // ── Skip guard ──────────────────────────────────────────────────────────────
  if (shouldSkip()) {
    console.log('✅ Data is fresh — nothing to do.\n');
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);

  try {
    const { page } = await connectToEdge();

    // Establish Nezha session before scraping any dashboards
    const authOk = await ensureLoggedIn(page, KAV2_URL);
    if (!authOk) throw new Error('Nezha authentication failed. Manual login may be required.');

    // ── Dashboard 1: KAv2 ─────────────────────────────────────────────────────
    await scrapeKav2(page, timestamp);

    // ── Dashboard 2: Competition ──────────────────────────────────────────────
    await scrapeCompetition(page, timestamp);

    // ── Dashboard 3: FAB ─────────────────────────────────────────────────────
    let fabScraped = false;
    try {
      await scrapeFab(page, timestamp);
      fabScraped = true;
    } catch (fabErr) {
      console.error(`\n⚠️  FAB scraping failed (non-critical): ${fabErr.message}`);
      console.error('   Pipeline will continue without FAB data.');
    }

    // ── Dashboard 4: SharePoint AI All-Up ────────────────────────────────────
    let aiAllUpScraped = false;
    try {
      await scrapeAiAllUp(page, timestamp);
      aiAllUpScraped = true;
    } catch (aiErr) {
      console.error(`\n⚠️  SharePoint AI All-Up scraping failed (non-critical): ${aiErr.message}`);
      console.error('   Pipeline will continue without All-Up data.');
    }

    // ── Final screenshot ──────────────────────────────────────────────────────
    ensureDebugDir();
    const ssPath = path.join('debug', `dashboards-combined-${timestamp}.png`);
    await page.screenshot({ path: ssPath, fullPage: true, timeout: 60000 }).catch(() => {});

    // ── Summary ───────────────────────────────────────────────────────────────
    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));
    console.log('✓ KAv2 Executive Summary + Growth Analytics');
    console.log('✓ Copilot Extensibility (Competition)');
    console.log(fabScraped        ? '✓ FAB Dashboard'             : '⚠ FAB Dashboard (failed — see warnings above)');
    console.log(aiAllUpScraped    ? '✓ SharePoint AI All-Up'      : '⚠ SharePoint AI All-Up (failed — see warnings above)');
    console.log(`✓ Screenshot: ${ssPath}`);
    console.log('='.repeat(60));
    console.log(`\nCompleted: ${new Date().toLocaleString()}`);
    console.log('\n✅ All dashboards scraped successfully!\n');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    // Capture error screenshot to debug/
    try {
      const _browser = await chromium.connectOverCDP(CDP_URL).catch(() => null);
      if (_browser) {
        const _page = _browser.contexts()[0]?.pages()[0];
        if (_page) {
          ensureDebugDir();
          const errPath = path.join('debug', `error-debug-${timestamp}.png`);
          await _page.screenshot({ path: errPath, fullPage: true }).catch(() => {});
          console.error(`  📸 Debug screenshot: ${errPath}`);
        }
      }
    } catch {}
    process.exit(1);
  }
}

scrapeAllDashboards().then(() => process.exit(0));

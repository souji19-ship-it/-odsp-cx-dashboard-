'use strict';

/**
 * scrape-extensibility-api.js
 *
 * Fetches SharePoint Agents (SPO) metrics from the IDEAS CopilotExtensibilityDashboard
 * API — workloadId=10. Saves structured JSON to data/extensibility-api/latest.json
 * plus a timestamped archive copy.
 *
 * The API (called with customerSegment=All) may return multiple sections:
 *   - "All" section  → cell.value = WITH MSIT  (stored as withMsit)
 *   - "Commercial" section → cell.value = WITHOUT MSIT (stored as withoutMsit)
 * If only one section is returned, falls back to toolTipText.all / toolTipText.commercial.
 * Run with DEBUG_RAW=1 to log raw section names and tooltip fields for verification.
 *
 * Output schema (data/extensibility-api/latest.json):
 *   { scrapedAt, dataDate, spo: { avgDau, wau, mau, ... } }
 *   Each metric: { withMsit: number, withoutMsit: number, display: string }
 *
 * This scraper uses fetch() via page.evaluate() inside the already-authenticated
 * Edge session — no DOM scraping, pure API.
 */

const { connectToEdge } = require('./lib/cdp-connect');
const fs   = require('fs');
const path = require('path');

const CDP_URL     = process.env.CDP_URL || 'http://localhost:9223';
const DASHBOARD_URL = 'https://askideas.microsoft.net/dashboard/CopilotExtensibilityDashboard/copilotCommercial';
// Base API URL — `areaSummary` is set at request time (Exclude vs Include MSIT).
const API_BASE   = '/api/DashboardMetric/GetDashboardMetric?source=CopilotExtensibilityDashboard' +
                   '&customerSegment=All&area=All' +
                   '&isS500=All&parentAppType=All&appType=All&paymentStatus=All' +
                   '&ignoreCache=false&isCustomizedView=false';
const API_EXCLUDE = `${API_BASE}&areaSummary=Exclude`;  // commercial only (no MSIT internal)
const API_INCLUDE = `${API_BASE}&areaSummary=Include`;  // commercial + MSIT internal

const OUT_DIR  = path.join(__dirname, 'data', 'extensibility-api');
const OUT_FILE = path.join(OUT_DIR, 'latest.json');

// Minimum hours between fresh scrapes (skip if recent data exists)
const MIN_AGE_HOURS = parseFloat(process.env.MIN_SCRAPE_AGE_HOURS ?? '6');

// SPO column index in parentMetricDataCells (workloadId=10)
const SPO_COL = 8;

// Metric subCategory → output key mapping
const METRIC_MAP = {
  'Average DAU (Weekly)':            'avgDau',
  'Weekly Active Users (WAU)':       'wau',
  'Monthly Active Users (MAU)':      'mau',
  'DAU/MAU':                         'dauMau',
  'Extension-User Pairs (Weekly)':   'extensionUserPairs',
  'Daily Consumption Units':         'dailyConsumptionUnits',
  'Weekly Consumption Units':        'weeklyConsumptionUnits',
  'Monthly Consumption Units':       'monthlyConsumptionUnits',
  'Extensibility Responses (Weekly)':'extensibilityResponses',
  'Active Extensions (Weekly)':      'activeExtensions',
  'Responses per User per Week':     'responsesPerUser',
  'Average Days per Week Use':       'avgDaysPerWeek',
  'Extensibility Attach Rate (Weekly)': 'attachRate',
  '% Thumbs that are Down':          'thumbsDown',
  'Weekly Return Rate':              'returnRate',
  'Returning MAU':                   'returningMau',
  'New MAU':                         'newMau',
  'Resurrected MAU':                 'resurrectedMau',
  'Lapsed MAU':                      'lapsedMau',
};

// ── Freshness check ───────────────────────────────────────────────────────────

function isFresh() {
  if (process.env.FORCE === '1') return false;
  if (!fs.existsSync(OUT_FILE)) return false;
  try {
    const { scrapedAt } = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
    if (!scrapedAt) return false;
    const ageMs = Date.now() - new Date(scrapedAt).getTime();
    return ageMs < MIN_AGE_HOURS * 3600 * 1000;
  } catch { return false; }
}

// ── Parse API response ────────────────────────────────────────────────────────

function parseSection(rows, sectionLabel) {
  // Extract metric values from one section of the API response.
  // cell.value is the raw number; cell.valueString is the formatted display string.
  const out = {};
  let dataDate = null;

  for (const row of rows) {
    if (row.isHeader) continue;

    const key = METRIC_MAP[row.metricSubCategory];
    if (!key) continue;

    const cells = row.parentMetricDataCells || [];
    if (SPO_COL >= cells.length) continue;

    const cell = cells[SPO_COL];
    if (!cell) continue;

    // Use cell.value (raw number) preferring it over parsing the formatted string
    const val     = (typeof cell.value === 'number') ? cell.value
                  : parseFloat(String(cell.value ?? '').replace(/[,%]/g, '')) || null;
    const display = cell.valueString || String(cell.value ?? '');

    // Log tooltip fields to help verify MSIT mapping when DEBUG_RAW is set
    if (process.env.DEBUG_RAW && key === 'avgDau') {
      const tt = cell.toolTipText || {};
      console.log(`  [${sectionLabel}] avgDau cell.value=${cell.value} display="${display}"`);
      console.log(`  [${sectionLabel}] avgDau tt keys: ${JSON.stringify(Object.keys(tt))}`);
      console.log(`  [${sectionLabel}] avgDau tt:      ${JSON.stringify(tt)}`);
    }

    out[key] = { value: val, display };
    if (!dataDate && cell.hoverText) dataDate = cell.hoverText.slice(0, 10);
  }

  return { metrics: out, dataDate };
}

function parseResponse(data) {
  // The API returns 3 sections: Current / MoM / YoY (time comparisons).
  // All headline values live in section[0] ("Current"). Take cell.value (raw number)
  // for the SPO column. The MSIT inclusion is controlled at the URL level via
  // areaSummary=Include/Exclude — we make two requests and merge them in main().
  const sections = Array.isArray(data) ? data : [data];
  if (!sections.length || !sections[0]?.metricDataRows) throw new Error('Unexpected API response shape');

  const section = sections[0];
  const out = {};
  let dataDate = null;

  for (const row of section.metricDataRows) {
    if (row.isHeader) continue;
    const key = METRIC_MAP[row.metricSubCategory];
    if (!key) continue;
    const cell = (row.parentMetricDataCells || [])[SPO_COL];
    if (!cell) continue;

    const val = (typeof cell.value === 'number') ? cell.value
              : parseFloat(String(cell.value ?? '').replace(/[,%]/g, '')) || null;
    out[key] = { value: val, display: cell.valueString || String(cell.value ?? '') };

    if (!dataDate && cell.hoverText) dataDate = cell.hoverText.slice(0, 10);
  }

  return { metrics: out, dataDate };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (isFresh()) {
    const { scrapedAt, dataDate } = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
    console.log(`✓ Extensibility API data is fresh (scraped ${scrapedAt}, dataDate ${dataDate}) — skipping`);
    return;
  }

  console.log('Connecting to Edge...');
  const { browser, context } = await connectToEdge();

  // Prefer an existing tab already on the IDEAS domain — it has live auth cookies.
  // Fall back to opening a new page and navigating (requires a fresh login to have happened recently).
  const existingPage = context.pages().find(p => p.url().includes('askideas.microsoft.net'));
  const page = existingPage || await context.newPage();
  const openedNewPage = !existingPage;

  if (existingPage) {
    console.log(`Found existing IDEAS tab: ${existingPage.url()}`);
  } else {
    console.log('No existing IDEAS tab — opening new page.');
  }

  // Silently dismiss any browser dialogs (alert/confirm/prompt) the page may fire.
  // Without this handler, Playwright's internal DialogManager auto-dismisses dialogs and can
  // throw "ProtocolError: No dialog is showing" as an unhandled rejection when there's a
  // race between the dialog closing and the dismiss protocol command arriving.
  page.on('dialog', async dialog => {
    try { await dialog.dismiss(); } catch {}
  });

  try {
    // ── STEP 1: Navigate once to authenticate. While here, capture the bearer
    // token from one outbound GetDashboardMetric request — we'll replay it.
    let bearerToken = null;
    const API_PATTERN = '**/GetDashboardMetric**';
    await page.route(API_PATTERN, async route => {
      const h = route.request().headers();
      if (h.authorization && !bearerToken) bearerToken = h.authorization;
      await route.continue();
    });

    console.log('Navigating to CopilotExtensibilityDashboard to prime auth...');
    await page.goto(DASHBOARD_URL, { waitUntil: 'networkidle', timeout: 90000 });
    await page.waitForTimeout(2000);
    await page.unroute(API_PATTERN);

    if (!bearerToken) throw new Error('Could not capture bearer token from page — auth may have failed');
    console.log(`  ✓ Captured auth token (…${bearerToken.slice(-12)})`);

    // ── STEP 2: Fetch both Exclude and Include variants directly from inside
    // the page (cookies + bearer token = guaranteed auth). Deterministic — no
    // UI clicking, no race conditions.
    console.log('Fetching Exclude-MSIT and Include-MSIT in parallel...');
    const [excludeData, includeData] = await page.evaluate(async ([excludeUrl, includeUrl, auth]) => {
      const fetchOne = async (url) => {
        const r = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json', Authorization: auth } });
        if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
        return r.json();
      };
      return Promise.all([fetchOne(excludeUrl), fetchOne(includeUrl)]);
    }, [API_EXCLUDE, API_INCLUDE, bearerToken]);

    console.log('  ✓ Both responses received');

    if (process.env.DEBUG_RAW) {
      fs.writeFileSync(path.join(OUT_DIR, 'raw-exclude-msit.json'), JSON.stringify(excludeData, null, 2));
      fs.writeFileSync(path.join(OUT_DIR, 'raw-include-msit.json'), JSON.stringify(includeData, null, 2));
      console.log('  DEBUG: saved raw-exclude-msit.json + raw-include-msit.json');
    }

    // ── Parse + merge ──────────────────────────────────────────────────────────
    const { metrics: excMetrics, dataDate: ddExc } = parseResponse(excludeData);
    const { metrics: incMetrics, dataDate: ddInc } = parseResponse(includeData);
    const dataDate = ddInc || ddExc;

    const spo = {};
    const allKeys = new Set([...Object.keys(excMetrics), ...Object.keys(incMetrics)]);
    for (const key of allKeys) {
      const inc = incMetrics[key] || {};
      const exc = excMetrics[key] || {};
      spo[key] = {
        withMsit:    inc.value ?? null,   // Include = commercial + MSIT internal
        withoutMsit: exc.value ?? null,   // Exclude = commercial only
        display:     inc.display || exc.display || '',
      };
    }

    const result = {
      scrapedAt: new Date().toISOString(),
      dataDate,
      source: 'CopilotExtensibilityDashboard (workloadId=10 / SharePoint Agents SPO)',
      spo,
    };

    // Validate we got the key metrics
    const requiredKeys = ['avgDau', 'wau', 'mau'];
    for (const k of requiredKeys) {
      if (!spo[k]?.withMsit) {
        throw new Error(`Missing required metric '${k}' in response — check SPO column index`);
      }
    }

    // Write output
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(OUT_FILE, JSON.stringify(result, null, 2));

    // Timestamped archive copy
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    fs.writeFileSync(path.join(OUT_DIR, `snapshot-${ts}.json`), JSON.stringify(result, null, 2));

    console.log(`✅ Extensibility API scraped (dataDate: ${dataDate})`);
    console.log(`   SPO Avg DAU:  ${spo.avgDau?.withMsit?.toLocaleString()} (with MSIT) / ${spo.avgDau?.withoutMsit?.toLocaleString()} (without)`);
    console.log(`   SPO WAU:      ${spo.wau?.withMsit?.toLocaleString()} (with MSIT) / ${spo.wau?.withoutMsit?.toLocaleString()} (without)`);
    console.log(`   SPO MAU:      ${spo.mau?.withMsit?.toLocaleString()} (with MSIT) / ${spo.mau?.withoutMsit?.toLocaleString()} (without)`);
    console.log(`   Ext. Resp/wk: ${spo.extensibilityResponses?.withMsit?.toLocaleString()}`);
    console.log(`   Active Ext:   ${spo.activeExtensions?.withMsit?.toLocaleString()}`);
    console.log(`   Return Rate:  ${spo.returnRate?.withMsit}%`);

  } finally {
    if (openedNewPage) await page.close().catch(() => {});
  }
}

// connectToEdge() keeps a CDP socket open which prevents Node from exiting.
// Force exit on success so scrape-all.js's orchestrator doesn't stall.
main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ scrape-extensibility-api.js failed:', err.message);
    process.exit(1);
  });

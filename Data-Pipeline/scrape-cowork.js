/**
 * SPAW CoWork Data Scraper
 * Fetches CoWork dashboard data via CDP (uses Edge with corp cookies)
 * Saves to Data-Public/cowork/ (canonical — read by the dashboards + drift check)
 *
 * Usage: node scrape-cowork.js
 * Prerequisite: Edge running with --remote-debugging-port=9222 (or 9223)
 *
 * Self-healing auth: before fetching, it WARMS UP by loading the dashboard SPA (which makes Edge
 * silently renew the corp session); it also retries once on 401/403. So it runs unattended with no
 * manual re-auth while the corp refresh token / device SSO is valid. Only a hard corp re-auth (rare)
 * needs an interactive sign-in, which it flags via needsInteractiveAuth in _scrape-meta.json.
 */

const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://ai-insight-dashboard.braveglacier-08057dd1.westus2.azurecontainerapps.io/_internal/dashboard/wqr-reporting/CoworkDash/CoworkKusto/data';
const OUTPUT_DIR = path.join(__dirname, '..', 'Data-Public', 'cowork');

const ENDPOINTS = [
  'tools.json',
  'summary.json',
  'ServersideFunnel.json',
  '_manifest.json',
];

const ORIGIN = new URL(BASE_URL).origin;
// Loading these dashboard SPA pages makes Edge silently renew the auth cookie using the still-valid
// corp refresh token / device SSO. The data API is fetched directly and never triggers that renewal
// on its own, so a direct fetch 401s once the short-lived cookie lapses. Warming up first keeps the
// scraper independent of any interactive sign-in while the refresh token is valid.
const WARMUP_URLS = [ORIGIN + '/', BASE_URL.replace('/_internal', '').replace('/CoworkKusto/data', '')];
let authInteractiveNeeded = false;

async function warmUpAuth(page) {
  for (const u of WARMUP_URLS) {
    try {
      await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2500); // let the SPA acquire/renew the token
      if (/login\.microsoftonline|\/\.auth\/login|\/signin/i.test(page.url())) authInteractiveNeeded = true;
    } catch (e) { /* a failed warm-up just means the retry/report path handles it */ }
  }
}

// page.goto with a silent session-renewal (load the dashboard) + one retry when the API answers 401/403.
async function fetchWithAuth(page, url) {
  let r = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  if (r && (r.status() === 401 || r.status() === 403)) {
    console.error(`  \u21bb HTTP ${r.status()} - renewing session (loading dashboard) then retrying`);
    await warmUpAuth(page);
    r = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (r && (r.status() === 401 || r.status() === 403)) authInteractiveNeeded = true;
  }
  return r;
}

// Pick the latest available date (ISO yyyy-mm-dd) from a CoWork manifest. Robust to missing/empty
// arrays and unsorted input; returns null when no date is available (caller decides what to do).
function pickLatestDate(manifest, view) {
  if (!manifest || typeof manifest !== 'object') return null;
  const weekly = Array.isArray(manifest.weekly_dates) ? manifest.weekly_dates : [];
  const daily = Array.isArray(manifest.dates) ? manifest.dates : [];
  const pool = (view === 'weekly' && weekly.length) ? weekly : (daily.length ? daily : weekly);
  if (!pool.length) return null;
  return pool.filter(Boolean).slice().sort().pop() || null;
}

async function main() {
  // Date: if omitted, derived from the live _manifest below (latest available — not UTC "today")
  const dateOverride = process.argv[2];
  let date = dateOverride;
  const view = process.argv[3] || 'weekly';

  console.log(`[SPAW CoWork Scraper] View: ${view}` + (date ? `, Date: ${date} (override)` : ', Date: auto (latest from manifest)'));
  console.log(`[SPAW CoWork Scraper] Output: ${OUTPUT_DIR}`);

  // Ensure output directory exists
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Connect to Edge via CDP (lazy-require so the module is importable/testable without node_modules)
  const { chromium } = require('playwright');
  let browser;
  const ports = [9222, 9223];
  for (const port of ports) {
    try {
      browser = await chromium.connectOverCDP(`http://localhost:${port}`);
      console.log(`[CDP] Connected to Edge on port ${port}`);
      break;
    } catch (e) { /* try the next port */ }
  }
  if (!browser) {
    console.error(`[CDP] Failed to connect on ports ${ports.join('/')}. Launch Edge (signed in to the dashboard) with:`);
    console.error('  Data-Pipeline\\launch-edge-debug.bat   (opens Edge with --remote-debugging-port=9222, your signed-in profile)');
    process.exit(1);
  }

  const context = browser.contexts()[0];
  const page = await context.newPage();

  // Renew the session up front by loading the dashboard SPA, so the direct data-API fetches below
  // succeed with no interactive sign-in (independent of the user while corp SSO is valid).
  await warmUpAuth(page);

  // Determine the date from the live manifest (latest AVAILABLE date — never UTC "today"/"tomorrow",
  // which has no data yet and would just 404). Fall back to the latest date in the on-disk manifest
  // (the last good data we already hold); if neither yields a date, skip cleanly without clobbering.
  if (!date) {
    let liveManifest = null;
    try {
      const mResp = await fetchWithAuth(page, `${BASE_URL}/_manifest.json?t=${Date.now()}`);
      if (mResp && mResp.status() === 200) {
        liveManifest = JSON.parse(await mResp.text());
      } else {
        console.error(`[Date] Live manifest returned HTTP ${mResp ? mResp.status() : 'no-response'}`);
      }
    } catch (e) {
      console.error(`[Date] Live manifest lookup failed: ${e.message}`);
    }

    date = pickLatestDate(liveManifest, view);
    if (date) {
      console.log(`[Date] Latest ${view} date from live manifest: ${date}`);
    } else {
      // Fall back to the latest date in the on-disk manifest we already downloaded.
      try {
        const disk = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, '_manifest.json'), 'utf8'));
        date = pickLatestDate(disk, view);
        if (date) console.error(`[Date] Live manifest unavailable — using latest on-disk date: ${date}`);
      } catch (e) { /* no usable on-disk manifest */ }
    }

    if (!date) {
      console.error('[Date] Could not determine a valid date from the live or on-disk manifest — skipping scrape (existing data left untouched).');
      fs.writeFileSync(path.join(OUTPUT_DIR, '_scrape-meta.json'), JSON.stringify({
        scrapedAt: new Date().toISOString(), view, source: BASE_URL,
        fetched: 0, failed: 0, skipped: true, reason: 'no-valid-date',
      }, null, 2));
      await page.close();
      await browser.close().catch(() => {});
      process.exit(0);
    }
  }

  // Freshness guard (auto dates only): never overwrite newer data with older. If we've already scraped
  // a date >= the one we just chose, the latest data is already on disk — refresh in place is harmless,
  // but an OLDER chosen date means the source regressed, so skip to protect the good data.
  if (!dateOverride) {
    try {
      const prevMeta = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, '_scrape-meta.json'), 'utf8'));
      if (prevMeta && prevMeta.date && date < prevMeta.date) {
        console.error(`[Guard] Chosen date ${date} is older than last scraped ${prevMeta.date} — skipping (no clobber).`);
        await page.close();
        await browser.close().catch(() => {});
        process.exit(0);
      }
    } catch (e) { /* no prior meta — proceed */ }
  }

  let fetched = 0;
  let failed = 0;

  for (const endpoint of ENDPOINTS) {
    // _manifest.json doesn't need date/view in path
    const url = endpoint === '_manifest.json'
      ? `${BASE_URL}/${endpoint}?t=${Date.now()}`
      : `${BASE_URL}/${date}/${view}/${endpoint}`;

    console.log(`[Fetch] ${endpoint}...`);
    try {
      const response = await fetchWithAuth(page, url);

      if (response.status() !== 200) {
        console.error(`  ❌ HTTP ${response.status()}`);
        failed++;
        continue;
      }

      const body = await response.body();
      const outPath = path.join(OUTPUT_DIR, endpoint);
      fs.writeFileSync(outPath, body);
      const sizeMB = (body.length / 1024 / 1024).toFixed(2);
      console.log(`  ✅ Saved (${sizeMB} MB)`);
      fetched++;
    } catch (e) {
      console.error(`  ❌ ${e.message}`);
      failed++;
    }
  }

  // Also save metadata
  const meta = {
    scrapedAt: new Date().toISOString(),
    date,
    view,
    source: BASE_URL,
    fetched,
    failed,
    needsInteractiveAuth: authInteractiveNeeded,
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, '_scrape-meta.json'), JSON.stringify(meta, null, 2));

  await page.close();
  console.log(`\n[Done] ${fetched} fetched, ${failed} failed. Data in: ${OUTPUT_DIR}`);
  if (authInteractiveNeeded && fetched === 0) {
    console.error('[Auth] Still 401/403 after a silent session renewal - this is the rare case that needs an interactive corp sign-in. Open the dashboard in the MSFTReportingEdge debug Edge, sign in, then re-run. (Everyday refreshes do not need this.)');
  }
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}

module.exports = { pickLatestDate };

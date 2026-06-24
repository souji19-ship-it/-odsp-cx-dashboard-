'use strict';

/**
 * scrape-skills-adx.js
 *
 * Scrapes the "KA Skills" Azure Data Explorer dashboard.
 * Intercepts v2/rest/query calls to odxaugloop.eastus.kusto.windows.net,
 * correlates responses to tiles via the sourceId in request_description,
 * and saves them to data/skills-adx/.
 *
 * Tiles captured (usage-only — no reliability data):
 *   Skill Adoption            — pie: With/Without Skills (snapshot)
 *   Skill Count Distribution  — pie: 1-2 / 3-5 / 6-10 / 11+ skills (snapshot)
 *   OOB Loaded Pct            — pie: OOB skills loaded vs not (snapshot)
 *   OOB Overrides Per Day     — bar/timeseries by day (timeseries)
 *   Prompt Classification     — table: MainCategory / SubCategory / PromptCount (snapshot)
 *   Execute Tools             — table: Tool / ToolCalls (snapshot)
 *   Ask Tools                 — table: Tool / ToolCalls (snapshot)
 *   Learn Tools               — table: Tool / ToolCalls (snapshot)
 *   Create Tools              — table: Tool / ToolCalls (snapshot)
 *   CatchUp Tools             — table: Tool / ToolCalls (snapshot)
 *   Chat Tools                — table: Tool / ToolCalls (snapshot)
 *
 * Usage:
 *   node scrape-skills-adx.js
 *   MIN_SCRAPE_AGE_HOURS=0 node scrape-skills-adx.js   # force re-scrape
 */

const { connectToEdge } = require('./lib/cdp-connect');
const store = require('./lib/data-store');

const DASHBOARD_URL =
  'https://dataexplorer.azure.com/dashboards/7d0f6d73-3317-4cca-ba6f-45b3154cb1bf' +
  '?p-_startTime=7days&p-_endTime=now&p-_clientReleaseAudienceGroup=v-Production' +
  '#38af566c-c1bf-49f3-9fea-570d5cad8650';

const TAB_PATH = 'skills-adx';
const MIN_SCRAPE_AGE_HOURS = parseInt(process.env.MIN_SCRAPE_AGE_HOURS || '6');

// tileId (from dashboard def) → storage config
// isTimeseries: true if the KQL result has a time axis (use upsertTimeseries)
const TARGET_TILES = {
  'a0cf368d-b3d5-41ce-a6fe-53464f8ba219': { title: 'Skill Adoption',           isTimeseries: false },
  'f8192b8c-9431-4088-8104-4e7e2cbb7bf6': { title: 'Skill Count Distribution',  isTimeseries: false },
  'dc6e8f6b-4f71-49f2-9ddd-2de299c9a723': { title: 'OOB Loaded Pct',            isTimeseries: false },
  '8ddb9de4-8f54-48af-aaf1-bdff656e98e5': { title: 'OOB Overrides Per Day',     isTimeseries: true,  timeCol: 'TIMESTAMP' },
  '9b11aca3-c9e8-452c-abd8-8807160c4ac7': { title: 'Prompt Classification',     isTimeseries: false },
  '86f921eb-0e09-47e5-ab8b-af5cd991436b': { title: 'Execute Tools',             isTimeseries: false },
  'a6aede99-05cc-4918-aba1-8c94b9299195': { title: 'Ask Tools',                 isTimeseries: false },
  'e9dd9eaa-f336-4dc7-be5f-74043329433e': { title: 'Learn Tools',               isTimeseries: false },
  '3d926bd3-ce4c-4d14-932a-ec7cdd6851a1': { title: 'Create Tools',              isTimeseries: false },
  '46deb2f0-78d3-45d3-a388-e8338e178b98': { title: 'CatchUp Tools',             isTimeseries: false },
  'a44cdc11-7f41-47f7-b425-df58a8f2434a': { title: 'Chat Tools',                isTimeseries: false },
};

const TARGET_COUNT = Object.keys(TARGET_TILES).length;

// ── v2 Kusto REST response parser ─────────────────────────────────────────────

/**
 * Extract the PrimaryResult table from a v2/rest/query response.
 * The response is an array of frames; we want the one with TableKind=PrimaryResult.
 * Rows are positional arrays — we zip them with Columns to produce objects.
 *
 * @returns {{ colnames: string[], rows: object[] } | null}
 */
function parseKustoV2(frames) {
  if (!Array.isArray(frames)) return null;
  for (const frame of frames) {
    if (frame.FrameType === 'DataTable' && frame.TableKind === 'PrimaryResult') {
      const colnames = (frame.Columns ?? []).map(c => c.ColumnName);
      const rows = (frame.Rows ?? []).map(row =>
        Object.fromEntries(colnames.map((c, i) => [c, row[i] ?? null]))
      );
      return { colnames, rows };
    }
  }
  return null;
}

// ── Scroll helper ─────────────────────────────────────────────────────────────

async function scrollTilesContainer(page) {
  await page.evaluate(async () => {
    // ADX dashboard scrolls inside a tiles container, not window
    const container =
      document.querySelector('.oQU51G_tiles') ||
      document.querySelector('[class*="_tiles"]') ||
      document.scrollingElement;
    if (!container) return;

    const total = container.scrollHeight;
    const steps = [0, 0.12, 0.25, 0.38, 0.50, 0.62, 0.75, 0.88, 1.0, 0];
    for (const f of steps) {
      container.scrollTop = total * f;
      await new Promise(r => setTimeout(r, 900));
    }
  }).catch(() => {});
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║           KA Skills ADX Dashboard Scraper                  ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  console.log(`Started: ${new Date().toLocaleString()}\n`);

  try {
    if (!store.shouldScrape(TAB_PATH, MIN_SCRAPE_AGE_HOURS)) {
      const last = store.getLastScrapeTime(TAB_PATH);
      const ageH = ((Date.now() - last.getTime()) / 3_600_000).toFixed(1);
      console.log(`↷ Skipping — scraped ${last.toLocaleString()} (${ageH}h ago). Pass MIN_SCRAPE_AGE_HOURS=0 to force.`);
      console.log('✅ Done\n');
      return;
    }

    const { page } = await connectToEdge();

    // ── Set up route interception ────────────────────────────────────────────
    const captured = {}; // tileId → { colnames, rows }

    const routeHandler = async (route, request) => {
      let response;
      try {
        response = await route.fetch();
      } catch {
        await route.continue().catch(() => {});
        return;
      }

      let frames = null;
      try { frames = await response.json(); } catch {}

      if (frames) {
        // Extract sourceId from request_description
        let tileId = null;
        try {
          const rb = request.postDataJSON();
          const desc = rb?.properties?.Options?.request_description ?? '';
          const m = desc.match(/sourceId:([a-f0-9-]{36})/);
          if (m) tileId = m[1];
        } catch {}

        if (tileId && TARGET_TILES[tileId] && !captured[tileId]) {
          const result = parseKustoV2(frames);
          if (result) {
            captured[tileId] = result;
            const title = TARGET_TILES[tileId].title;
            const count = Object.keys(captured).length;
            console.log(`  📡 [${count}/${TARGET_COUNT}] "${title}" — ${result.rows.length} rows`);
          }
        }
      }

      await route.fulfill({ response }).catch(() => {});
    };

    const PATTERN = '**/v2/rest/query**';
    await page.route(PATTERN, routeHandler);

    try {
      // ── Navigate ───────────────────────────────────────────────────────────
      console.log('── Loading dashboard ───────────────────────────────────────');
      await page.bringToFront().catch(() => {});
      await page.goto(DASHBOARD_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(5000);

      // Dismiss VPN info dialog if it appears
      await page.click('button:has-text("Approve and Continue")', { timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(1000);

      // Click Refresh to bust the 30-min ADX result cache and re-run all queries
      // (ADX caches tile query results for 30 minutes; without this, recently-viewed
      //  tiles return cached results that arrive before our route handler fires)
      const refreshed = await page.click('button:has-text("Refresh")', { timeout: 5000 })
        .then(() => true).catch(() => false);
      if (refreshed) {
        console.log('  ↺ Clicked Refresh to bust 30-min ADX tile cache');
        await page.waitForTimeout(2000);
      }

      // ── Scroll + settle loop ───────────────────────────────────────────────
      console.log('\n── Waiting for tile queries ────────────────────────────────');
      const start    = Date.now();
      const timeout  = 150_000;
      const settleMs = 12_000;
      let quietMs    = 0;
      let lastCount  = 0;
      const poll     = 2_000;

      while (Date.now() - start < timeout) {
        await page.waitForTimeout(poll);

        const current = Object.keys(captured).length;

        if (current === TARGET_COUNT) {
          console.log(`  ✓ All ${TARGET_COUNT} target tiles captured`);
          break;
        }

        if (current === lastCount && current > 0) {
          quietMs += poll;
          if (quietMs >= settleMs) {
            console.log(`  ✓ Settled with ${current}/${TARGET_COUNT} tiles captured`);
            break;
          }
        } else {
          quietMs = 0;
          lastCount = current;
        }

        // Keep scrolling to expose viewport-hidden tiles
        if (Date.now() - start > 4_000) {
          await scrollTilesContainer(page).catch(() => {});
        }
      }

      // ── Report missing ─────────────────────────────────────────────────────
      const missing = Object.entries(TARGET_TILES)
        .filter(([id]) => !captured[id])
        .map(([, cfg]) => cfg.title);
      if (missing.length) {
        console.log(`  ⚠  Missing: ${missing.join(', ')}`);
      }

      if (Object.keys(captured).length === 0) {
        throw new Error('No tile data captured — check ADX auth or page structure');
      }

      // ── Persist data ───────────────────────────────────────────────────────
      console.log('\n── Saving data ─────────────────────────────────────────────');
      let tsAdded = 0, tsUpdated = 0, snapAdded = 0;

      for (const [tileId, { colnames, rows }] of Object.entries(captured)) {
        const cfg = TARGET_TILES[tileId];
        if (!cfg) continue;

        if (rows.length === 0) {
          console.log(`  ⊘ "${cfg.title}" — 0 rows (no data yet)`);
          // Still record an empty snapshot so we have a dated entry
          store.appendSnapshot(TAB_PATH, cfg.title, colnames, []);
          continue;
        }

        if (cfg.isTimeseries) {
          const s = store.upsertTimeseries(TAB_PATH, cfg.title, colnames, rows, cfg.timeCol);
          tsAdded += s.added; tsUpdated += s.updated;
          console.log(`  ✓ "${cfg.title}" — ${s.added} new rows, ${s.updated} updated`);
        } else {
          const s = store.appendSnapshot(TAB_PATH, cfg.title, colnames, rows);
          snapAdded += s.added;
          console.log(`  ✓ "${cfg.title}" — ${s.added} snapshot rows`);
        }
      }

      store.recordScrapeTime(TAB_PATH, {
        tiles_captured:      Object.keys(captured).length,
        timeseries_added:    tsAdded,
        timeseries_updated:  tsUpdated,
        snapshot_rows_added: snapAdded,
      });

      console.log(`\n  💾 +${tsAdded} timeseries rows, ~${tsUpdated} updated | +${snapAdded} snapshot rows`);

    } finally {
      await page.unroute(PATTERN, routeHandler).catch(() => {});
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

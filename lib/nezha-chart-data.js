'use strict';

/**
 * nezha-chart-data.js
 *
 * Captures Superset chart data by routing (intercepting) API calls as the
 * dashboard loads, then correlating the captured payloads with chart titles
 * extracted from the DOM.
 *
 * Why routing instead of DOM scraping:
 *   DOM scraping only gets the *rendered* summary (e.g. "11.8k").
 *   Routing gives us the full underlying dataset — every row of every
 *   timeseries — so we can track trends, not just today's number.
 *
 * Superset chart data endpoints (Nezha mounts Superset at /nezha/):
 *   POST /nezha/api/v1/chart/data          — new-style (Superset >= 1.4)
 *   GET  /nezha/api/v1/chart/<id>/data/    — per-chart cache hit variant
 *   POST /nezha/superset/explore_json/     — legacy fallback
 */

/**
 * Navigate to a Superset dashboard, intercept all chart data API calls, and
 * return the full dataset for every chart on the page.
 *
 * @param {import('playwright').Page} page  - Playwright page (already connected to Edge via CDP)
 * @param {string} dashboardUrl             - Full dashboard URL
 * @param {object} [options]
 * @param {Function} [options.onLoaded]     - async (page) => {} called after navigation settles;
 *                                           use to click a tab before waiting for data
 * @param {number} [options.settleMs]       - ms with no new API responses before we consider done (default 12000)
 * @param {number} [options.timeout]        - hard timeout for the whole capture (default 120000)
 * @returns {Promise<CaptureResult>}
 */
async function captureDashboardCharts(page, dashboardUrl, options = {}) {
  const { onLoaded = null, settleMs = 12000, timeout = 120000, blankFirst = false } = options;

  // Navigate to blank before the target URL to discard Superset's in-memory
  // Redux chart cache — otherwise React Router serves cached chart data without
  // making API calls, leaving those charts invisible to the route interceptor.
  if (blankFirst) {
    await page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
  }

  const captured = []; // { url, requestBody, responseData, ts }

  // --- Route handler: intercept Superset chart data requests -----------------
  // Use route.fetch() so we get the actual response body AND still pass it
  // through to the page unchanged.
  const routeHandler = async (route, request) => {
    let response;
    try {
      response = await route.fetch();
    } catch {
      // If fetch itself fails, let the browser handle it normally
      await route.continue().catch(() => {});
      return;
    }

    // Try to read as JSON — ignore binary/non-JSON responses
    let responseData = null;
    try {
      responseData = await response.json();
    } catch {}

    if (responseData) {
      let requestBody = null;
      try { requestBody = request.postDataJSON(); } catch {}

      captured.push({
        url: request.url(),
        requestBody,
        responseData,
        ts: Date.now(),
      });
    }

    // Always pass the response through to the page
    await route.fulfill({ response }).catch(() => {});
  };

  // Register intercept patterns — Superset is at /nezha/ on this host
  const patterns = [
    '**/api/v1/chart/data**',
    '**/api/v1/chart/*/data**',
    '**/superset/explore_json**',
    '**/api/v1/explore/**',
  ];
  for (const p of patterns) await page.route(p, routeHandler);

  try {
    // ── Navigate ──────────────────────────────────────────────────────────────
    await page.bringToFront().catch(() => {});
    try {
      await page.goto(dashboardUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    } catch (navErr) {
      // Superset SPA intercepts re-navigation to the same URL and aborts it;
      // the page stays functional. Fall back to reload() when already on-site.
      if (navErr.message.includes('ERR_ABORTED') && page.url().includes(new URL(dashboardUrl).hostname)) {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
      } else {
        throw navErr;
      }
    }
    await page.waitForLoadState('load', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000); // let SPFx/React settle

    // ── Post-load hook (e.g. click a tab) ────────────────────────────────────
    if (onLoaded) await onLoaded(page);

    // ── Scroll to trigger lazy-loaded charts ─────────────────────────────────
    await scrollToTriggerLazyLoad(page);

    // ── Wait until no new API responses for settleMs ─────────────────────────
    const start = Date.now();
    let lastCount = 0;
    let quietMs = 0;
    const poll = 2000;

    while (Date.now() - start < timeout) {
      await page.waitForTimeout(poll);

      const current = captured.length;
      if (current === lastCount && current > 0) {
        quietMs += poll;
        if (quietMs >= settleMs) {
          console.log(`  ✓ Chart data settled (${current} responses captured)`);
          break;
        }
      } else {
        quietMs = 0;
        if (current > lastCount) {
          const elapsed = Math.round((Date.now() - start) / 1000);
          console.log(`  📡 [${elapsed}s] ${current} chart response(s) captured...`);
        }
        lastCount = current;
      }

      // Keep scrolling to ensure viewport-hidden charts load
      if (Date.now() - start > 8000) {
        await scrollToTriggerLazyLoad(page).catch(() => {});
      }
    }

    if (captured.length === 0) {
      console.log('  ⚠️  No chart API responses captured — check URL or auth');
    }

    // ── Collect DOM metadata (titles, displayed values, chart types) ──────────
    const domCharts = await getDomChartMeta(page);
    console.log(`  📊 DOM: ${domCharts.length} chart panel(s) found`);

    // ── Correlate API responses with chart titles ─────────────────────────────
    return buildResult(domCharts, captured, dashboardUrl);

  } finally {
    for (const p of patterns) await page.unroute(p, routeHandler).catch(() => {});
  }
}

// ── Scroll helper ─────────────────────────────────────────────────────────────

async function scrollToTriggerLazyLoad(page) {
  const steps = [0.25, 0.5, 0.75, 1.0, 0];
  for (const frac of steps) {
    await page.evaluate(f => window.scrollTo(0, document.body.scrollHeight * f), frac).catch(() => {});
    await page.waitForTimeout(600);
  }
}

// ── DOM metadata extraction ───────────────────────────────────────────────────

/**
 * Walk the Superset chart panels in the DOM and collect metadata.
 * Returns array of { sliceId, title, displayedValue, displayedSubtitle, chartType }
 */
async function getDomChartMeta(page) {
  return await page.evaluate(() => {
    const charts = [];

    document.querySelectorAll('.chart-slice').forEach(slice => {
      // Superset renders: data-test-chart-id, data-test-chart-name, data-test-viz-type
      const sliceId = slice.getAttribute('data-test-chart-id') || null;

      const title = (
        slice.getAttribute('data-test-chart-name') ||
        slice.querySelector('.header-title, .chart-header .title, [class*="title"]')
          ?.textContent?.trim() || ''
      );

      let displayedValue = null;
      let displayedSubtitle = null;
      // data-test-viz-type is the most reliable source (set by Superset's React renderer)
      let chartType = slice.getAttribute('data-test-viz-type') || 'unknown';

      // ── Big Number / Big Number with Trendline ────────────────────────────
      // Covers both legacy (.superset-legacy-chart-big-number) and ECharts-based
      // (.superset-chart-big-number) bignum variants used in different Superset versions.
      const bigNum = slice.querySelector(
        '.superset-legacy-chart-big-number, .superset-chart-big-number'
      );
      if (bigNum) {
        if (chartType === 'unknown') chartType = 'big_number';
        displayedValue = bigNum.querySelector('.header-line, .big-number, .number')
          ?.textContent?.trim() ?? null;
        displayedSubtitle = bigNum.querySelector('.subheader-line, .subheader')
          ?.textContent?.trim() ?? null;
      }

      // ── ECharts (newer Superset: echarts-based charts other than bignum) ──
      if (!bigNum) {
        const echartsEl = slice.querySelector('[_echarts_instance_]');
        if (echartsEl) chartType = 'echarts';
      }

      // ── Table ─────────────────────────────────────────────────────────────
      const tableEl = slice.querySelector('table');
      if (tableEl && chartType === 'unknown') chartType = 'table';

      // ── SVG-based charts (pie, funnel, Sankey, etc.) ──────────────────────
      const svgEl = slice.querySelector('svg');
      if (svgEl && chartType === 'unknown') {
        chartType = 'svg_chart';
        // Grab SVG text labels as a convenience preview
        const labels = Array.from(svgEl.querySelectorAll('text'))
          .map(t => t.textContent.trim()).filter(Boolean);
        if (labels.length) displayedSubtitle = labels.slice(0, 10).join(' | ');
      }

      // ── Bar / Line charts rendered as canvas ─────────────────────────────
      const canvasEl = slice.querySelector('canvas');
      if (canvasEl && chartType === 'unknown') chartType = 'canvas_chart';

      if (title || sliceId) {
        charts.push({ sliceId, title, displayedValue, displayedSubtitle, chartType });
      }
    });

    return charts;
  });
}

// ── Result builder ────────────────────────────────────────────────────────────

/**
 * Correlate captured API responses with DOM chart metadata.
 * Returns a structured CaptureResult object.
 *
 * @typedef {{ sliceId: string|null, title: string, chartType: string,
 *             displayedValue: string|null, displayedSubtitle: string|null,
 *             data: object|null }} ChartEntry
 * @typedef {{ dashboardUrl: string, capturedAt: string,
 *             charts: Object.<string,ChartEntry>, uncorrelated: ChartEntry[] }} CaptureResult
 */
function buildResult(domCharts, captured, dashboardUrl) {
  const result = {
    dashboardUrl,
    capturedAt: new Date().toISOString(),
    charts: {},      // keyed by chart title
    uncorrelated: [], // responses we couldn't map to a title
  };

  // Build sliceId → domChart lookup
  const bySliceId = Object.fromEntries(
    domCharts.filter(c => c.sliceId).map(c => [String(c.sliceId), c])
  );

  // Build title → domChart lookup (for dom-only entries added below)
  const byTitle = Object.fromEntries(
    domCharts.filter(c => c.title).map(c => [c.title, c])
  );

  // Process each intercepted response
  for (const { url, requestBody, responseData } of captured) {
    // Try to extract slice_id from request body or URL
    let sliceId = null;
    if (requestBody) {
      sliceId =
        requestBody.slice_id ??
        requestBody.form_data?.slice_id ??
        null;
      if (sliceId) sliceId = String(sliceId);
    }
    if (!sliceId) {
      const m = url.match(/\/chart\/(\d+)\/data/);
      if (m) sliceId = m[1];
    }
    if (!sliceId) {
      const m = url.match(/slice_id[=:](\d+)/);
      if (m) sliceId = m[1];
    }

    const domChart = sliceId ? bySliceId[sliceId] : null;
    const title = domChart?.title || (sliceId ? `slice_${sliceId}` : `capture_${captured.indexOf({ url, requestBody, responseData })}`);

    const entry = {
      sliceId,
      title,
      chartType: domChart?.chartType ?? 'unknown',
      displayedValue: domChart?.displayedValue ?? null,
      displayedSubtitle: domChart?.displayedSubtitle ?? null,
      data: parseSupersetResponse(responseData),
    };

    if (domChart?.title) {
      result.charts[title] = entry;
    } else {
      result.uncorrelated.push(entry);
    }
  }

  // Add DOM-only charts (visible values but no captured API response)
  for (const chart of domCharts) {
    const t = chart.title;
    if (t && !result.charts[t]) {
      result.charts[t] = {
        sliceId: chart.sliceId,
        title: t,
        chartType: chart.chartType,
        displayedValue: chart.displayedValue,
        displayedSubtitle: chart.displayedSubtitle,
        data: null, // no API response captured for this chart
      };
    }
  }

  return result;
}

// ── Superset response parser ──────────────────────────────────────────────────

/**
 * Normalize a Superset /api/v1/chart/data response into a consistent shape.
 *
 * Standard shape:
 *   { result: [{ data: [...], colnames: [...], query: '...', rowcount: N }] }
 *
 * Returns:
 *   { colnames, timeColumn, data, rowcount, query }
 *   or { error } on failure
 *   or null if no data
 */
function parseSupsersetResponse(responseData) {
  if (!responseData) return null;

  try {
    const results = responseData.result ?? responseData.results ?? [];
    if (!results.length) {
      // May be a cache-hit response: { id, status, result: null }
      return { raw: responseData };
    }

    const combined = {
      colnames: null,
      timeColumn: null,
      data: [],
      rowcount: 0,
      query: null,
    };

    // Merge multi-series results (e.g. comparison queries that return 2 result sets)
    for (const r of results) {
      const rows = r.data ?? [];
      const cols = r.colnames ?? (rows[0] ? Object.keys(rows[0]) : []);

      if (!combined.colnames) combined.colnames = cols;
      combined.data.push(...rows);
      combined.rowcount += rows.length;
      if (!combined.query && r.query) combined.query = r.query;
    }

    // Detect timestamp/date column
    if (combined.colnames) {
      combined.timeColumn = combined.colnames.find(c =>
        c === '__timestamp' || /^(date|week|month|day|time)/i.test(c)
      ) ?? null;
    }

    return combined;
  } catch (e) {
    return { error: e.message };
  }
}

// Re-export under consistent name (both spellings used above)
const parseSupersetResponse = parseSupsersetResponse;

module.exports = {
  captureDashboardCharts,
  getDomChartMeta,
  parseSupsersetResponse,
  scrollToTriggerLazyLoad,
};

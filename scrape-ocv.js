'use strict';

/**
 * scrape-ocv.js
 *
 * Pulls Customer Voice (OCV) data for two dashboards:
 *   • SPARK (Copilot in SharePoint KAv2)
 *   • AI Intranet (SharePoint AI Intranet)
 *
 * Data source: https://ocv.microsoft.com/api/es/ocv/_search (Elasticsearch DSL).
 * Auth: piggy-backs on the logged-in MSFTReportingEdge profile (interactive
 * SSO required on first run). We just `fetch()` from inside the page context
 * so cookies are sent automatically.
 *
 * What we capture per dashboard:
 *   • trend-daily.json   — per-day SAT/DSAT/Other counts (last N days, default 90)
 *   • reliability.json   — per-day error-thumbs counts + total thumbs (SPARK only)
 *   • categories.json    — { section, name, dsat, sat, other, total } per chart
 *   • dashboardpage.json — raw dashboard config (for inspection / debugging)
 *   • scraped-at.txt
 *
 * Usage:
 *   node scrape-ocv.js
 *   OCV_DAYS=180 node scrape-ocv.js
 *   MIN_SCRAPE_AGE_HOURS=0 node scrape-ocv.js
 */

const { connectToEdge } = require('./lib/cdp-connect');
const fs   = require('fs');
const path = require('path');

const DAYS          = parseInt(process.env.OCV_DAYS || '90', 10);
const MIN_AGE_HOURS = parseInt(process.env.MIN_SCRAPE_AGE_HOURS || '6', 10);
const DATA_ROOT     = path.join(__dirname, 'data', 'ocv');

// ── Dashboard configs ────────────────────────────────────────────────────────

const DASHBOARDS = [
  {
    key:   'spark',
    label: 'Copilot in SharePoint (KAv2)',
    dashboardPageId: 'dashboardpage_e4bdb3bcc7d847eb8ffd99d26ff6f024',
    areaIds: ['5b090c68-e25b-488a-bd18-a193b334b67e'],
    audienceGroups: ['Production', 'Microsoft'],
    // Chart titles whose results we want as the headline trend / reliability
    headlineTitle:    'All Thumbs for Copilot in SharePoint (KAv2)',
    reliabilityTitle: 'Error Volumes for KnowledgeAgentV2 (includes Something went wrong)',
  },
  {
    key:   'ai-intranet',
    label: 'SharePoint AI Intranet',
    dashboardPageId: 'dashboardpage_03f4fa6cd2c94ab0b300688def8c8f68',
    areaIds: ['8c972052-8782-45e1-ab5c-dcce5d886767', '5b090c68-e25b-488a-bd18-a193b334b67e'],
    audienceGroups: ['Microsoft', 'Production'],
    headlineTitle:    'AI Intranet Thumbs Per Day',
    reliabilityTitle: null,
  },
];

// ── Freshness guard ──────────────────────────────────────────────────────────

function shouldScrape() {
  const stamp = path.join(DATA_ROOT, 'scraped-at.txt');
  if (!fs.existsSync(stamp)) return true;
  const ageH = (Date.now() - fs.statSync(stamp).mtimeMs) / 3_600_000;
  if (ageH < MIN_AGE_HOURS) {
    console.log(`↷ Skipping — scraped ${ageH.toFixed(1)}h ago. Pass MIN_SCRAPE_AGE_HOURS=0 to force.`);
    return false;
  }
  return true;
}

// ── Date helpers ─────────────────────────────────────────────────────────────

function todayPT() {
  // OCV's date_histogram uses America/Los_Angeles. We need PT-aligned ISO bounds.
  const now = new Date();
  // Subtract one day so we don't include a partial "today"
  return new Date(now.getTime() - 24 * 3600 * 1000);
}

function isoRange(days) {
  const end = todayPT();
  const start = new Date(end.getTime() - days * 24 * 3600 * 1000);
  const fmt = d => d.toISOString().slice(0, 10);
  return {
    gte:   fmt(start) + 'T07:00:00.000Z',
    lte:   fmt(end)   + 'T06:59:59.999Z',
    minM:  fmt(start),
    maxM:  fmt(end),
    startDate: fmt(start),
    endDate:   fmt(end),
  };
}

// ── ES query builder ─────────────────────────────────────────────────────────

const MODERATION_MUST_NOT = [{ terms: { 'Moderation.Status': ['Quarantined', 'PrivacyRisk'] } }];

/**
 * Build a bool filter clause matching how the OCV UI scopes a chart:
 *   • date range
 *   • OcvAreas.IdPath
 *   • AudienceGroup.raw
 *   • the per-chart query_string (from chart.QueryUrl q= parameter)
 *   • moderation exclusion
 */
function baseFilter({ range, areaIds, audience, qString }) {
  const must = [
    { range: { CreatedDate: { gte: range.gte, lte: range.lte } } },
    { terms: { 'OcvAreas.IdPath': areaIds } },
    { terms: { 'AudienceGroup.raw': audience } },
  ];
  if (qString) must.push({ query_string: { query: qString } });
  return { bool: { filter: { bool: { must, must_not: MODERATION_MUST_NOT } } } };
}

/** Extract the `q=` parameter from a QueryUrl. URI-decoded. */
function extractQuery(queryUrl) {
  if (!queryUrl) return null;
  const m = queryUrl.match(/[?&]q=([^&]+)/);
  if (!m) return null;
  try { return decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch { return null; }
}

/**
 * Build aggs that count documents matching each named-query (DSAT/SAT/Other).
 * Each bucket reapplies the chart's primary filter implicitly (we're a sub-agg).
 */
function namedQueryAggs(namedQueries, range) {
  const aggs = {};
  for (const nq of namedQueries) {
    aggs[nq.title] = {
      filter: {
        bool: {
          must: [
            { range: { CreatedDate: { gte: range.gte, lte: range.lte } } },
            { query_string: { query: nq.query } },
          ],
          must_not: MODERATION_MUST_NOT,
        },
      },
    };
  }
  return aggs;
}

/** Volume aggregation: total counts per named-query (DSAT/SAT/Other). */
function volumeBody({ range, areaIds, audience, qString, namedQueries }) {
  return {
    size: 0,
    query: baseFilter({ range, areaIds, audience, qString }),
    aggs: { fieldAggregate: { filter: { bool: { must: [] } }, aggs: namedQueryAggs(namedQueries, range) } },
  };
}

/** Time-series: per-day histogram split by named-query. */
function trendBody({ range, areaIds, audience, qString, namedQueries }) {
  const aggs = {};
  for (const nq of namedQueries) {
    aggs[nq.title] = {
      filter: {
        bool: {
          must: [{ query_string: { query: nq.query } }],
          must_not: MODERATION_MUST_NOT,
        },
      },
      aggs: {
        histogram: {
          date_histogram: {
            field: 'CreatedDate',
            calendar_interval: 'day',
            format: 'yyyy-MM-dd',
            min_doc_count: 0,
            time_zone: 'America/Los_Angeles',
            extended_bounds: { min: range.minM, max: range.maxM },
          },
        },
      },
    };
  }
  return {
    size:  0,
    query: baseFilter({ range, areaIds, audience, qString }),
    aggs,
  };
}

/** Reliability: per-day error volume + total thumbs by AudienceGroup.raw. */
function reliabilityTrendBody({ range, areaIds, audience, qString }) {
  const splitAgg = (g) => ({
    filter: { bool: { must: [{ term: { 'AudienceGroup.raw': g } }] } },
    aggs: {
      histogram: {
        date_histogram: {
          field: 'CreatedDate',
          calendar_interval: 'day',
          format: 'yyyy-MM-dd',
          min_doc_count: 0,
          time_zone: 'America/Los_Angeles',
          extended_bounds: { min: range.minM, max: range.maxM },
        },
      },
    },
  });
  const aggs = {};
  for (const g of audience) aggs[g] = splitAgg(g);
  return {
    size:  0,
    query: baseFilter({ range, areaIds, audience, qString }),
    aggs,
  };
}

// ── ES request execution (via logged-in page context) ────────────────────────

async function esSearch(page, body, authToken) {
  const result = await page.evaluate(async ([b, tok]) => {
    const r = await fetch('/api/es/ocv/_search', {
      method:  'POST',
      headers: { 'content-type': 'application/json', authorization: tok, accept: 'application/json, text/plain, */*' },
      body:    JSON.stringify(b),
    });
    if (!r.ok) return { error: `HTTP ${r.status} ${r.statusText}`, text: (await r.text()).slice(0, 500) };
    return await r.json();
  }, [body, authToken]);
  if (result?.error) throw new Error(`OCV ES error: ${result.error} ${result.text || ''}`);
  return result;
}

async function fetchDashboardPage(page, id, authToken) {
  return page.evaluate(async ([id, tok]) => {
    const r = await fetch('/api/es/dashboardpage/_search', {
      method:  'POST',
      headers: { 'content-type': 'application/json', authorization: tok, accept: 'application/json, text/plain, */*' },
      body:    JSON.stringify({
        size: 1,
        query: { bool: { filter: { bool: { must: [{ term: { id } }] } } } },
      }),
    });
    return await r.json();
  }, [id, authToken]);
}

async function fetchNamedQueryCatalog(page, authToken) {
  return page.evaluate(async (tok) => {
    const r = await fetch('/api/metadata/CustomDashboardsQueries', {
      headers: { authorization: tok, accept: 'application/json, text/plain, */*' },
    });
    return await r.json();
  }, authToken);
}

// ── Catalog resolution ───────────────────────────────────────────────────────

/**
 * Resolve `Fields: "QUERIES:Copilot SAT / DSAT (Thumbs)"` to an array of
 * `{ title, query, color }` entries from the catalog. The catalog stores
 * queries as URL-encoded `?q=...` strings; we decode to raw Lucene syntax.
 */
function resolveFields(fieldsStr, catalog) {
  if (!fieldsStr) return null;
  const m = fieldsStr.match(/^QUERIES:(.+)$/);
  if (!m) return { type: 'field', field: fieldsStr.trim() };
  const groupName = m[1].trim();
  const group = catalog[groupName];
  if (!group) return null;
  return {
    type: 'queries',
    items: group.map(g => ({
      title: g.title,
      color: g.color,
      query: extractQueryFromQueryUrl(g.queryUrl),
    })).filter(x => x.query),
  };
}

function extractQueryFromQueryUrl(qu) {
  if (!qu) return null;
  const m = qu.match(/[?&]q=([^&]+)/);
  if (!m) return null;
  try { return decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch { return null; }
}

// ── Trend → R7/R28 helpers ───────────────────────────────────────────────────

function rolling(values, window) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= window) sum -= values[i - window];
    if (i >= window - 1) out[i] = sum;
  }
  return out;
}

function computeTrend(buckets) {
  // Collect union of all date keys across SAT/DSAT/Other (handle empty-named-query arrays).
  const datesSet = new Set();
  const maps = {};
  for (const name of ['DSAT', 'SAT', 'Other']) {
    const arr = buckets[name]?.histogram?.buckets || [];
    const m = new Map();
    for (const b of arr) {
      m.set(b.key_as_string, b.doc_count);
      datesSet.add(b.key_as_string);
    }
    maps[name] = m;
  }
  const dates = [...datesSet].sort();
  const get = (name) => dates.map(d => maps[name].get(d) ?? 0);
  return { dates, dsat: get('DSAT'), sat: get('SAT'), other: get('Other') };
}

function summarise(trend) {
  const { dates, dsat, sat, other } = trend;
  const total = dsat.map((d, i) => d + sat[i] + other[i]);
  const dsatR7  = rolling(dsat,  7);
  const dsatR28 = rolling(dsat, 28);
  const totR7   = rolling(total, 7);
  const totR28  = rolling(total, 28);

  const pct = (a, b) => (b > 0 ? +(100 * a / b).toFixed(2) : null);
  const last = arr => arr.length ? arr[arr.length - 1] : null;

  const dailyTDR = dates.map((_, i) => pct(dsat[i], total[i]));
  const r7TDR    = dates.map((_, i) => totR7[i]  ? pct(dsatR7[i],  totR7[i])  : null);
  const r28TDR   = dates.map((_, i) => totR28[i] ? pct(dsatR28[i], totR28[i]) : null);

  return {
    series: { dates, dsat, sat, other, total, dailyTDR, r7TDR, r28TDR },
    headline: {
      asOf:           last(dates),
      dailyTDR:       last(dailyTDR),
      r7TDR:          last(r7TDR),
      r28TDR:         last(r28TDR),
      total28d:       last(totR28),
      dsat28d:        last(dsatR28),
    },
  };
}

// ── Per-dashboard scrape ─────────────────────────────────────────────────────

async function scrapeDashboard(page, cfg, catalog, authToken) {
  const range = isoRange(DAYS);
  console.log(`\n=== ${cfg.label} === (${range.startDate} → ${range.endDate}, ${DAYS}d)`);

  const dpRes = await fetchDashboardPage(page, cfg.dashboardPageId, authToken);
  const dpDoc = dpRes?.hits?.hits?.[0]?._source;
  if (!dpDoc) throw new Error(`Dashboard page not found: ${cfg.dashboardPageId}`);

  const outDir = path.join(DATA_ROOT, cfg.key);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'dashboardpage.json'), JSON.stringify(dpDoc, null, 2));

  const content = dpDoc.Content || [];

  // ── Walk content, grouping pies/charts under their preceding <h2>/<h3> header.
  let currentSection = 'Overview';
  const categories = [];        // diverging-bar rows
  let trendOut = null;          // headline trend
  let reliabilityOut = null;    // reliability time series

  for (const item of content) {
    if (item.Type === 'text') {
      const html = item.Title || '';
      const txt = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
      if (txt) currentSection = txt.split(/[.\n]/)[0].slice(0, 80);
      continue;
    }
    if (item.Type !== 'volume-chart' && item.Type !== 'time-series-chart') continue;

    const qString = extractQuery(item.QueryUrl);
    const fields  = resolveFields(item.Fields, catalog);

    // Headline trend chart (named-query histogram)
    if (item.Type === 'time-series-chart' && fields?.type === 'queries' && item.Title === cfg.headlineTitle) {
      console.log(`  · trend "${item.Title}"`);
      const body = trendBody({ range, areaIds: cfg.areaIds, audience: cfg.audienceGroups, qString, namedQueries: fields.items });
      const res = await esSearch(page, body, authToken);
      const trend = computeTrend(res.aggregations || {});
      trendOut = { title: item.Title, ...summarise(trend) };
      continue;
    }

    // Reliability time-series — uses AudienceGroup splits, no named queries
    if (item.Type === 'time-series-chart' && cfg.reliabilityTitle && item.Title === cfg.reliabilityTitle) {
      console.log(`  · reliability "${item.Title}"`);
      const body = reliabilityTrendBody({ range, areaIds: cfg.areaIds, audience: cfg.audienceGroups, qString });
      const res = await esSearch(page, body, authToken);
      const agg = res.aggregations || {};
      const dates = (agg[cfg.audienceGroups[0]]?.histogram?.buckets || []).map(b => b.key_as_string);
      const seriesByGroup = {};
      let totals = new Array(dates.length).fill(0);
      for (const g of cfg.audienceGroups) {
        const vals = (agg[g]?.histogram?.buckets || []).map(b => b.doc_count);
        seriesByGroup[g] = vals;
        totals = totals.map((t, i) => t + (vals[i] || 0));
      }
      reliabilityOut = { title: item.Title, dates, byGroup: seriesByGroup, total: totals };
      continue;
    }

    // Volume-chart pie with named queries → one row in the diverging bar
    if (item.Type === 'volume-chart' && fields?.type === 'queries') {
      const body = volumeBody({ range, areaIds: cfg.areaIds, audience: cfg.audienceGroups, qString, namedQueries: fields.items });
      const res = await esSearch(page, body, authToken);
      const counts = {};
      for (const nq of fields.items) {
        counts[nq.title] = res.aggregations?.fieldAggregate?.[nq.title]?.doc_count ?? 0;
      }
      const dsat  = counts.DSAT  ?? 0;
      const sat   = counts.SAT   ?? 0;
      const other = counts.Other ?? 0;
      const total = dsat + sat + other;
      categories.push({
        section: currentSection,
        name:    cleanTitle(item.Title),
        dsat, sat, other, total,
        tdr: total ? +(100 * dsat / total).toFixed(2) : null,
      });
      process.stdout.write('.');
    }
  }
  console.log();

  // ── Persist
  if (trendOut)       fs.writeFileSync(path.join(outDir, 'trend-daily.json'),  JSON.stringify(trendOut,       null, 2));
  if (reliabilityOut) fs.writeFileSync(path.join(outDir, 'reliability.json'),  JSON.stringify(reliabilityOut, null, 2));
  fs.writeFileSync(path.join(outDir, 'categories.json'), JSON.stringify({ generated: new Date().toISOString(), items: categories }, null, 2));

  console.log(`  ✓ trend: ${trendOut ? trendOut.series.dates.length + ' days' : '—'}`);
  console.log(`  ✓ reliability: ${reliabilityOut ? reliabilityOut.dates.length + ' days' : '—'}`);
  console.log(`  ✓ categories: ${categories.length} rows`);
  if (trendOut) {
    const h = trendOut.headline;
    console.log(`  ► TDR daily=${h.dailyTDR}% · R7=${h.r7TDR}% · R28=${h.r28TDR}% · Total28d=${h.total28d}`);
  }
}

function cleanTitle(t) {
  return (t || '').replace(/\s+/g, ' ').trim();
}

// ── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  if (!shouldScrape()) return;

  fs.mkdirSync(DATA_ROOT, { recursive: true });

  const { browser, page } = await connectToEdge();
  try {
    // Navigate to a dashboard URL so the page loads MSAL + fires authenticated _search requests.
    const bootUrl = `https://ocv.microsoft.com/#/dashboard/${DASHBOARDS[0].dashboardPageId}`;

    // Capture the first Authorization header we see on a real OCV API call.
    let authToken = null;
    const tokenP = new Promise(resolve => {
      const handler = (req) => {
        const u = req.url();
        if (u.startsWith('https://ocv.microsoft.com/api/')) {
          const h = req.headers();
          if (h.authorization?.startsWith('Bearer ')) {
            page.off('request', handler);
            resolve(h.authorization);
          }
        }
      };
      page.on('request', handler);
    });

    console.log('Loading OCV dashboard to acquire auth token...');
    await page.goto(bootUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Wait up to 3 min for token (MSAL may need user interaction on first run).
    authToken = await Promise.race([
      tokenP,
      new Promise((_, rej) => setTimeout(() => rej(new Error('Timed out waiting for OCV auth token (180s). Sign in to https://ocv.microsoft.com in the MSFTReportingEdge profile and retry.')), 180000)),
    ]);
    console.log('✓ Auth token acquired.');

    console.log('Fetching CustomDashboardsQueries catalog...');
    const catalog = await fetchNamedQueryCatalog(page, authToken);
    fs.writeFileSync(path.join(DATA_ROOT, 'queries-catalog.json'), JSON.stringify(catalog, null, 2));

    for (const cfg of DASHBOARDS) {
      try { await scrapeDashboard(page, cfg, catalog, authToken); }
      catch (e) { console.error(`✗ ${cfg.key}: ${e.message}`); }
    }

    fs.writeFileSync(path.join(DATA_ROOT, 'scraped-at.txt'), new Date().toISOString() + '\n');
    console.log('\nOCV scrape complete.');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error('Fatal:', e); process.exit(1); });

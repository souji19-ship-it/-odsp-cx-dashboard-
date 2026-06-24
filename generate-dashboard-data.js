'use strict';

const fs   = require('fs');
const path = require('path');

const DATA    = path.join(__dirname, 'data');
const OUT_JS  = path.join(__dirname, 'dashboard-data.js');
const OUT_JSON = path.join(__dirname, 'dashboard-data.json');

// ── CSV ───────────────────────────────────────────────────────────────────────

function parseLine(line) {
  const out = []; let cur = '', q = false;
  for (const c of line) {
    if (c === '"') q = !q;
    else if (c === ',' && !q) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function csv(rel) {
  const p = path.join(DATA, rel);
  if (!fs.existsSync(p)) return [];
  const lines = fs.readFileSync(p, 'utf8').trim().split('\n');
  if (lines.length < 2) return [];
  const hdr = parseLine(lines[0]);
  return lines.slice(1).map(l => {
    const v = parseLine(l); const o = {};
    hdr.forEach((h, i) => { o[h] = v[i] ?? ''; });
    return o;
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const tsDate  = ts => new Date(parseInt(ts)).toISOString().slice(0, 10);
const isoDate = s  => (s || '').slice(0, 10);
const n       = v  => parseFloat(v) || 0;

function sampleWeekly(rows, dk) {
  if (!rows.length) return rows;
  const s = [...rows].sort((a, b) => a[dk].localeCompare(b[dk]));
  const out = [s[0]]; let last = new Date(s[0][dk]);
  for (let i = 1; i < s.length; i++) {
    const d = new Date(s[i][dk]);
    if (d - last >= 6 * 86400000) { out.push(s[i]); last = d; }
  }
  // Always include the final point so the chart matches the KPI date
  if (out[out.length - 1] !== s[s.length - 1]) out.push(s[s.length - 1]);
  return out;
}

// ── KAv2 ──────────────────────────────────────────────────────────────────────

function loadKav2() {
  const g = rel => csv(`kav2-growth-analytics/${rel}`);

  // SPARK WAU (total) — sourced from the fresh "Weekly Active users" series.
  // This is the all-environments total (= Prod + MSIT) and is the biggest
  // single number we report for KAv2. We previously used [KAv2] WAU from the
  // Growth Analytics tab, but that path is scraped less frequently and was
  // showing a stale number smaller than Prod-only.
  const wauAll = g('usage/weekly-active-users.csv')
    .map(r => ({ date: tsDate(r.__timestamp), v: n(r['Weekly Active users']) }))
    .filter(r => r.v).sort((a, b) => a.date.localeCompare(b.date));

  const wauProd = g('usage/weekly-active-users-prod.csv')
    .map(r => ({ date: tsDate(r.__timestamp), v: n(r['Weekly Active users']) }))
    .filter(r => r.v).sort((a, b) => a.date.localeCompare(b.date));

  const wauMsit = g('usage/weekly-active-users-msit.csv')
    .map(r => ({ date: tsDate(r.__timestamp), v: n(r['Weekly Active users']) }))
    .filter(r => r.v).sort((a, b) => a.date.localeCompare(b.date));

  const dau = g('usage/kav2-daily-active-usage.csv')
    .map(r => ({ date: tsDate(r.__timestamp), v: n(r['[KAv2] DAU']) }))
    .filter(r => r.v).sort((a, b) => a.date.localeCompare(b.date));

  const qvol = g('usage/kav2-weekly-conversation-volume.csv')
    .map(r => ({ date: tsDate(r.__timestamp), v: n(r['[KAv2] Weekly Query volume']) }))
    .filter(r => r.v).sort((a, b) => a.date.localeCompare(b.date));

  const surfaces = g('usage/kav2-query-volume-by-top-surface-r7.csv')
    .map(r => ({ surface: r.workload, queries: n(r['[KAv2] Weekly Query volume']) }))
    .filter(r => r.queries).sort((a, b) => b.queries - a.queries);

  // Number of turns per conversation — switched to R7 source (kept up to date
  // on every scrape, more granular than the old tools-and-task-complexity table).
  const turnsRaw = g('usage/number-of-turns-per-conversation-r7.csv');
  const maxTurnTs = turnsRaw.map(r => r.scraped_at).filter(Boolean).sort().pop();
  const turns = turnsRaw
    .filter(r => !maxTurnTs || r.scraped_at === maxTurnTs)
    .map(r => ({ label: r.turn_segment, pct: n(r.percentage) }))
    .filter(r => r.pct);

  // Query volume by launch origin (R7) — where users open SPARK from.
  const launchOriginsRaw = g('usage/kav2-query-volume-by-top-launch-origin-r7.csv');
  const launchTs = launchOriginsRaw.map(r => r.scraped_at).filter(Boolean).sort().pop();
  const launchOrigins = launchOriginsRaw
    .filter(r => !launchTs || r.scraped_at === launchTs)
    .map(r => ({
      origin: r.partc_Engagement_extraData_ChatODSPLaunchOrigin || '(unlabeled)',
      queries: n(r['[KAv2] Weekly Query volume']),
    }))
    .filter(r => r.queries)
    .sort((a, b) => b.queries - a.queries);

  // FAB Exposed enablement (R7) — sites / tenants / users reached by FAB UI.
  const latestSnapshotRow = (rows) => {
    if (!rows.length) return null;
    const ts = rows.map(r => r.scraped_at).filter(Boolean).sort().pop();
    return rows.filter(r => !ts || r.scraped_at === ts)[0] || null;
  };
  const siteRow   = latestSnapshotRow(g('usage/site-enablement-stats-r7.csv'));
  const tenantRow = latestSnapshotRow(g('usage/tenant-enablement-stats-r7.csv'));
  const userRow   = latestSnapshotRow(g('usage/user-level.csv'));
  const fabExposed = {
    users:   { copilotLicensed: n(userRow?.['Copilot Licensed users']),    kaEnabled: n(userRow?.['KA Enabled users']),    fabExposed: n(userRow?.['FAB Exposed users']) },
    tenants: { copilotLicensed: n(tenantRow?.['Copilot Licensed tenants']), kaEnabled: n(tenantRow?.['KA Enabled tenants']), fabExposed: n(tenantRow?.['FAB Exposed tenants']) },
    sites:   { copilotLicensed: n(siteRow?.['Copilot Licensed sites']),    kaEnabled: n(siteRow?.['KA Enabled sites']),    fabExposed: n(siteRow?.['FAB Exposed sites']) },
    scrapedAt: userRow?.scraped_at || tenantRow?.scraped_at || siteRow?.scraped_at || null,
  };

  // Localization — Display Language + input language detected by Orchestrator.
  const langDisplayRaw = g('localization/display-language.csv');
  const langDispTs = langDisplayRaw.map(r => r.scraped_at).filter(Boolean).sort().pop();
  const displayLanguage = langDisplayRaw
    .filter(r => !langDispTs || r.scraped_at === langDispTs)
    .map(r => ({
      lang: r.partc_Engagement_extraData_ChatODSPUILanguage || '(unlabeled)',
      events: n(r['Number of events']),
    }))
    .filter(r => r.events)
    .sort((a, b) => b.events - a.events);

  const langInputRaw = g('localization/queries-by-input-language-detected-by-orchestrator.csv');
  const langInTs = langInputRaw.map(r => r.scraped_at).filter(Boolean).sort().pop();
  const inputLanguage = langInputRaw
    .filter(r => !langInTs || r.scraped_at === langInTs)
    .map(r => ({
      lang: r.partc_Engagement_extraData_ChatODSPInputDetectedLanguage || '(unlabeled)',
      queries: n(r['Unique queries with that input language']),
    }))
    .filter(r => r.queries)
    .sort((a, b) => b.queries - a.queries);
  const languages = { display: displayLanguage, input: inputLanguage };

  const retRow = g('usage/weekly-retention.csv')[0];

  // Top tenants by WAU (sourced from kav2 dashboard since agents-io scraper was removed)
  const topTenantsRaw = csv('kav2/top-tenants-wau.csv');
  const tenantMap = new Map();
  for (const r of topTenantsRaw) {
    const name = r.tenant_lookup_OrganizationName;
    const wau  = n(r['Weekly Active users']);
    const ts   = r.scraped_at || '';
    if (!name || !wau) continue;
    if (!tenantMap.has(name) || ts > tenantMap.get(name).ts) tenantMap.set(name, { name, wau, ts });
  }
  const topTenants = [...tenantMap.values()]
    .sort((a, b) => b.wau - a.wau).slice(0, 20)
    .map(({ name, wau }) => ({ name, wau }));

  // Penetration rate — KAv2 WAU as % of M365 Copilot All-Up WAU (licensed user base)
  const allUpRows = sanitizeRows(
    csv('ideas/m365-copilot/m365-copilot-all-up-wau.csv')
      .map(r => ({ date: isoDate(r.Date), wau: n(r.WeeklyActiveUserCount) }))
      .filter(r => r.wau && r.date).sort((a, b) => a.date.localeCompare(b.date))
  );
  const allUpByDate = new Map(allUpRows.map(r => [r.date, r.wau]));
  const latestAllUpWau = allUpRows[allUpRows.length - 1]?.wau || 0;
  const penetrationTrend = wauAll
    .filter(r => allUpByDate.has(r.date))
    .map(r => ({ date: r.date, pct: +(r.v / allUpByDate.get(r.date) * 100).toFixed(4) }));

  // Tenant concentration — top-N WAU as % of total
  const top5Wau  = topTenants.slice(0,  5).reduce((s, t) => s + t.wau, 0);
  const top10Wau = topTenants.slice(0, 10).reduce((s, t) => s + t.wau, 0);

  // Engagement intensity — weekly queries per WAU user
  const wauByDate = new Map(wauAll.map(r => [r.date, r.v]));
  const intensityTrend = qvol
    .filter(r => wauByDate.has(r.date) && wauByDate.get(r.date) > 0)
    .map(r => ({ date: r.date, qPerUser: +(r.v / wauByDate.get(r.date)).toFixed(2) }));

  // DAU/WAU stickiness — % of weekly actives active on any given day
  const dauWauTrend = dau
    .filter(r => wauByDate.has(r.date) && wauByDate.get(r.date) > 0)
    .map(r => ({ date: r.date, ratio: +(r.v / wauByDate.get(r.date) * 100).toFixed(1) }));

  const tenants = g('usage/weekly-active-tenants.csv')
    .map(r => ({ date: tsDate(r.__timestamp), v: n(r['Weekly Active users']) }))
    .filter(r => r.v).sort((a, b) => a.date.localeCompare(b.date));

  // Aggregate tool calls by individual tool name
  const toolMap = new Map();
  let noToolQ = 0;
  for (const r of g('tools-and-task-complexity/query-level-tool-calls-by-unique-event-ids.csv')) {
    const raw   = (r['partc_Engagement_extraData_ChatODSPToolsInvoked'] || '').trim();
    const count = n(r['Weekly queries']);
    const tools = raw.split(',').map(t => t.trim()).filter(Boolean);
    if (!tools.length) { noToolQ += count; continue; }
    for (const t of tools) toolMap.set(t, (toolMap.get(t) || 0) + count);
  }
  const toolCalls = [...toolMap.entries()]
    .map(([tool, queries]) => ({ tool, queries }))
    .sort((a, b) => b.queries - a.queries)
    .slice(0, 18);

  // Long-history series (for "since launch" growth) — Growth Analytics tab
  // [KAv2] WAU has a longer back-history than the basic Weekly Active users
  // series, even though it's scraped less often. Use it only for the launch
  // baseline so the "+XXX% since launch" badge keeps its long memory.
  const wauAllLong = g('usage/kav2-weekly-active-usage.csv')
    .map(r => ({ date: tsDate(r.__timestamp), v: n(r['[KAv2] WAU']) }))
    .filter(r => r.v).sort((a, b) => a.date.localeCompare(b.date));
  const launchBaseline = wauAllLong[0]?.v || wauAll[0]?.v || 1;

  // For headline KPIs, use max-of-last-7-days instead of the bare latest
  // point. The "latest" point can be a partial-week dip (Superset hasn't
  // closed the rolling window yet) which makes the dashboard look like
  // SPARK shrank vs. Production. Max-of-7 is robust to that artifact.
  const maxOfLastN = (rows, n) => {
    if (!rows.length) return 0;
    const slice = rows.slice(-n);
    return Math.max(...slice.map(r => r.v));
  };

  const latest      = maxOfLastN(wauAll, 7);
  const latestProd  = maxOfLastN(wauProd, 7);
  const latestMsit  = maxOfLastN(wauMsit, 7);
  // Launch baseline (for "since launch" growth %) — pulled from the longer
  // [KAv2] WAU history above, not from the fresh series.
  const first       = launchBaseline;

  // WoW / MoM: compare max-of-last-7 to max of the prior 7-day / 28-day
  // window. Same stability rationale as the headline.
  const maxWindow = (rows, fromEnd, count) => {
    if (rows.length < fromEnd + count) return null;
    const slice = rows.slice(-fromEnd - count, -fromEnd);
    return slice.length ? Math.max(...slice.map(r => r.v)) : null;
  };
  const prevWeek  = maxWindow(wauAll, 7, 7);
  const prevMonth = maxWindow(wauAll, 28, 7);
  const wow = prevWeek  ? +((latest - prevWeek)  / prevWeek  * 100).toFixed(1) : null;
  const mom = prevMonth ? +((latest - prevMonth) / prevMonth * 100).toFixed(1) : null;

  // User intent from Kusto (fetch-user-intent.js)
  let intentAllup = [];
  const intentFile = path.join(DATA, 'user-intent.json');
  if (fs.existsSync(intentFile)) {
    try {
      intentAllup = JSON.parse(fs.readFileSync(intentFile, 'utf8')).rows || [];
    } catch (e) { /* ignore corrupt file */ }
  }

  return {
    headline: {
      wau:           latest,
      wauProd:       latestProd,
      wauMsit:       latestMsit,
      dau:           dau[dau.length - 1]?.v || 0,
      weeklyQueries: qvol[qvol.length - 1]?.v || 0,
      retentionRate: retRow ? n(retRow['Weekly Return Rate']) : 0,
      activeTenants: tenants[tenants.length - 1]?.v || 0,
    },
    wauTrend:     wauAll.map(r  => ({ date: r.date,  wau: r.v })),
    wauProdTrend: wauProd.map(r => ({ date: r.date,  wau: r.v })),
    wauMsitTrend: wauMsit.map(r => ({ date: r.date,  wau: r.v })),
    dauTrend:     dau.map(r     => ({ date: r.date,  dau: r.v })),
    queryTrend:   qvol.map(r    => ({ date: r.date,  queries: r.v })),
    tenantTrend:  tenants.map(r => ({ date: r.date,  tenants: r.v })),
    topTenants,
    penetration: {
      pct:       penetrationTrend[penetrationTrend.length - 1]?.pct || 0,
      allUpWau:  latestAllUpWau,
      trend:     penetrationTrend,
    },
    tenantConcentration: {
      top5Pct:  latest ? +(top5Wau  / latest * 100).toFixed(1) : 0,
      top10Pct: latest ? +(top10Wau / latest * 100).toFixed(1) : 0,
      top5Wau, top10Wau,
    },
    intensityTrend,
    dauWauTrend,
    surfaces,
    turns,
    launchOrigins,
    fabExposed,
    languages,
    toolCalls,
    noToolQueries: noToolQ,
    intentAllup,
    growth: {
      wow,
      mom,
      launch: +(((latest - first) / first) * 100).toFixed(0),
    },
    launchDate: wauAll[0]?.date  || '',
    latestDate: wauAll[wauAll.length - 1]?.date || '',
  };
}

// ── SPARK Top Tenants (Tenant Deep Dive scrape) ──────────────────────────────

function loadSparkTopTenants() {
  const root = path.join(DATA, 'spark-top-tenants');
  const metaFile = path.join(root, 'meta.json');
  if (!fs.existsSync(metaFile)) return { hasData: false };
  const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));

  // Load the latest snapshot for a given chart from a scope directory.
  const latestSnap = (scope, chartSlug) => {
    const rows = csv(`spark-top-tenants/${scope}/${chartSlug}.csv`);
    if (!rows.length) return [];
    const ts = rows.map(r => r.scraped_at).filter(Boolean).sort().pop();
    return rows.filter(r => !ts || r.scraped_at === ts);
  };

  const num = v => parseFloat(String(v).replace(/[, ]/g, '')) || 0;

  // The 6 charts present on the Tenant Deep Dive page (chart-title slugs).
  const buildScope = (scope) => {
    const topKpi   = latestSnap(scope, 'top-kpis-r7')[0] || {};
    const cohort   = latestSnap(scope, 'weekly-retention-by-cohort');
    const sites    = latestSnap(scope, 'active-sites-by-user-count-weekly-r7');
    const surface  = latestSnap(scope, 'kav2-query-volume-by-top-surface-r7');
    const intens   = latestSnap(scope, 'weekly-user-intensity');
    const tools    = latestSnap(scope, 'distribution-of-spark-usage-by-tools-invoked');

    // Tools histogram — aggregate by individual tool (same logic as kav2 loader).
    const toolMap = new Map();
    let noToolQ = 0;
    for (const r of tools) {
      const raw = (r.partc_Engagement_extraData_ChatODSPToolsInvoked || '').trim();
      const cnt = num(r['Weekly queries']);
      const list = raw.split(',').map(t => t.trim()).filter(Boolean);
      if (!list.length) { noToolQ += cnt; continue; }
      for (const t of list) toolMap.set(t, (toolMap.get(t) || 0) + cnt);
    }
    const topTools = [...toolMap.entries()]
      .map(([tool, queries]) => ({ tool, queries }))
      .sort((a, b) => b.queries - a.queries)
      .slice(0, 10);

    // Latest-week avg events per user — derived from weekly-user-intensity.csv
    // (more useful than median, which is ~2 for everyone due to long-tail dist.)
    const intensSorted = intens.slice().sort((a, b) => (b.week || '').localeCompare(a.week || ''));
    const latestIntens = intensSorted[0] || {};
    const avgEventsPerUserPerWk = num(latestIntens.avg_per_user);

    return {
      kpis: {
        siteUniverse:  num(topKpi.site_universe),
        activeSites:   num(topKpi.active_sites),
        activeUsers:   num(topKpi.active_users),
        multiUserSites: num(topKpi.multi_user_sites),
        medianEventsPerUserPerWk: num(topKpi.median_events_per_user_per_wk),
        avgEventsPerUserPerWk,
      },
      cohort: cohort.map(r => ({
        cohort: r.cohort,
        W0: r.W0, W1: r.W1, W2: r.W2, W3: r.W3, W4: r.W4,
      })),
      activeSitesByUserCount: sites.map(r => ({
        bucket: r.bucket, sites: num(r.sites), sharePct: num(r.share_pct),
      })),
      querySurfaces: surface.map(r => ({
        surface: r.workload, queries: num(r['[KAv2] Weekly Query volume']),
      })).sort((a, b) => b.queries - a.queries),
      weeklyIntensity: intens.map(r => ({
        week: r.week ? new Date(parseInt(r.week)).toISOString().slice(0, 10) : '',
        wau:    num(r.wau),
        events: num(r.events),
        avg:    num(r.avg_per_user),
        median: num(r.median_per_user),
        p90:    num(r.p90_per_user),
      })).sort((a, b) => a.week.localeCompare(b.week)),
      topTools,
      noToolQueries: noToolQ,
    };
  };

  const allUp = buildScope('all-up');
  const tenants = (meta.tenants || []).map(t => ({
    name: t.name,
    slug: t.slug,
    wau:  t.wau,
    ...buildScope(t.slug),
  }));

  return {
    hasData: true,
    capturedAt: meta.capturedAt,
    sourceUrl: meta.url,
    allUp,
    tenants,
  };
}



// Trim rows from the first >80% single-step drop (methodology/source break).
function sanitizeRows(rows) {
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].wau < rows[i - 1].wau * 0.2) return rows.slice(0, i);
  }
  return rows;
}

const WORKLOADS = [
  { label: 'M365 Copilot All Up',   slug: 'm365-copilot-all-up',     color: '#742774' },
  { label: 'Copilot App',           slug: 'm365-copilot-app',         color: '#8661C5' },
  { label: 'Copilot Chat',          slug: 'copilot-chat-in-m365-app', color: '#9B6EB5' },
  { label: 'Copilot in SharePoint', slug: 'copilot-in-sharepoint',    color: '#0078D4' },
  { label: 'Copilot in Teams',      slug: 'copilot-in-teams',         color: '#6264A7' },
  { label: 'Copilot in Outlook',    slug: 'copilot-in-outlook',       color: '#0F6CBD' },
  { label: 'Copilot in Word',       slug: 'copilot-in-word',          color: '#2B5797' },
  { label: 'Copilot in Excel',      slug: 'copilot-in-excel',         color: '#217346' },
  { label: 'Copilot in PowerPoint', slug: 'copilot-in-powerpoint',    color: '#B7472A' },
];

function loadIdeas() {
  return WORKLOADS.map(wl => {
    const rows = sanitizeRows(
      csv(`ideas/m365-copilot/${wl.slug}-wau.csv`)
        .map(r => ({ date: isoDate(r.Date), wau: n(r.WeeklyActiveUserCount) }))
        .filter(r => r.wau && r.date)
        .sort((a, b) => a.date.localeCompare(b.date))
    );

    const lat = rows[rows.length - 1]?.wau || 0;
    const p28 = rows.length > 29 ? rows[rows.length - 29]?.wau : null;
    const p92 = rows.length > 93 ? rows[rows.length - 93]?.wau : null;

    return {
      ...wl,
      latestWau:  lat,
      latestDate: rows[rows.length - 1]?.date || '',
      mom: p28 ? +((lat - p28) / p28 * 100).toFixed(1) : null,
      qoq: p92 ? +((lat - p92) / p92 * 100).toFixed(1) : null,
      trend: sampleWeekly(rows, 'date').map(r => ({ date: r.date, wau: r.wau })),
    };
  });
}

// ── SP / OD Sub-products ──────────────────────────────────────────────────────

const SP_SUBPRODUCTS = [
  { label: 'SharePoint All Up',    slug: 'sp-all-up',            parent: 'SharePoint', color: '#0078D4' },
  { label: 'Copilot in SharePoint', slug: 'sp-knowledge-agent',   parent: 'SharePoint', color: '#107C41' },
  { label: 'Authoring Copilot',    slug: 'sp-authoring-copilot', parent: 'SharePoint', color: '#742774' },
  { label: 'File skills',          slug: 'sp-file-skills',       parent: 'SharePoint', color: '#D83B01' },
  { label: 'Smart section',        slug: 'sp-smart-section',     parent: 'SharePoint', color: '#8661C5' },
  { label: 'OneDrive All Up',      slug: 'od-all-up',            parent: 'OneDrive',   color: '#0F6CBD' },
  { label: 'Answer Questions',     slug: 'od-answer-questions',  parent: 'OneDrive',   color: '#107C41' },
  { label: 'File AI actions',      slug: 'od-file-ai-actions',   parent: 'OneDrive',   color: '#D83B01' },
];

function loadSpSubproducts() {
  const TAB = 'ideas/sp-subproducts';

  const loadMetric = (slug, suffix, metricCol) => {
    const rows = csv(`${TAB}/${slug}-${suffix}.csv`)
      .map(r => ({ date: isoDate(r.Date), v: n(r[metricCol]) }))
      .filter(r => r.date)
      .sort((a, b) => a.date.localeCompare(b.date));
    const latest = rows[rows.length - 1];
    return {
      latest:     latest?.v ?? null,
      latestDate: latest?.date ?? null,
      trend:      sampleWeekly(rows, 'date'),
    };
  };

  return SP_SUBPRODUCTS.map(p => {
    const wau      = loadMetric(p.slug, 'wau',      'WeeklyActiveUserCount');
    const mau      = loadMetric(p.slug, 'mau',      'MonthlyActiveUserCount');
    const dau      = loadMetric(p.slug, 'dau',      'DailyActiveUserCount');
    const avgDau   = loadMetric(p.slug, 'avg-dau',  'AverageDAURL7');
    const tries    = loadMetric(p.slug, 'tries',    'WeeklyActionCount');
    const pct3days = loadMetric(p.slug, 'pct3days', 'PercentWAUwith3PlusDaysofUse');
    const newUsers = loadMetric(p.slug, 'new-users','WeeklyNewUserCount');
    const returning= loadMetric(p.slug, 'returning','WeeklyReturningUserCount');
    const lapsed   = loadMetric(p.slug, 'lapsed',   'WeeklyLapsedUserCount');

    const w = wau.latest || 0;
    const prev4w = wau.trend.length > 4 ? wau.trend[wau.trend.length - 5]?.v : null;
    const prev13w = wau.trend.length > 13 ? wau.trend[wau.trend.length - 14]?.v : null;
    const mom = prev4w ? +((w - prev4w) / prev4w * 100).toFixed(1) : null;
    const qoq = prev13w ? +((w - prev13w) / prev13w * 100).toFixed(1) : null;

    return {
      ...p,
      wau, mau, dau, avgDau, tries, pct3days, newUsers, returning, lapsed,
      mom, qoq,
    };
  });
}

// ── Extensibility API (IDEAS Official — SPO Custom Agents) ────────────────────
//
// Data scraped from CopilotExtensibilityDashboard workloadId=10 (SharePoint Agents).
// This is the OFFICIAL source for SPO agent DAU/WAU/MAU and engagement metrics.
// Each metric has { withMsit, withoutMsit, display }.

function loadExtensibilityAPI() {
  const f = path.join(DATA, 'extensibility-api', 'latest.json');
  if (!fs.existsSync(f)) return { hasData: false };
  try {
    const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!raw.spo?.wau?.withMsit) return { hasData: false };
    // Check freshness — warn if > 7 days old but still use it
    const ageH = raw.scrapedAt
      ? (Date.now() - new Date(raw.scrapedAt).getTime()) / 3600000
      : 999;
    if (ageH > 168) {
      process.stderr.write(`⚠️  extensibility-api data is ${Math.round(ageH / 24)}d old (${raw.scrapedAt})\n`);
    }
    return {
      hasData:    true,
      scrapedAt:  raw.scrapedAt,
      dataDate:   raw.dataDate,
      spo:        raw.spo,
    };
  } catch (e) {
    process.stderr.write(`⚠️  loadExtensibilityAPI error: ${e.message}\n`);
    return { hasData: false };
  }
}

// ── Agents (IDEAS Official only) ──────────────────────────────────────────────
//
// Data source: scrape-extensibility-api.js → data/extensibility-api/latest.json
// This replaced the Nezha agents-io scraper (scrape-agents-io.js) which was
// removed because its numbers conflicted with the official IDEAS source.

function loadAgentsIO() {
  const ideas = loadExtensibilityAPI();
  if (!ideas.hasData) return { hasData: false };

  const spo = ideas.spo;
  return {
    hasData:    true,
    headline: {
      wau:           spo.wau?.withMsit           ?? 0,
      dau:           spo.avgDau?.withMsit         ?? 0,
      mau:           spo.mau?.withMsit            ?? 0,
      queriesPerUser: spo.responsesPerUser?.withMsit ?? 0,
      wowPct:        null,  // IDEAS provides single latest point; no WoW available
    },
    ideas,
    latestDate: ideas.dataDate || '',
  };
}

// ── AI All-Up ─────────────────────────────────────────────────────────────────

function loadAiAllUp() {
  const root = __dirname;
  const latest = pat => fs.readdirSync(root).filter(f => new RegExp(pat).test(f)).sort().reverse()[0];

  const metricsFile  = latest('^ai-all-up-metrics-.+\\.csv$');
  const table1File   = latest('^ai-all-up-table1-.+\\.csv$');  // OKR weekly trend table

  if (!metricsFile) return { hasData: false };

  // ── Metrics (big-number KPIs): MAU, retention, etc. ─────────────────────────
  const metrics = {};
  const mLines = fs.readFileSync(path.join(root, metricsFile), 'utf8').trim().split('\n');
  for (const line of mLines.slice(1)) {
    const parts = parseLine(line);
    if (parts.length >= 2 && parts[0] && parts[1]) metrics[parts[0]] = parts[1];
  }

  // Helper: find metric value by partial key match (case-insensitive)
  const findMetric = (...keywords) => {
    for (const key of Object.keys(metrics)) {
      if (keywords.every(kw => key.toLowerCase().includes(kw.toLowerCase()))) return metrics[key];
    }
    return null;
  };

  // ── OKR weekly trend table ───────────────────────────────────────────────────
  const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s);
  let trend = [];
  if (table1File) {
    const lines = fs.readFileSync(path.join(root, table1File), 'utf8').trim().split('\n');
    const header = parseLine(lines[0] || '');
    // Locate columns by header name (handles both snapshot and time-series formats)
    const idxTotal    = header.findIndex(h => /active users/i.test(h) && !/1p|intranet|custom/i.test(h));
    const idxFP       = header.findIndex(h => /1p active/i.test(h));
    const idxIntranet = header.findIndex(h => /intranet/i.test(h));
    const idxCustom   = header.findIndex(h => /custom agent/i.test(h));
    const col = (r, idx, fallback) => idx >= 0 ? r[idx] : r[fallback];

    if (isDate((parseLine(lines[1] || ''))[0])) {
      // Time-series format: first data column is a date
      const rows = lines.slice(1).map(l => parseLine(l)).filter(r => isDate(r[0]))
        .sort((a, b) => a[0].localeCompare(b[0]));
      trend = rows.map(r => ({
        date: r[0], totalWau: col(r, idxTotal, 1), firstPartyWau: col(r, idxFP, 2),
        aiIntranetWau: col(r, idxIntranet, 3), customAgentsWau: col(r, idxCustom, 4),
      }));
    } else if (lines.length >= 2) {
      // Snapshot format: single data row, no date column — extract date from filename
      const data = parseLine(lines[1] || '');
      const snapDate = (table1File.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || null;
      trend = [{
        date: snapDate, totalWau: col(data, idxTotal, 0), firstPartyWau: col(data, idxFP, 1),
        aiIntranetWau: col(data, idxIntranet, 2), customAgentsWau: col(data, idxCustom, 3),
      }];
    }
  }

  // ── Feature Split files (WAU Buckets, R28, R7) ───────────────────────────────
  const featureFiles = fs.readdirSync(root)
    .filter(f => /^ai-all-up-feature-.+\.csv$/.test(f))
    .sort().reverse();

  // Group by slug (strip timestamp suffix) — keep latest of each type
  const featureData = {};
  for (const file of featureFiles) {
    const m = file.match(/^ai-all-up-feature-(.+?)-(\d{4}-\d{2}-\d{2}T.+)\.csv$/);
    if (!m) continue;
    const slug = m[1];
    if (featureData[slug]) continue; // already have latest
    const rows = fs.readFileSync(path.join(root, file), 'utf8').trim().split('\n')
      .map(l => parseLine(l)).filter(r => r.length >= 2);
    if (!rows.length) continue;

    // Detect ECharts CSV (header: Date, Series1, Series2, ...)
    const isECharts = rows[0][0] === 'Date' && rows.length > 1;
    if (isECharts) {
      const header = rows[0];
      const dataRows = rows.slice(1);
      const latestRow = dataRows[dataRows.length - 1] || [];
      featureData[slug] = {
        file, rows, isECharts: true,
        header,
        latestDate: latestRow[0] || null,
        latestValues: header.slice(1).map((name, i) => ({ name, value: latestRow[i + 1] || '' })),
        trend: dataRows.map(r => ({ date: r[0], values: r.slice(1) })),
      };
    } else {
      featureData[slug] = { file, rows, isECharts: false };
    }
  }

  const latestTrend = trend[trend.length - 1] || {};

  return {
    hasData: true,
    headline: {
      mau:            findMetric('AI Usage', 'MAU') || findMetric('MAU'),
      wowRetention:   findMetric('Retention'),
      totalWau:       latestTrend.totalWau       || null,
      firstPartyWau:  latestTrend.firstPartyWau  || null,
      aiIntranetWau:  latestTrend.aiIntranetWau  || null,
      customAgentsWau: latestTrend.customAgentsWau || null,
      latestDate:     latestTrend.date           || null,
    },
    trend,
    featureData,
    metricsFile,
  };
}

// ── Skills ────────────────────────────────────────────────────────────────────

function loadSkills() {
  const S   = rel => csv(`skills/${rel}`);
  const dir = path.join(DATA, 'skills');
  if (!fs.existsSync(dir)) return { hasData: false };

  const ts = rows => {
    const maxTs = rows.map(r => r.scraped_at).filter(Boolean).sort().pop();
    return rows
      .map(r => ({ date: tsDate(r.__timestamp), v: n(r['Measure 1']) }))
      .filter(r => r.v && r.date !== '1970-01-01')
      .sort((a, b) => a.date.localeCompare(b.date));
  };

  const createdTrend = ts(S('number-of-skills-created.csv'));
  const usedTrend    = ts(S('number-of-times-a-skill-was-used.csv'));
  const usersTrend   = ts(S('skills-unique-active-users.csv'));

  const tenantsRaw = S('skills-adoption-across-tenants.csv');
  const maxTs = tenantsRaw.map(r => r.scraped_at).filter(Boolean).sort().pop();
  const tenantRows = tenantsRaw
    .filter(r => !maxTs || r.scraped_at === maxTs)
    .map(r => ({
      name:     r['Tenant Name']       || '',
      created:  n(r['Skills Created']),
      sites:    n(r['# sites with skills']),
      used:     n(r['Skills Used']),
      users:    n(r['Unique Users']),
    }))
    .filter(r => r.name)
    .sort((a, b) => b.users - a.users);

  // Tenant count growth — one point per snapshot date (dedupe by date, latest ts wins)
  const tenantSnapDates = {};
  for (const r of tenantsRaw) {
    if (!r.scraped_at || !r['Tenant Name']) continue;
    const date = r.scraped_at.slice(0, 10);
    if (!tenantSnapDates[date]) tenantSnapDates[date] = { ts: r.scraped_at, count: 0 };
    if (r.scraped_at >= tenantSnapDates[date].ts) {
      if (r.scraped_at > tenantSnapDates[date].ts) { tenantSnapDates[date] = { ts: r.scraped_at, count: 0 }; }
      tenantSnapDates[date].count++;
    }
  }
  const tenantGrowth = Object.entries(tenantSnapDates)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { count }]) => ({ date, v: count }));

  const latest = createdTrend[createdTrend.length - 1]?.date || '';

  return {
    hasData:       createdTrend.length > 0,
    headline: {
      skillsCreated:      createdTrend[createdTrend.length - 1]?.v || 0,
      skillsCreatedMax:   createdTrend.length ? Math.max(...createdTrend.map(r => r.v)) : 0,
      skillsCreatedTotal: createdTrend.reduce((s, r) => s + (r.v || 0), 0),
      skillsUsed:         usedTrend[usedTrend.length - 1]?.v    || 0,
      skillsUsedMax:      usedTrend.length ? Math.max(...usedTrend.map(r => r.v)) : 0,
      skillsUsedTotal:    usedTrend.reduce((s, r) => s + (r.v || 0), 0),
      activeUsers:        usersTrend[usersTrend.length - 1]?.v  || 0,
      activeUsersMax:     usersTrend.length ? Math.max(...usersTrend.map(r => r.v)) : 0,
    },
    createdTrend, usedTrend, usersTrend,
    tenantRows, tenantGrowth,
    latestDate: latest,
  };
}

// ── Skills Adoption (proof funnels) ───────────────────────────────────────────

const PROOF_LAYERS = [
  { key: 'Proof 1 - Solitary Explorer', label: 'Solitary Explorer', color: '#94a3b8' },
  { key: 'Proof 2 - Spread',            label: 'Spread',            color: '#0891B2' },
  { key: 'Proof 3 - Consumption',       label: 'Consumption',       color: '#107C41' },
  { key: 'Proof 4 - Habit',             label: 'Habit',             color: '#742774' },
];

const PROOF_DEFINITIONS = {
  'Solitary Explorer': 'All usage (creation + consumption) in the last 28 days comes from a single user.',
  'Spread':            '2+ distinct skill creators in the last 28 days.',
  'Consumption':       'A skill is used by someone other than its creator in the last 28 days. ⭐ key signal of organic uptake.',
  'Habit':             'Skills triggered 2+ times in the last 28 days.',
};

function buildProofTimeseries(rows, countCol) {
  // Group rows by scrape date. If multiple scrapes on the same day, keep the
  // latest scraped_at on that date (matches the tenantGrowth pattern in loadSkills).
  const byDate = {};
  for (const r of rows) {
    if (!r.scraped_at || !r.proof) continue;
    const date = r.scraped_at.slice(0, 10);
    if (!byDate[date]) byDate[date] = { ts: r.scraped_at, layers: {} };
    if (r.scraped_at > byDate[date].ts) byDate[date] = { ts: r.scraped_at, layers: {} };
    if (r.scraped_at === byDate[date].ts) byDate[date].layers[r.proof] = n(r[countCol]);
  }
  const dates = Object.keys(byDate).sort();
  const series = PROOF_LAYERS.map(L => ({
    layer:  L.label,
    proof:  L.key,
    color:  L.color,
    points: dates.map(d => ({ date: d, v: byDate[d].layers[L.key] || 0 })),
    latest: byDate[dates.at(-1)]?.layers[L.key] || 0,
  }));
  return { dates, series, latestDate: dates.at(-1) || '' };
}

function loadSkillsAdoption() {
  const dir = path.join(DATA, 'skills-adoption');
  if (!fs.existsSync(dir)) return { hasData: false, definitions: PROOF_DEFINITIONS };

  const tenantRows = csv('skills-adoption/tenant-adoption-of-skills.csv');
  const siteRows   = csv('skills-adoption/site-level-adoption-skills.csv');

  const tenants = buildProofTimeseries(tenantRows, 'tenant_count');
  const sites   = buildProofTimeseries(siteRows,   'site_count');

  return {
    hasData:     tenants.dates.length > 0 || sites.dates.length > 0,
    tenants,
    sites,
    definitions: PROOF_DEFINITIONS,
  };
}

// ── Skills ADX ────────────────────────────────────────────────────────────────

function loadSkillsAdx() {
  const dir = path.join(DATA, 'skills-adx');
  if (!fs.existsSync(dir)) return { hasData: false };

  const S = rel => csv(`skills-adx/${rel}`);

  // Latest snapshot helper — filters to the most recent non-empty snapshot.
  // Empty rows (all non-scraped_at fields blank) are skipped so a bad scrape
  // doesn't clobber the previous good data.
  const latestSnap = rows => {
    const hasData = r => Object.entries(r).some(([k, v]) => k !== 'scraped_at' && v !== '' && v != null);
    const nonEmpty = rows.filter(hasData);
    const src = nonEmpty.length > 0 ? nonEmpty : rows;
    const max = src.map(r => r.scraped_at).filter(Boolean).sort().pop();
    return max ? src.filter(r => r.scraped_at === max) : src;
  };

  // Pie / OOB
  const adoption     = latestSnap(S('skill-adoption.csv'))
    .map(r => ({ label: r.Status, value: n(r.Users) }));
  const distribution = latestSnap(S('skill-count-distribution.csv'))
    .map(r => ({ label: r.SkillBucket, value: n(r.Sessions) }));
  const oobPct       = latestSnap(S('oob-loaded-pct.csv'))
    .map(r => ({ label: r.name, value: n(r.value) }));

  // OOB overrides timeseries (may be empty while feature is new)
  const oobOverridesTs = S('oob-overrides-per-day.csv')
    .filter(r => r.TIMESTAMP)
    .map(r => ({ date: isoDate(r.TIMESTAMP), v: n(r.Overridden) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Prompt classification
  const promptRows = latestSnap(S('prompt-classification.csv'))
    .map(r => ({ cat: r.MainCategory, sub: r.SubCategory, count: n(r.PromptCount) }))
    .sort((a, b) => b.count - a.count);

  // Tool pivot matrix — one row per tool, one column per intent category
  const CATS = ['execute', 'ask', 'learn', 'create', 'catchup', 'chat'];
  const toolMap = {};
  for (const cat of CATS) {
    for (const r of latestSnap(S(`${cat}-tools.csv`))) {
      if (!r.Tool) continue;
      if (!toolMap[r.Tool]) toolMap[r.Tool] = {};
      toolMap[r.Tool][cat] = n(r.ToolCalls);
    }
  }
  const toolMatrix = Object.entries(toolMap)
    .map(([tool, vals]) => {
      const row = { tool, ...Object.fromEntries(CATS.map(c => [c, vals[c] || 0])) };
      row.total = CATS.reduce((s, c) => s + row[c], 0);
      return row;
    })
    .sort((a, b) => b.total - a.total);

  // Tool WoW trends — all snapshots, aggregate across intent categories
  // Dedupe per-cat per-date: each category file may have slightly different ms timestamps
  // so we pick the latest scraped_at independently for each (cat, date) pair.
  const trendMap = {};  // date -> { tool: totalCalls }
  for (const cat of CATS) {
    const catRows = S(`${cat}-tools.csv`).filter(r => r.Tool && r.scraped_at);
    // Find latest scraped_at per date for this cat
    const latestByDate = {};
    for (const r of catRows) {
      const date = r.scraped_at.slice(0, 10);
      if (!latestByDate[date] || r.scraped_at > latestByDate[date]) latestByDate[date] = r.scraped_at;
    }
    // Aggregate only the latest snapshot rows for each date
    for (const r of catRows) {
      const date = r.scraped_at.slice(0, 10);
      if (r.scraped_at !== latestByDate[date]) continue;
      if (!trendMap[date]) trendMap[date] = {};
      trendMap[date][r.Tool] = (trendMap[date][r.Tool] || 0) + n(r.ToolCalls);
    }
  }
  const trendDates = Object.keys(trendMap).sort();
  const latestTrendDate = trendDates[trendDates.length - 1];
  const top25Tools = latestTrendDate
    ? Object.entries(trendMap[latestTrendDate])
        .sort((a, b) => b[1] - a[1])
        .slice(0, 25)
        .map(([tool]) => tool)
    : [];
  const toolTrends = {
    dates: trendDates,
    tools: top25Tools.map(tool => ({
      tool,
      values: trendDates.map(d => trendMap[d]?.[tool] ?? null),
    })),
  };

  return {
    hasData:      adoption.length > 0 || toolMatrix.length > 0,
    adoption, distribution, oobPct, oobOverridesTs, promptRows, toolMatrix, toolTrends,
  };
}

// ── Makers ────────────────────────────────────────────────────────────────────

function loadMakers() {
  const M  = rel => csv(`makers/${rel}`);
  const end = arr => arr[arr.length - 1]?.v || 0;

  // ── All-Up SP Makers R28 timeseries (Explore /p/6XJKk6pRJzK/) ──────────────
  const allUpTrend = M('all-up/slice-59000.csv')
    .map(r => ({ date: tsDate(r.__timestamp), v: n(r['SP Makers']) }))
    .filter(r => r.v).sort((a, b) => a.date.localeCompare(b.date));

  const latestAllUp = end(allUpTrend);
  const prevAllUp   = allUpTrend.length > 28 ? allUpTrend[allUpTrend.length - 29].v : null;

  // ── Automations ─────────────────────────────────────────────────────────────
  const autoCreatedRaw  = M('automations/automations-created.csv');
  const autoCreatorRaw  = M('automations/automations-creator-mau.csv');
  const autoCreatedLast  = autoCreatedRaw[autoCreatedRaw.length - 1] || {};
  const autoCreatorLast  = autoCreatorRaw[autoCreatorRaw.length - 1] || {};
  const COL_MAU = 'Creator MAU (Rules, QuickSteps, Approvals) ';
  const automationsCreated = n(autoCreatedLast[COL_MAU]);
  const automationCreatorMau = n(autoCreatorLast[COL_MAU]);

  const creatorMauTrend = M('automations/creator-mau-time-series-rolling-window-28-days.csv')
    .map(r => ({ date: tsDate(r.__timestamp), v: n(r[COL_MAU]) }))
    .filter(r => r.v).sort((a, b) => a.date.localeCompare(b.date));

  // Sankey funnel data — grab latest snapshot row for each funnel
  const latestSnap = rows => {
    if (!rows.length) return {};
    const maxTs = rows.map(r => r.scraped_at).filter(Boolean).sort().pop();
    return rows.find(r => r.scraped_at === maxTs) || rows[rows.length - 1];
  };

  const f1 = latestSnap(M('automations/user-funnel-without-automations-hub.csv'));
  const f2 = latestSnap(M('automations/user-funnel-automations-hub.csv'));

  // Build Sankey edges: two parallel paths from "Automate Button" down to success
  const funnelSankey = [
    // ── Direct path (without Hub) ──────────────────────────────
    { from: 'Automate Button',        to: 'Direct: Create/Manage Rule', flow: n(f1['Users Clicking on Create/Manage Rule/QuickSteps/Rules Action ']) },
    { from: 'Direct: Create/Manage Rule', to: 'Shared: Create/Modify',  flow: n(f1['Users Clicking on Create/Modify a Rule/QuickStep/Forms**']) },
    { from: 'Shared: Create/Modify',  to: 'Automation Created',         flow: n(f1['Users successfully creating/modifying an automation']) },
    // ── Hub path ─────────────────────────────────────────────
    { from: 'Automate Button',        to: 'Hub: Open Automation Hub',   flow: n(f2['Users Clicking on Automation Hub Button']) },
    { from: 'Hub: Open Automation Hub', to: 'Hub: Create/Modify',       flow: n(f2['Users Clicking on Create/Modify a Rule/QuickStep/Forms**']) },
    { from: 'Hub: Create/Modify',     to: 'Automation Created',         flow: n(f2['Users successfully creating/modifying an automation']) },
  ].filter(e => e.flow > 0);

  // Combined entry point value (larger of the two; they measure same event)
  const automateButtonClicks = Math.max(
    n(f1['Users clicking on Automate Button']),
    n(f2['Users clicking on Automate Button'])
  );

  // ── Lists ────────────────────────────────────────────────────────────────────
  const listsMau = n((latestSnap(M('lists/main/lists-mau-aad.csv')))['[Lists AAD] MAU overall']);
  const listsEngaged = n((latestSnap(M('lists/main/lists-engaged-users-r28.csv')))['Lists Engaged Users']);
  const listsActiveLists = n((latestSnap(M('lists/main/active-lists-aad.csv')))['[Lists AAD] MAU overall']);

  const listsWauTrend = M('lists/main/lists-wau-aad.csv')
    .map(r => ({ date: tsDate(r.__timestamp), v: n(r['[Lists AAD] MAU overall']) }))
    .filter(r => r.v).sort((a, b) => a.date.localeCompare(b.date));

  const listsDauTrend = M('lists/main/lists-dau-aad.csv')
    .map(r => ({ date: tsDate(r.__timestamp), v: n(r['[Lists AAD] MAU overall']) }))
    .filter(r => r.v).sort((a, b) => a.date.localeCompare(b.date));

  const listsCreationTrend = M('lists/main/listsweb-daily-lists-creation.csv')
    .map(r => ({ date: tsDate(r.__timestamp), v: n(r['Lists Created']) }))
    .filter(r => r.v).sort((a, b) => a.date.localeCompare(b.date));

  // PowerApps Custom Forms MAU (timeseries — "Total PowerApps forms active users")
  const powerAppsMauTrend = M('lists/main/powerapps-custom-forms-mau.csv')
    .map(r => ({ date: tsDate(r.__timestamp), v: n(r['Total PowerApps forms active users']) }))
    .filter(r => r.v).sort((a, b) => a.date.localeCompare(b.date));

  // ── Lists Automation tab metrics ─────────────────────────────────────────────
  const autoSnap = name => n((latestSnap(M(`lists/automation/${name}`)))['Packaged Flow Install MAU']);
  const flowCompletedUsers  = autoSnap('of-users-who-completed-flow-setup-triggered-by-ootb-template.csv');
  const flowSetupsCompleted = autoSnap('of-flow-setups-completed-r28.csv');
  const flowCreationIntents = autoSnap('flow-creation-intents-from-integrate-menu-r28.csv');

  // ── Lists Columns tab metrics ─────────────────────────────────────────────────
  const quickStepsMau = n((latestSnap(M('lists/columns/quick-steps-maus.csv')))['Inline quick steps active users']);
  const colPercentilesRow = latestSnap(M('lists/columns/number-of-columns.csv'));
  const columnPercentiles = {
    p99: n(colPercentilesRow['P99']),
    p95: n(colPercentilesRow['P95 ']),
    p75: n(colPercentilesRow['P75']),
    p50: n(colPercentilesRow['P50']),
  };

  const columnTypeRows = latestSnap ? M('lists/columns/columns-edited-by-type-r28.csv') : [];
  const maxColTs = columnTypeRows.map(r => r.scraped_at).filter(Boolean).sort().pop();
  const columnTypes = columnTypeRows
    .filter(r => !maxColTs || r.scraped_at === maxColTs)
    .map(r => ({ type: r.event_name, users: n(r['Users']), events: n(r['Events']) }))
    .filter(r => r.users)
    .sort((a, b) => b.users - a.users);

  const latestDate = allUpTrend[allUpTrend.length - 1]?.date
    || listsWauTrend[listsWauTrend.length - 1]?.date
    || creatorMauTrend[creatorMauTrend.length - 1]?.date
    || '';

  return {
    hasData: allUpTrend.length > 0 || listsWauTrend.length > 0,
    headline: {
      spMakersR28:         latestAllUp,
      automationCreatorMau,
      automationsCreated,
      listsMau,
      listsEngaged,
      listsActiveLists,
      quickStepsMau,
      powerAppsMauLatest:  end(powerAppsMauTrend),
      automateButtonClicks,
      flowCompletedUsers,
      flowSetupsCompleted,
      flowCreationIntents,
      spMakersWow: prevAllUp ? +((latestAllUp - prevAllUp) / prevAllUp * 100).toFixed(1) : null,
    },
    allUpTrend,
    creatorMauTrend,
    listsWauTrend,
    listsDauTrend,
    listsCreationTrend,
    powerAppsMauTrend,
    funnelSankey,
    columnPercentiles,
    columnTypes,
    latestDate,
  };
}

// ── Autofill ──────────────────────────────────────────────────────────────────

function loadOcv() {
  const root  = path.join(DATA, 'ocv');
  const stamp = path.join(root, 'scraped-at.txt');
  if (!fs.existsSync(stamp)) return { hasData: false };
  const scrapedAt = fs.readFileSync(stamp, 'utf8').trim();

  const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

  const layouts = [
    { key: 'spark',       label: 'Copilot in SharePoint (KAv2)' },
    { key: 'ai-intranet', label: 'SharePoint AI Intranet'        },
  ];

  const dashboards = [];
  for (const l of layouts) {
    const dir = path.join(root, l.key);
    if (!fs.existsSync(dir)) continue;
    const trend       = readJson(path.join(dir, 'trend-daily.json'));
    const reliability = readJson(path.join(dir, 'reliability.json'));
    const cats        = readJson(path.join(dir, 'categories.json'));
    if (!trend) continue;

    // Reliability error rate: errorRate = total_errors / total_thumbs in the same window (R28)
    let reliabilitySummary = null;
    if (reliability?.dates?.length) {
      const errR28 = reliability.total.slice(-28).reduce((a, b) => a + b, 0);
      // Map trend totals (sat+dsat+other) onto same dates for ratio
      const totByDate = new Map();
      trend.series.dates.forEach((d, i) => totByDate.set(d, trend.series.total[i]));
      const overlapTotal = reliability.dates.slice(-28).reduce((a, d) => a + (totByDate.get(d) || 0), 0);
      reliabilitySummary = {
        title:       reliability.title,
        dates:       reliability.dates,
        errors:      reliability.total,
        errR28,
        thumbsR28:   overlapTotal,
        errorRateR28: overlapTotal ? +(100 * errR28 / overlapTotal).toFixed(2) : null,
      };
    }

    dashboards.push({
      key:        l.key,
      label:      l.label,
      headline:   trend.headline,
      trend:      trend.series,         // dates/dsat/sat/other/total/dailyTDR/r7TDR/r28TDR
      reliability: reliabilitySummary,
      categories: (cats?.items || []).filter(c => c.total >= 1),
    });
  }

  return { hasData: dashboards.length > 0, scrapedAt, dashboards };
}

function loadAutofill() {
  const dir    = path.join(DATA, 'autofill');
  const tsFile = path.join(dir, 'scraped-at.txt');
  if (!fs.existsSync(tsFile)) return { hasData: false };
  const scrapedAt = fs.readFileSync(tsFile, 'utf8').trim();

  const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
  const firstNonNull = series => series?.find(s => s.values?.some(v => v != null && v > 0)) ?? null;

  // Monthly PAYG pages usage trend — "AutoFillColumn" series
  let paygUsage = null;
  const paygRaw = readJson(path.join(dir, 'payg-usage.json'));
  if (paygRaw?.dates) {
    const s = firstNonNull(paygRaw.series);
    if (s) paygUsage = { dates: paygRaw.dates, values: s.values };
  }

  // Monthly KA pages usage trend — first non-null series (named "Year" in PBI export)
  let kaUsage = null;
  const kaRaw = readJson(path.join(dir, 'ka-usage.json'));
  if (kaRaw?.dates) {
    const s = firstNonNull(kaRaw.series);
    if (s) kaUsage = { dates: kaRaw.dates, values: s.values };
  }

  // Monthly PAYG tenant counts
  let paygTenants = null;
  const ptRaw = readJson(path.join(dir, 'payg-tenants.json'));
  if (ptRaw?.dates) {
    const s = firstNonNull(ptRaw.series);
    if (s) paygTenants = { dates: ptRaw.dates, values: s.values };
  }

  // Monthly KA tenant counts — first non-null series ("Year" in PBI export)
  let kaTenants = null;
  const ktRaw = readJson(path.join(dir, 'ka-tenants.json'));
  if (ktRaw?.dates) {
    const s = firstNonNull(ktRaw.series);
    if (s) kaTenants = { dates: ktRaw.dates, values: s.values };
  }

  // Yearly tenant counts table
  let yearlyTotals = {};
  let totalTenants = null;
  const ytRaw = readJson(path.join(dir, 'yearly-totals.json'));
  if (ytRaw) {
    const { headers = [], rows = [] } = ytRaw;
    const yearIdx = headers.findIndex(h => /year/i.test(h));
    const cntIdx  = headers.findIndex(h => /count|subscr/i.test(h));
    for (const row of rows) {
      const yr  = (row[yearIdx] ?? '').trim();
      const cnt = parseInt((row[cntIdx] ?? '').replace(/,/g, '')) || 0;
      if (yr === 'Total') totalTenants = cnt;
      else if (/^\d{4}$/.test(yr)) yearlyTotals[yr] = cnt;
    }
  }

  // Build yearly PAYG/KA split from monthly tenant-count data.
  // Use the MAX value for each year (peak month) as the yearly tenant count.
  const yearlyPayg = {}, yearlyKa = {};
  const maxByYear = (trend) => {
    if (!trend) return {};
    const byYear = {};
    trend.dates.forEach((d, i) => {
      const yr = d.slice(0, 4);
      const v  = trend.values[i] ?? 0;
      if (v > (byYear[yr] ?? 0)) byYear[yr] = v;
    });
    return byYear;
  };
  Object.assign(yearlyPayg, maxByYear(paygTenants));
  Object.assign(yearlyKa,   maxByYear(kaTenants));

  // Customer snapshot — row layout: [0]=checkbox [1]=date [2]=daily [3]=R7 [4]=R28 [5]=tenant [6]=siteId [7]=segment [8]=industry
  let customers  = [];
  let grandTotalR28 = null;
  const custRaw  = readJson(path.join(dir, 'customers.json'));
  if (custRaw) {
    for (const r of custRaw.rows) {
      if (/grand total/i.test(r[1] ?? '')) {
        grandTotalR28 = parseInt((r[4] ?? '').replace(/,/g, '')) || null;
        continue;
      }
      if (r.length < 6 || !r[5] || r[0] !== 'Select Row') continue;
      customers.push({
        tenant:   r[5],
        daily:    parseInt((r[2] ?? '').replace(/,/g, '')) || 0,
        r7:       parseInt((r[3] ?? '').replace(/,/g, '')) || 0,
        r28:      parseInt((r[4] ?? '').replace(/,/g, '')) || 0,
        segment:  r[7] ?? '',
        industry: r[8] ?? '',
      });
    }
    customers.sort((a, b) => b.r28 - a.r28);
  }

  const curMonthPrefix = new Date().toISOString().slice(0, 7);
  const lastCompleteVal = (vals, dates) => {
    if (!vals) return null;
    const pairs = vals.map((v, i) => [v, dates?.[i] ?? '']).filter(([v]) => v != null);
    const complete = pairs.filter(([, d]) => !d.startsWith(curMonthPrefix));
    const src = complete.length ? complete : pairs;
    return src.length ? src[src.length - 1][0] : null;
  };
  const kpis = {
    paygPages:    lastCompleteVal(paygUsage?.values,   paygUsage?.dates),
    kaPages:      lastCompleteVal(kaUsage?.values,     kaUsage?.dates),
    paygTenants:  lastCompleteVal(paygTenants?.values, paygTenants?.dates),
    kaTenants:    lastCompleteVal(kaTenants?.values,   kaTenants?.dates),
    totalTenants,
    y2026:        yearlyTotals['2026'] ?? null,
    y2025:        yearlyTotals['2025'] ?? null,
    grandTotalR28,
  };

  return {
    hasData: true, kpis,
    paygUsage, kaUsage, paygTenants, kaTenants,
    yearlyTotals, yearlyPayg, yearlyKa,
    customers, scrapedAt,
  };
}

// ── AI Reach ──────────────────────────────────────────────────────────────────

function loadAiReach() {
  const dir = path.join(DATA, 'ai-reach');
  const intranetFile = path.join(dir, 'intranet-reach.json');
  const docLibFile   = path.join(dir, 'doc-library-reach.json');

  const viewersFile = path.join(dir, 'viewers.json');  // legacy fallback
  const pagesFile   = path.join(dir, 'pages.json');    // legacy fallback

  if (!fs.existsSync(intranetFile) && !fs.existsSync(docLibFile) &&
      !fs.existsSync(viewersFile)  && !fs.existsSync(pagesFile)) return { hasData: false };

  const intranet   = fs.existsSync(intranetFile) ? JSON.parse(fs.readFileSync(intranetFile, 'utf8'))
                   : fs.existsSync(viewersFile)   ? JSON.parse(fs.readFileSync(viewersFile,  'utf8')) : null;
  const docLibrary = fs.existsSync(docLibFile)    ? JSON.parse(fs.readFileSync(docLibFile,   'utf8'))
                   : fs.existsSync(pagesFile)      ? JSON.parse(fs.readFileSync(pagesFile,    'utf8')) : null;

  const tsFile = path.join(dir, 'scraped-at.txt');
  const scrapedAt = fs.existsSync(tsFile) ? fs.readFileSync(tsFile, 'utf8').trim() : null;

  return { hasData: true, intranet, docLibrary, scrapedAt };
}

// ── COGS ──────────────────────────────────────────────────────────────────────

function loadCogs() {
  const dir = path.join(DATA, 'cogs');
  if (!fs.existsSync(dir)) return { hasData: false };

  const pricesFile = path.join(dir, 'prices.json');
  const metaFile   = path.join(dir, 'meta.json');
  const prices = fs.existsSync(pricesFile) ? JSON.parse(fs.readFileSync(pricesFile, 'utf8')) : { models: [] };
  const meta   = fs.existsSync(metaFile)   ? JSON.parse(fs.readFileSync(metaFile, 'utf8'))   : {};

  // Drop pricing rows that don't have all three rates set.
  const models = (prices.models || []).filter(m =>
    typeof m.input === 'number' && typeof m.cacheRead === 'number' && typeof m.output === 'number'
  );

  const envs = ['prod', 'dogfood'];
  const out  = { hasData: false, updatedAt: meta.lastRunAt || null, pricesUpdated: prices.updated || null, models, envs: {} };

  for (const env of envs) {
    const dailyFile  = path.join(dir, `spark-ka-daily-${env}.csv`);
    const recentFile = path.join(dir, `spark-ka-recent-${env}.csv`);
    if (!fs.existsSync(dailyFile)) {
      out.envs[env] = { hasData: false };
      continue;
    }

    // Daily rows: one per (date, surface).
    const rows = csv(`cogs/spark-ka-daily-${env}.csv`).map(r => ({
      date:          r.date,
      surface:       r.surface,
      sessions:      n(r.sessions),
      total_prompt:  n(r.total_prompt),
      cache_reads:   n(r.cache_reads),
      itokens:       n(r.itokens),
      output_tokens: n(r.output_tokens),
    })).filter(r => r.date);

    // Daily totals across surfaces, plus per-surface breakdowns.
    const byDate = new Map();
    const surfaces = ['SharePoint', 'OneDrive', 'OneUp'];
    for (const r of rows) {
      if (!byDate.has(r.date)) {
        byDate.set(r.date, { date: r.date, sessions: 0, itokens: 0, cache_reads: 0, output: 0, totalPrompt: 0,
          bySurface: Object.fromEntries(surfaces.map(s => [s, { sessions: 0, itokens: 0, cache_reads: 0, output: 0 }])) });
      }
      const d = byDate.get(r.date);
      d.sessions    += r.sessions;
      d.itokens     += r.itokens;
      d.cache_reads += r.cache_reads;
      d.output      += r.output_tokens;
      d.totalPrompt += r.total_prompt;
      if (d.bySurface[r.surface]) {
        d.bySurface[r.surface].sessions    += r.sessions;
        d.bySurface[r.surface].itokens     += r.itokens;
        d.bySurface[r.surface].cache_reads += r.cache_reads;
        d.bySurface[r.surface].output      += r.output_tokens;
      }
    }
    const dailyTotals = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));

    // Cost per day per model — uses current prices, so changing prices re-prices history.
    const costPerModel = {};
    for (const m of models) {
      costPerModel[m.id] = dailyTotals.map(d =>
        (d.itokens * m.input + d.cache_reads * m.cacheRead + d.output * m.output) / 1e6
      );
    }

    // 28-day rollup (Production-style "latest period" KPIs).
    const last28 = dailyTotals.slice(-28);
    const sum = key => last28.reduce((s, d) => s + d[key], 0);
    const period28 = {
      days:         last28.length,
      startDate:    last28[0]?.date || null,
      endDate:      last28[last28.length - 1]?.date || null,
      sessions:     sum('sessions'),
      itokens:      sum('itokens'),
      cache_reads:  sum('cache_reads'),
      output:       sum('output'),
      totalPrompt:  sum('totalPrompt'),
    };
    period28.cacheHitPct = period28.totalPrompt > 0
      ? +(100 * period28.cache_reads / period28.totalPrompt).toFixed(1)
      : 0;
    period28.costByModel = Object.fromEntries(models.map(m => [m.id,
      (period28.itokens * m.input + period28.cache_reads * m.cacheRead + period28.output * m.output) / 1e6
    ]));

    // Last-7-days surface × model cost matrix (the period summary from the skill).
    const last7 = dailyTotals.slice(-7);
    const week = {
      days:      last7.length,
      startDate: last7[0]?.date || null,
      endDate:   last7[last7.length - 1]?.date || null,
      surfaces:  {},
      total:     { sessions: 0, itokens: 0, cache_reads: 0, output: 0, costByModel: {} },
    };
    for (const s of surfaces) {
      let sessions = 0, itokens = 0, cache = 0, output = 0;
      for (const d of last7) {
        sessions += d.bySurface[s].sessions;
        itokens  += d.bySurface[s].itokens;
        cache    += d.bySurface[s].cache_reads;
        output   += d.bySurface[s].output;
      }
      const costByModel = Object.fromEntries(models.map(m => [m.id,
        (itokens * m.input + cache * m.cacheRead + output * m.output) / 1e6
      ]));
      week.surfaces[s] = { sessions, itokens, cache_reads: cache, output, costByModel };
      week.total.sessions    += sessions;
      week.total.itokens     += itokens;
      week.total.cache_reads += cache;
      week.total.output      += output;
    }
    week.total.costByModel = Object.fromEntries(models.map(m => [m.id,
      (week.total.itokens * m.input + week.total.cache_reads * m.cacheRead + week.total.output * m.output) / 1e6
    ]));

    // Recent percentile detail (last 14d).
    const recent = fs.existsSync(recentFile)
      ? csv(`cogs/spark-ka-recent-${env}.csv`).map(r => ({
          date:          r.date,
          surface:       r.surface,
          sessions:      n(r.sessions),
          itokens:       n(r.itokens),
          cache_reads:   n(r.cache_reads),
          cache_hit_pct: n(r.cache_hit_pct),
          avg_tpm:       n(r.avg_tpm),
          p50: n(r.p50), p75: n(r.p75), p90: n(r.p90),
          p95: n(r.p95), p99: n(r.p99), max_tpm: n(r.max_tpm),
        }))
      : [];

    out.envs[env] = {
      hasData: true,
      lastCompleteDay: meta.lastCompleteDay?.[env === 'prod' ? 'Production' : 'Dogfood'] || null,
      daily: dailyTotals.map(d => ({
        date: d.date, sessions: d.sessions,
        itokens: d.itokens, cache_reads: d.cache_reads, output: d.output,
        bySurface: d.bySurface,
      })),
      costPerModel,
      period28,
      week,
      recent,
    };
    out.hasData = true;
  }

  return out;
}

// ── Agent Comparison (IDEAS Copilot Cowork) ───────────────────────────────────
//
// Combines:
//   1. Scraped per-agent weekly time series from data/agent-comparison/
//      (one CSV per agent, columns: Date,WAU,AppType,scraped_at).
//   2. Three "injected" rows representing our own products, sourced from
//      data already in this dashboard:
//        • SPARK                  — kav2.wauTrend
//        • Copilot in SharePoint  — m365.spSubproducts[label="Copilot in SharePoint"]
//        • Copilot in OneDrive    — m365.spSubproducts[label="OneDrive All Up"]
//
// Output shape consumed by the UI:
//   {
//     scrapedAt, sourceUrl, latestDate,
//     dates: ['YYYY-MM-DD', ...],
//     agents: [
//       { name, slug, appType, injected,
//         latestWau, latestDate,
//         trend: [{date, wau}, ...],
//         alignedWau: [number|null, ...]   // 1:1 with dates[]
//       }, ...
//     ]
//   }

function loadAgentComparison(kav2, spSubproducts) {
  const dir = path.join(DATA, 'agent-comparison');
  const meta = (() => {
    const p = path.join(dir, '_agents.json');
    if (!fs.existsSync(p)) return null;
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
  })();
  if (!meta) {
    return { hasData: false, agents: [], dates: [] };
  }

  // ── 1. Load each scraped agent's CSV ──
  const scraped = meta.agents.map(m => {
    const rows = csv(`agent-comparison/${m.slug}.csv`);
    const trend = rows.map(r => ({ date: r.Date, wau: Math.round(n(r.WAU)) }))
                      .filter(r => r.date && r.wau >= 0)
                      .sort((a, b) => a.date.localeCompare(b.date));
    const last = trend[trend.length - 1] || {};
    return {
      name:      m.name,
      slug:      m.slug,
      appType:   m.appType || '',
      injected:  false,
      latestWau: last.wau ?? null,
      latestDate: last.date ?? null,
      trend,
    };
  }).filter(a => a.trend.length > 0);

  // ── 2. Build injected rows from existing sources ──
  function injected(name, sourceTrend) {
    // sourceTrend = [{date:'YYYY-MM-DD', wau:N}, ...]
    const trend = (sourceTrend || [])
      .map(r => ({ date: isoDate(r.date), wau: Math.round(n(r.wau ?? r.v)) }))
      .filter(r => r.date && r.wau >= 0)
      .sort((a, b) => a.date.localeCompare(b.date));
    const last = trend[trend.length - 1] || {};
    return {
      name,
      slug:      'injected-' + slugForCmp(name),
      appType:   'Ours',
      injected:  true,
      latestWau: last.wau ?? null,
      latestDate: last.date ?? null,
      trend,
    };
  }

  const sparkTrend = (kav2?.wauTrend || []).map(r => ({ date: r.date, wau: r.wau }));
  const spSubProd  = (spSubproducts || []).find(p => p.label === 'Copilot in SharePoint');
  const odSubProd  = (spSubproducts || []).find(p => p.label === 'OneDrive All Up');
  const spTrend    = (spSubProd?.wau?.trend || []).map(r => ({ date: r.date, wau: r.v }));
  const odTrend    = (odSubProd?.wau?.trend || []).map(r => ({ date: r.date, wau: r.v }));

  const injectedRows = [
    injected('SPARK',                sparkTrend),
    injected('Copilot in SharePoint', spTrend),
    injected('Copilot in OneDrive',   odTrend),
  ].filter(a => a.trend.length > 0);

  const allAgents = [...scraped, ...injectedRows];

  // ── 3. Compute a unified date axis (scraped axis) and align each series ──
  // We use the scraped data's dates as the canonical axis — those are the
  // ~daily-cadence rolling-7-day stamps the source dashboard uses. Each
  // injected series is forward/backward filled to the closest available
  // date in its own trend (sparse series snap to the nearest point).
  const datesSet = new Set();
  for (const a of scraped) for (const p of a.trend) datesSet.add(p.date);
  const dates = [...datesSet].sort();
  const latestDate = dates[dates.length - 1] || null;

  function alignToAxis(trend) {
    if (!trend.length) return dates.map(() => null);
    const sorted = [...trend].sort((a, b) => a.date.localeCompare(b.date));
    const out = new Array(dates.length).fill(null);
    let i = 0;
    for (let j = 0; j < dates.length; j++) {
      const target = dates[j];
      // advance i while sorted[i+1] is still <= target
      while (i + 1 < sorted.length && sorted[i + 1].date <= target) i++;
      const cur = sorted[i];
      // pick closest of cur and sorted[i+1]
      let pick = cur;
      if (i + 1 < sorted.length) {
        const next = sorted[i + 1];
        const dCur  = Math.abs(new Date(target) - new Date(cur.date));
        const dNext = Math.abs(new Date(next.date) - new Date(target));
        if (dNext < dCur) pick = next;
      }
      // Only use the pick if it's within 14 days (otherwise leave null)
      const gapDays = Math.abs(new Date(pick.date) - new Date(target)) / 86_400_000;
      out[j] = gapDays <= 14 ? pick.wau : null;
    }
    return out;
  }

  for (const a of allAgents) {
    a.alignedWau = alignToAxis(a.trend);
  }

  // Sort: injected rows first (they're our highlights), then scraped by latest WAU
  allAgents.sort((a, b) => {
    if (a.injected !== b.injected) return a.injected ? -1 : 1;
    return (b.latestWau || 0) - (a.latestWau || 0);
  });

  return {
    hasData:   true,
    scrapedAt: meta.scraped_at,
    sourceUrl: meta.source,
    latestDate,
    dates,
    agents:    allAgents,
  };
}

function slugForCmp(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('Generating dashboard data...');

const kav2          = loadKav2();
const workloads     = loadIdeas();
const spSubproducts = loadSpSubproducts();
const agentsIO      = loadAgentsIO();
const aiAllUp       = loadAiAllUp();
const skills          = loadSkills();
const skillsAdoption  = loadSkillsAdoption();
const skillsAdx       = loadSkillsAdx();
const makers        = loadMakers();
const aiReach       = loadAiReach();
const autofill      = loadAutofill();
const cogs          = loadCogs();
const agentComparison = loadAgentComparison(kav2, spSubproducts);
const ocv           = loadOcv();
const sparkTopTenants = loadSparkTopTenants();

const spWl    = workloads.find(w => w.slug === 'copilot-in-sharepoint');
const allUpWl = workloads.find(w => w.slug === 'm365-copilot-all-up');
const spPct   = allUpWl?.latestWau ? +((spWl.latestWau / allUpWl.latestWau) * 100).toFixed(2) : 0;
const ranked  = workloads.filter(w => w.slug !== 'm365-copilot-all-up').sort((a, b) => b.latestWau - a.latestWau);
const spRank  = ranked.findIndex(w => w.slug === 'copilot-in-sharepoint') + 1;

const output = {
  generatedAt: new Date().toISOString(),
  kav2,
  m365:     { workloads, spPctAllUp: spPct, spRank, rankedCount: ranked.length, spSubproducts },
  agentsIO,
  aiAllUp,
  skills,
  skillsAdoption,
  skillsAdx,
  makers,
  aiReach,
  autofill,
  cogs,
  agentComparison,
  ocv,
  sparkTopTenants,
};

const json = JSON.stringify(output, null, 2);
fs.writeFileSync(OUT_JSON, json);
fs.writeFileSync(OUT_JS, `window.DASHBOARD_DATA = ${json};\n`);

console.log('✅ dashboard-data.js + dashboard-data.json written');
console.log(`   KAv2 WAU:       ${kav2.headline.wau.toLocaleString()}  (${kav2.latestDate})`);
console.log(`   SP IDEAS WAU:   ${spWl?.latestWau?.toLocaleString()}`);
console.log(`   M365 All Up:    ${(allUpWl?.latestWau / 1e6).toFixed(1)}M`);
console.log(`   SP rank:        #${spRank} of ${ranked.length}`);
console.log(`   WoW growth:     ${kav2.growth.wow !== null ? kav2.growth.wow + '%' : 'N/A'}`);
console.log(`   Since launch:   +${kav2.growth.launch}%`);
console.log(`   Agents WAU:     ${agentsIO.hasData ? agentsIO.headline.wau.toLocaleString() : 'N/A'}  (${agentsIO.latestDate || '—'}) [IDEAS official]`);
console.log(`   Agents Avg DAU: ${agentsIO.hasData ? agentsIO.headline.dau.toLocaleString() : 'N/A'}  wo/ MSIT: ${agentsIO.ideas?.spo?.avgDau?.withoutMsit?.toLocaleString() ?? 'N/A'}`);
console.log(`   AI All-Up:      ${aiAllUp.hasData ? aiAllUp.trend.length + ' weeks (' + aiAllUp.metricsFile + ')' : 'no data (run scraper first)'}`);
console.log(`   SP Makers R28:  ${makers.headline.spMakersR28?.toLocaleString() || 'N/A'}  (${makers.latestDate})`);
console.log(`   List MAU:       ${makers.headline.listsMau?.toLocaleString() || 'N/A'}`);
console.log(`   AI Reach:       ${aiReach.hasData ? `Intranet=${aiReach.intranet?.dates?.length ?? 0}, DocLib=${aiReach.docLibrary?.dates?.length ?? 0} pts, latest ${aiReach.intranet?.dates?.slice(-1)[0] ?? aiReach.docLibrary?.dates?.slice(-1)[0] ?? '—'} (${aiReach.scrapedAt})` : 'no data (run scrape-ai-reach.js first)'}`);
console.log(`   Autofill:       ${autofill.hasData ? `PAYG pages=${(autofill.kpis.paygPages??0).toLocaleString()}, SPARK pages=${(autofill.kpis.kaPages??0).toLocaleString()}, totalTenants=${autofill.kpis.totalTenants?.toLocaleString()??'?'}, customers=${autofill.customers?.length??0}` : 'no data (run scrape-autofill.js first)'}`);
console.log(`   Agent Comp:     ${agentComparison.hasData ? `${agentComparison.agents.length} agents (incl. 3 injected) · ${agentComparison.dates.length} dates · latest ${agentComparison.latestDate}` : 'no data (run scrape-agent-comparison.js first)'}`);
console.log(`   OCV:            ${ocv.hasData ? ocv.dashboards.map(d => `${d.key} R28=${d.headline.r28TDR ?? '—'}%`).join(' · ') : 'no data (run scrape-ocv.js first)'}`);

// ── Source freshness audit ───────────────────────────────────────────────────
// For each scraper tracked in data/meta/scrape-log.json, print its
// last_scraped age in hours. Flag anything >24h with ⚠. This catches the
// "freshness guard skipped a scrape and a stale CSV leaked into a headline"
// failure mode (root cause of the SPARK WAU mislabel bug — the Growth
// Analytics Usage tab CSV was the stale source).
(function freshnessAudit() {
  const logPath = path.join(DATA, 'meta', 'scrape-log.json');
  let log;
  try { log = JSON.parse(fs.readFileSync(logPath, 'utf8')); }
  catch { console.log('\n⚠ scrape-log.json missing; skipping freshness audit'); return; }

  const now = Date.now();
  const entries = Object.entries(log)
    .map(([tab, e]) => {
      const ts = e?.last_scraped ? Date.parse(e.last_scraped) : NaN;
      const age = isNaN(ts) ? null : (now - ts) / 3_600_000;
      return { tab, age };
    })
    .sort((a, b) => (b.age ?? 0) - (a.age ?? 0));   // oldest first

  console.log('\n── Source freshness (data/meta/scrape-log.json) ───────────────');
  let stale = 0;
  for (const { tab, age } of entries) {
    if (age === null) {
      console.log(`   ? ${tab.padEnd(42)} unknown`);
    } else if (age > 24) {
      console.log(`   ⚠ ${tab.padEnd(42)} ${age.toFixed(1)}h old`);
      stale++;
    } else {
      console.log(`   ✓ ${tab.padEnd(42)} ${age.toFixed(1)}h old`);
    }
  }
  if (stale) {
    console.log(`\n   ${stale} source(s) older than 24h. Re-run with: node scrape-all.js --force`);
  }
})();

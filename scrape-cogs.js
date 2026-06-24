'use strict';

/**
 * scrape-cogs.js — incremental COGS (token cost) scraper for SPARK KA.
 *
 * Mirrors the spark-ka-cost skill (c:\repos\capacity\.claude\commands\spark-ka-cost.md)
 * but persists a small per-day aggregate locally so we can watch trends grow over
 * time without re-querying full history each run.
 *
 * Source:
 *   Cluster : https://inferencedashboardlog.westus2.kusto.windows.net
 *   DB      : LLMAPI
 *   Table   : LLMAPIRequestTracingEvent_Global
 *   Scenario: 120dbd4e-0c75-4a76-8601-1f991559b541  (SP Knowledge Agent)
 *   Surfaces: SharePoint / OneDrive / OneUp (via Tag.app)
 *   Envs    : Production + Dogfood (stored separately)
 *
 * Output (under data/cogs/):
 *   spark-ka-daily-prod.csv     — one row per (date, surface), full history
 *   spark-ka-daily-dogfood.csv  — one row per (date, surface), full history
 *   spark-ka-recent-prod.csv    — last 14d with percentile detail
 *   spark-ka-recent-dogfood.csv — last 14d with percentile detail
 *   meta.json                   — { lastRunAt, lastCompleteDay, scenarioGuid, ... }
 *
 * Incremental algorithm:
 *   1. Read meta.lastCompleteDay (default = today − 30d).
 *   2. Query Kusto for Day ∈ [lastCompleteDay − 2d, today)  (re-overlap last 2
 *      days to absorb late telemetry; "today" is partial → skip).
 *   3. Upsert into the daily CSV keyed by (date, surface) per env.
 *   4. Overwrite the recent CSV with the last 14 complete days.
 *   5. Bump meta.lastCompleteDay = max(date in store).
 *
 * Auth: DefaultAzureCredential (same pattern as fetch-user-intent.js — relies on
 * `az login`).
 */

const fs   = require('fs');
const path = require('path');
const { Client: KustoClient, KustoConnectionStringBuilder } = require('azure-kusto-data');
const { DefaultAzureCredential } = require('@azure/identity');

const CLUSTER       = 'https://inferencedashboardlog.westus2.kusto.windows.net';
const DATABASE      = 'LLMAPI';
const SCENARIO_GUID = '120dbd4e-0c75-4a76-8601-1f991559b541';
const OUT_DIR       = path.join(__dirname, 'data', 'cogs');
const META_FILE     = path.join(OUT_DIR, 'meta.json');
const BACKFILL_DAYS = 30;
const OVERLAP_DAYS  = 2;
const RECENT_DAYS   = 14;

const ENVS = {
  Production: `TagEnv == "Production" and ResolvedModelName startswith "prod-"`,
  Dogfood   : `TagEnv == "Dogfood" or (isempty(TagEnv) and ResolvedModelName startswith "dev-")`,
};

const DAILY_COLS = [
  'date', 'surface', 'sessions',
  'total_prompt', 'cache_reads', 'itokens', 'output_tokens',
];

const RECENT_COLS = [
  'date', 'surface', 'sessions',
  'total_prompt', 'cache_reads', 'itokens', 'output_tokens',
  'avg_tpm', 'p50', 'p75', 'p90', 'p95', 'p99', 'max_tpm',
  'cache_hit_pct',
];

// ── small CSV helpers (compatible with parseLine in generate-dashboard-data.js)

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

function readCsv(file) {
  if (!fs.existsSync(file)) return [];
  const txt = fs.readFileSync(file, 'utf8').trim();
  if (!txt) return [];
  const lines = txt.split(/\r?\n/);
  if (lines.length < 2) return [];
  const hdr = parseLine(lines[0]);
  return lines.slice(1).map(l => {
    const v = parseLine(l); const o = {};
    hdr.forEach((h, i) => { o[h] = v[i] ?? ''; });
    return o;
  });
}

function writeCsv(file, cols, rows) {
  const lines = [cols.join(',')];
  for (const r of rows) {
    lines.push(cols.map(c => {
      const v = r[c];
      if (v == null) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(','));
  }
  fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8');
}

// ── date helpers

function isoDay(d)        { return d.toISOString().slice(0, 10); }
function addDays(d, n)    { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; }
function todayUtcMidnight() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// ── kusto query

function buildQuery(envClause, startIso, endIso) {
  return `
let startTime = datetime(${startIso});
let endTime   = datetime(${endIso});
let kaGuid    = '${SCENARIO_GUID}';
LLMAPIRequestTracingEvent_Global
| where TIMESTAMP >= startTime and TIMESTAMP < endTime
| where ScenarioGuid == kaGuid
| extend TagBag   = todynamic(Tag)
| extend TagEnv   = tostring(TagBag['env'])
| where ${envClause}
| extend AppRaw   = tostring(TagBag['app'])
| extend AppGroup = case(
    AppRaw contains 'OneDrive', 'OneDrive',
    AppRaw contains 'SharePoint', 'SharePoint',
    AppRaw == 'OneUp', 'OneUp',
    'Other'
  )
| where AppGroup in ('OneDrive', 'SharePoint', 'OneUp')
| extend Day      = bin(TIMESTAMP, 1d)
| extend iTokens  = PromptTokenCount - CachedPromptTokenCount
| summarize
    SessionITokens  = sum(iTokens),
    SessionPrompt   = sum(PromptTokenCount),
    SessionCache    = sum(CachedPromptTokenCount),
    SessionOutput   = sum(CompletionTokenCount)
  by Day, AppGroup, SessionId
| summarize
    Sessions        = count(),
    TotalPrompt     = sum(SessionPrompt),
    TotalCacheReads = sum(SessionCache),
    TotaliTokens    = sum(SessionITokens),
    TotalOutput     = sum(SessionOutput),
    AvgTPM          = round(avg(SessionITokens)),
    P50             = round(percentile(SessionITokens, 50)),
    P75             = round(percentile(SessionITokens, 75)),
    P90             = round(percentile(SessionITokens, 90)),
    P95             = round(percentile(SessionITokens, 95)),
    P99             = round(percentile(SessionITokens, 99)),
    MaxTPM          = max(SessionITokens)
  by Day, AppGroup
| extend CacheHitPct = round(100.0 * TotalCacheReads / iff(TotalPrompt > 0, TotalPrompt, 1), 1)
| order by AppGroup asc, Day asc
`.trim();
}

function rowFromKusto(r) {
  // Column order matches the `summarize ... by Day, AppGroup` + extend above.
  const get = (name) => r[name];
  return {
    date:           isoDay(new Date(get('Day'))),
    surface:        String(get('AppGroup')),
    sessions:       Number(get('Sessions') || 0),
    total_prompt:   Number(get('TotalPrompt') || 0),
    cache_reads:    Number(get('TotalCacheReads') || 0),
    itokens:        Number(get('TotaliTokens') || 0),
    output_tokens:  Number(get('TotalOutput') || 0),
    avg_tpm:        Number(get('AvgTPM') || 0),
    p50:            Number(get('P50') || 0),
    p75:            Number(get('P75') || 0),
    p90:            Number(get('P90') || 0),
    p95:            Number(get('P95') || 0),
    p99:            Number(get('P99') || 0),
    max_tpm:        Number(get('MaxTPM') || 0),
    cache_hit_pct:  Number(get('CacheHitPct') || 0),
  };
}

async function runQuery(client, env) {
  const today = todayUtcMidnight();
  const meta  = readMeta();
  const lastDay = meta.lastCompleteDay?.[env]
    ? new Date(meta.lastCompleteDay[env] + 'T00:00:00Z')
    : addDays(today, -BACKFILL_DAYS);

  const start0 = addDays(lastDay, -OVERLAP_DAYS);
  // Always cover at least the last RECENT_DAYS so percentile snapshot stays fresh.
  const recentStart = addDays(today, -RECENT_DAYS);
  const start = start0 < recentStart ? start0 : recentStart;
  const end   = today; // exclusive — skip partial "today"

  const startIso = isoDay(start);
  const endIso   = isoDay(end);
  console.log(`[cogs:${env}] querying ${startIso} → ${endIso} (exclusive)`);

  const q = buildQuery(ENVS[env], startIso, endIso);
  const resp = await client.execute(DATABASE, q);
  const table = resp.primaryResults[0];

  const rows = [];
  for (const r of table.rows()) {
    const obj = {};
    table.columns.forEach((c, i) => { obj[c.name] = r.getValueAt(i); });
    rows.push(rowFromKusto(obj));
  }
  console.log(`[cogs:${env}] ${rows.length} (date,surface) rows returned`);
  return { rows, startIso, endIso };
}

// ── store I/O

function readMeta() {
  if (!fs.existsSync(META_FILE)) return { lastCompleteDay: {} };
  try { return JSON.parse(fs.readFileSync(META_FILE, 'utf8')); }
  catch { return { lastCompleteDay: {} }; }
}

function writeMeta(meta) {
  fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2) + '\n', 'utf8');
}

const ENV_SLUG = { Production: 'prod', Dogfood: 'dogfood' };

function dailyFile(env)  { return path.join(OUT_DIR, `spark-ka-daily-${ENV_SLUG[env]}.csv`); }
function recentFile(env) { return path.join(OUT_DIR, `spark-ka-recent-${ENV_SLUG[env]}.csv`); }

function upsertDaily(env, newRows, overlapStartIso) {
  const file = dailyFile(env);
  const existing = readCsv(file);
  // Drop any existing rows in the overlap window — fresh data wins.
  const kept = existing.filter(r => r.date < overlapStartIso);
  const merged = [...kept, ...newRows.map(r => ({
    date:          r.date,
    surface:       r.surface,
    sessions:      r.sessions,
    total_prompt:  r.total_prompt,
    cache_reads:   r.cache_reads,
    itokens:       r.itokens,
    output_tokens: r.output_tokens,
  }))];
  merged.sort((a, b) => a.date.localeCompare(b.date) || a.surface.localeCompare(b.surface));
  writeCsv(file, DAILY_COLS, merged);
  console.log(`[cogs:${env}] daily store: ${merged.length} rows (was ${existing.length})`);
  return merged;
}

function writeRecent(env, newRows) {
  // Recent window = last RECENT_DAYS complete days from the freshest date returned.
  if (!newRows.length) {
    writeCsv(recentFile(env), RECENT_COLS, []);
    return;
  }
  const maxDate = newRows.reduce((m, r) => r.date > m ? r.date : m, newRows[0].date);
  const cutoff = isoDay(addDays(new Date(maxDate + 'T00:00:00Z'), -(RECENT_DAYS - 1)));
  const recent = newRows
    .filter(r => r.date >= cutoff)
    .sort((a, b) => a.date.localeCompare(b.date) || a.surface.localeCompare(b.surface));
  writeCsv(recentFile(env), RECENT_COLS, recent);
  console.log(`[cogs:${env}] recent store: ${recent.length} rows (last ${RECENT_DAYS}d)`);
}

// ── main

async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('[cogs] connecting to Kusto…');
  const kcsb = KustoConnectionStringBuilder.withTokenCredential(CLUSTER, new DefaultAzureCredential());
  const client = new KustoClient(kcsb);

  const meta = readMeta();
  meta.lastCompleteDay = meta.lastCompleteDay || {};
  meta.scenarioGuid    = SCENARIO_GUID;

  try {
    for (const env of Object.keys(ENVS)) {
      const { rows, startIso, endIso } = await runQuery(client, env);
      const merged = upsertDaily(env, rows, startIso);
      writeRecent(env, rows);

      // lastCompleteDay = the most recent date now in the daily store
      // (which equals the day before "today" if data arrived for it).
      if (merged.length) {
        meta.lastCompleteDay[env] = merged.reduce(
          (m, r) => r.date > m ? r.date : m, merged[0].date
        );
      }
      console.log(`[cogs:${env}] lastCompleteDay → ${meta.lastCompleteDay[env]}`);
      void endIso;
    }

    meta.lastRunAt = new Date().toISOString();
    writeMeta(meta);
    console.log(`[cogs] ✅ done — meta written to ${path.relative(__dirname, META_FILE)}`);
  } finally {
    client.close();
  }
}

main().catch(err => {
  console.error('[cogs] ERROR:', err.stack || err.message || err);
  process.exit(1);
});

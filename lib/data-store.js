'use strict';

/**
 * lib/data-store.js
 *
 * Persistent incremental data store for scraped dashboard metrics.
 *
 * Layout:
 *   data/
 *     {tab-path}/
 *       {chart-slug}.csv      — one file per chart, grows over time
 *     meta/
 *       scrape-log.json       — last-scraped timestamps + row counts per tab
 *
 * Two storage modes:
 *
 *   Timeseries (charts with a __timestamp column — big numbers, line charts):
 *     Deduplicates by the time column value. The most recent scrape wins for
 *     the current (incomplete) period. Rows are kept sorted by time.
 *     Columns: [...original cols, scraped_at]
 *
 *   Snapshot (distributions, tables — no time column):
 *     Each scrape appends a dated block. Reporting reads the latest scraped_at.
 *     Columns: [scraped_at, ...original cols]
 */

const fs   = require('fs');
const path = require('path');

const DATA_DIR  = path.join(__dirname, '..', 'data');
const META_FILE = path.join(DATA_DIR, 'meta', 'scrape-log.json');

// ── Path helpers ──────────────────────────────────────────────────────────────

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Convert dashboard / tab names to a store path segment.
 * e.g. ('KAv2 Growth Analytics', 'Usage') → 'kav2-growth-analytics/usage'
 *      ('KAv2', null)                      → 'kav2'
 */
function tabToPath(topTabName, subTabName = null) {
  return subTabName ? `${slug(topTabName)}/${slug(subTabName)}` : slug(topTabName);
}

/** Chart title → safe filename slug (max 60 chars). */
function chartToSlug(title) {
  return slug(title).slice(0, 60);
}

function chartFilePath(tabPath, chartTitle) {
  const dir = path.join(DATA_DIR, tabPath);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${chartToSlug(chartTitle)}.csv`);
}

// ── CSV read / write ──────────────────────────────────────────────────────────

function readCsv(filePath) {
  if (!fs.existsSync(filePath)) return { colnames: [], rows: [] };
  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n').filter(Boolean);
  if (lines.length === 0) return { colnames: [], rows: [] };
  const colnames = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map(line => {
    const vals = parseCsvLine(line);
    return Object.fromEntries(colnames.map((c, i) => [c, vals[i] ?? '']));
  });
  return { colnames, rows };
}

function parseCsvLine(line) {
  const result = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) {
      result.push(cur); cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur);
  return result;
}

function writeCsv(filePath, colnames, rows) {
  const esc = v => {
    const s = String(v ?? '');
    return (s.includes(',') || s.includes('"') || s.includes('\n'))
      ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [colnames.map(esc).join(',')];
  for (const row of rows) lines.push(colnames.map(c => esc(row[c] ?? '')).join(','));
  fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf8');
}

// ── Upsert — timeseries ───────────────────────────────────────────────────────

/**
 * Merge new rows into the chart's timeseries CSV.
 * Deduplicates on `timeCol`; newest scraped value wins for each timestamp.
 *
 * @returns {{ added, updated, unchanged, total }}
 */
function upsertTimeseries(tabPath, chartTitle, colnames, rows, timeCol) {
  const filePath = chartFilePath(tabPath, chartTitle);
  const scrapedAt = new Date().toISOString();
  const allCols = colnames.includes('scraped_at') ? colnames : [...colnames, 'scraped_at'];

  const { rows: existing } = readCsv(filePath);
  const byKey = Object.fromEntries(existing.map(r => [r[timeCol], r]));

  let added = 0, updated = 0, unchanged = 0;

  for (const row of rows) {
    const key = row[timeCol];
    if (key === undefined || key === null || key === '') continue;

    const incoming = Object.fromEntries(
      allCols.map(c => [c, c === 'scraped_at' ? scrapedAt : String(row[c] ?? '')])
    );

    if (!byKey[key]) {
      byKey[key] = incoming;
      added++;
    } else {
      const changed = colnames.some(
        c => c !== timeCol && c !== 'scraped_at' && byKey[key][c] !== String(row[c] ?? '')
      );
      if (changed) { byKey[key] = { ...byKey[key], ...incoming }; updated++; }
      else unchanged++;
    }
  }

  const sorted = Object.values(byKey).sort((a, b) =>
    String(a[timeCol]).localeCompare(String(b[timeCol]))
  );
  writeCsv(filePath, allCols, sorted);

  return { added, updated, unchanged, total: sorted.length };
}

// ── Append — snapshots ────────────────────────────────────────────────────────

/**
 * Append a dated block of rows to a snapshot CSV.
 * Used for distributions, tables — anything without a timestamp axis.
 *
 * @returns {{ added }}
 */
function appendSnapshot(tabPath, chartTitle, colnames, rows) {
  const filePath = chartFilePath(tabPath, chartTitle);
  const scrapedAt = new Date().toISOString();
  const allCols = ['scraped_at', ...colnames.filter(c => c !== 'scraped_at')];

  const { rows: existing } = readCsv(filePath);
  const newRows = rows.map(r => ({ scraped_at: scrapedAt, ...r }));

  writeCsv(filePath, allCols, [...existing, ...newRows]);
  return { added: rows.length };
}

// ── Scrape log ────────────────────────────────────────────────────────────────

function readLog() {
  try {
    fs.mkdirSync(path.dirname(META_FILE), { recursive: true });
    return JSON.parse(fs.readFileSync(META_FILE, 'utf8'));
  } catch { return {}; }
}

function writeLog(log) {
  fs.mkdirSync(path.dirname(META_FILE), { recursive: true });
  fs.writeFileSync(META_FILE, JSON.stringify(log, null, 2) + '\n', 'utf8');
}

/**
 * Return true if this tab needs a fresh scrape.
 * @param {number} minAgeHours  Minimum hours since last scrape before re-scraping (default 20).
 */
function shouldScrape(tabPath, minAgeHours = 6) {
  const entry = readLog()[tabPath];
  if (!entry?.last_scraped) return true;
  const ageH = (Date.now() - new Date(entry.last_scraped).getTime()) / 3_600_000;
  return ageH >= minAgeHours;
}

/** Record a successful scrape completion for a tab. */
function recordScrapeTime(tabPath, stats = {}) {
  const log = readLog();
  log[tabPath] = { last_scraped: new Date().toISOString(), ...stats };
  writeLog(log);
}

/** Return the Date of last successful scrape, or null. */
function getLastScrapeTime(tabPath) {
  const entry = readLog()[tabPath];
  return entry?.last_scraped ? new Date(entry.last_scraped) : null;
}

// ── Read helpers (used by reporting skills) ───────────────────────────────────

/**
 * Read a timeseries CSV (sorted oldest→newest).
 * @param {{ limit?: number }} options  Pass limit to get only the last N rows.
 */
function readTimeseries(tabPath, chartTitle, { limit } = {}) {
  const filePath = chartFilePath(tabPath, chartTitle);
  const { colnames, rows } = readCsv(filePath);
  return {
    colnames,
    rows: limit ? rows.slice(-limit) : rows,
    filePath,
    scrapedAt: rows.at(-1)?.scraped_at ?? null,
  };
}

/**
 * Read the most recent snapshot block for a chart (highest scraped_at group).
 */
function readLatestSnapshot(tabPath, chartTitle) {
  const filePath = chartFilePath(tabPath, chartTitle);
  const { colnames, rows } = readCsv(filePath);
  if (!rows.length) return { colnames, rows: [], scrapedAt: null, filePath };
  const latest = rows.reduce((m, r) => (r.scraped_at > m ? r.scraped_at : m), '');
  return {
    colnames,
    rows: rows.filter(r => r.scraped_at === latest),
    scrapedAt: latest,
    filePath,
  };
}

/**
 * List all charts stored under a tab path.
 * Returns array of { chartTitle (derived from filename), filePath }.
 */
function listCharts(tabPath) {
  const dir = path.join(DATA_DIR, tabPath);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.csv'))
    .map(f => ({ slug: f.replace('.csv', ''), filePath: path.join(dir, f) }));
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  // Path helpers
  tabToPath,
  chartToSlug,
  chartFilePath,
  // Write
  upsertTimeseries,
  appendSnapshot,
  // Scrape-skip logic
  shouldScrape,
  recordScrapeTime,
  getLastScrapeTime,
  // Read (for reporting)
  readTimeseries,
  readLatestSnapshot,
  listCharts,
  // Constants
  DATA_DIR,
};

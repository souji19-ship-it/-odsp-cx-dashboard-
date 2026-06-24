'use strict';

/**
 * scrape-all.js — parallel orchestrator for every dashboard scraper.
 *
 * Runs all scrapers concurrently, grouped by class:
 *   • browser : Nezha/Superset/Power BI scrapers (driven via Edge CDP).
 *               Capped by --browser-concurrency (default 4) so Edge stays
 *               responsive and the Superset backend isn't hammered.
 *   • rest    : Direct REST/Kusto scrapers (no browser). Run all in parallel.
 *
 * Order of operations:
 *   1. Pre-warm Edge + Nezha SSO via lib/cdp-connect (one-time auth).
 *   2. Fan-out the REST scrapers immediately.
 *   3. Fan-out the browser scrapers behind a concurrency limit.
 *   4. Wait for everything, then run generate-dashboard-data.js.
 *
 * Output: each child's stdout/stderr is line-prefixed with [tag] so the
 * interleaved log stays readable.
 *
 * Usage:
 *   node scrape-all.js                    # default concurrency
 *   node scrape-all.js --browser-concurrency=3
 *   node scrape-all.js --only=kav2,makers # run subset by tag
 *   node scrape-all.js --skip=ai-reach    # exclude tags
 *   node scrape-all.js --sequential       # disable parallelism (for debugging)
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

// Path for persisted per-tag duration stats (used for LPT scheduling + ETAs).
const STATS_FILE = path.join(__dirname, '.scrape-stats.json');

// Hardcoded fallback estimates (seconds). Used when no stat is yet persisted
// for a tag. Sourced from the skill doc + historical runs.
const FALLBACK_DURATION_SEC = {
  makers: 780, kav2: 600, skills: 480, 'all-up': 420,
  'skills-adx': 300, 'ai-reach': 180, autofill: 180, ocv: 180,
  'agent-comp': 180, 'ext-api': 120,
  'ideas-sp': 60, 'ideas-m365': 60, 'user-intent': 60, cogs: 60,
};

function loadStats() {
  try { return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')); }
  catch { return {}; }
}
function saveStats(stats) {
  try { fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2)); }
  catch {}
}
function estimateSec(tag, stats) {
  // EWMA-style: if we have a persisted value, prefer it; else use fallback.
  if (stats[tag]?.lastDurationSec) return stats[tag].lastDurationSec;
  return FALLBACK_DURATION_SEC[tag] ?? 300;
}

const SCRAPERS = [
  { tag: 'kav2',         script: 'scrape-kav2-full.js',            kind: 'browser' },
  { tag: 'tenant-dd',    script: 'scrape-tenant-deep-dive.js',     kind: 'browser' },
  { tag: 'all-up',       script: 'scrape-all-dashboards.js',       kind: 'browser' },
  { tag: 'makers',       script: 'scrape-makers.js',               kind: 'browser' },
  { tag: 'skills',       script: 'scrape-skills.js',               kind: 'browser' },
  { tag: 'skills-adx',   script: 'scrape-skills-adx.js',           kind: 'browser' },
  { tag: 'ai-reach',     script: 'scrape-ai-reach.js',             kind: 'browser' },
  { tag: 'autofill',     script: 'scrape-autofill.js',             kind: 'browser' },
  { tag: 'agent-comp',   script: 'scrape-agent-comparison.js',    kind: 'browser' },
  { tag: 'ext-api',      script: 'scrape-extensibility-api.js',    kind: 'browser' },
  { tag: 'ocv',          script: 'scrape-ocv.js',                  kind: 'browser' },
  { tag: 'ideas-sp',     script: 'scrape-ideas-sp-subproducts.js', kind: 'rest'    },
  { tag: 'ideas-m365',   script: 'scrape-ideas-metrics.js',        kind: 'rest'    },
  { tag: 'user-intent',  script: 'fetch-user-intent.js',           kind: 'rest'    },
  { tag: 'cogs',         script: 'scrape-cogs.js',                 kind: 'rest'    },
];

// ── CLI args ──────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const getArg = (flag, def) => {
  const a = argv.find(x => x.startsWith(`${flag}=`));
  return a ? a.split('=')[1] : def;
};
const hasFlag = flag => argv.includes(flag);

const BROWSER_CONCURRENCY = parseInt(getArg('--browser-concurrency', '5'), 10);
const NO_RETRY = hasFlag('--no-retry');
const NO_DASHBOARD_PREWARM = hasFlag('--no-dashboard-prewarm');
// --force / --fresh: override every scraper's MIN_SCRAPE_AGE_HOURS to 0 so
// the run always re-pulls data, regardless of how recently it was scraped.
// Useful when you ran the scrape command specifically because you want
// today's numbers (which is essentially always).
const FORCE = hasFlag('--force') || hasFlag('--fresh');
const ONLY = (getArg('--only', '') || '').split(',').filter(Boolean);
const SKIP = (getArg('--skip', '') || '').split(',').filter(Boolean);
const SEQUENTIAL = hasFlag('--sequential');
const SKIP_GENERATE = hasFlag('--skip-generate');

let plan = SCRAPERS;
if (ONLY.length) plan = plan.filter(s => ONLY.includes(s.tag));
if (SKIP.length) plan = plan.filter(s => !SKIP.includes(s.tag));

// LPT (Longest Processing Time first) scheduling — sort browser scrapers by
// estimated duration descending so the long tail starts immediately and
// short jobs slot into the gaps. Minimises makespan.
const STATS = loadStats();
{
  const byKind = { browser: [], rest: [] };
  for (const s of plan) (byKind[s.kind] || (byKind[s.kind] = [])).push(s);
  byKind.browser.sort((a, b) => estimateSec(b.tag, STATS) - estimateSec(a.tag, STATS));
  // Keep REST scrapers in array order (unbounded concurrency — order irrelevant)
  plan = [...byKind.browser, ...byKind.rest];
}

// ── ANSI colors per tag (cosmetic only; works fine without TTY) ──────────────

const COLORS = [36, 33, 32, 35, 34, 31, 96, 93, 92, 95]; // cyan, yellow, green, magenta, blue, red, etc.
const colorFor = (() => {
  const map = new Map();
  let i = 0;
  return tag => {
    if (!map.has(tag)) { map.set(tag, COLORS[i % COLORS.length]); i++; }
    return map.get(tag);
  };
})();
const prefix = tag => `\x1b[${colorFor(tag)}m[${tag.padEnd(10)}]\x1b[0m`;

// ── Concurrency limiter ──────────────────────────────────────────────────────

function makeLimiter(concurrency) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= concurrency || queue.length === 0) return;
    const { fn, resolve, reject } = queue.shift();
    active++;
    Promise.resolve()
      .then(fn)
      .then(v => { active--; resolve(v); next(); },
            e => { active--; reject(e); next(); });
  };
  return fn => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    next();
  });
}

// ── Per-scraper timeout ──────────────────────────────────────────────────────
//
// Cap how long any single scraper may run before we kill it. This protects the
// orchestrator from one hung child blocking Promise.all for an unbounded time
// (we've seen children stay alive 45+ minutes after their work was complete
// because a dangling Playwright CDP socket kept the event loop pinned).
//
// Override per-tag with env vars: SCRAPE_TIMEOUT_<TAG_UPPER>_MIN=30
const DEFAULT_TIMEOUT_MIN = {
  browser: 20,    // browser scrapers — slowest is makers (~13 min)
  rest:    10,
};

function timeoutMinutesFor({ tag, kind }) {
  const envKey = `SCRAPE_TIMEOUT_${tag.toUpperCase().replace(/-/g, '_')}_MIN`;
  const override = parseInt(process.env[envKey] || '', 10);
  if (!isNaN(override) && override > 0) return override;
  return DEFAULT_TIMEOUT_MIN[kind] ?? 15;
}

// ── Child process runner ─────────────────────────────────────────────────────

function runScraper({ tag, script, kind }) {
  return new Promise((resolve) => {
    const started = Date.now();
    console.log(`${prefix(tag)} ▶ starting ${script}`);

    const child = spawn(process.execPath, [path.join(__dirname, script)], {
      cwd: __dirname,
      env: {
        ...process.env,
        // --force / --fresh propagates as MIN_SCRAPE_AGE_HOURS=0 so every
        // child bypasses its freshness guard.
        ...(FORCE ? { MIN_SCRAPE_AGE_HOURS: '0' } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let skipped = false;  // set when child prints "↷ Skipping" — surfaces in summary

    const pipe = (stream) => {
      const rl = readline.createInterface({ input: stream });
      rl.on('line', line => {
        if (line.includes('↷ Skipping')) skipped = true;
        // Strip pre-existing ANSI to keep our color prefix consistent.
        process.stdout.write(`${prefix(tag)} ${line}\n`);
      });
    };
    pipe(child.stdout);
    pipe(child.stderr);

    // Heartbeat: print a "still running" line every 60s so the user sees
    // progress even when a scraper goes quiet (e.g. waiting on a slow panel).
    const heartbeat = setInterval(() => {
      const mins = ((Date.now() - started) / 60000).toFixed(1);
      process.stdout.write(`${prefix(tag)} ⏳ still running (${mins} min elapsed)\n`);
    }, 60_000);

    // Watchdog: kill the child if it hasn't exited within its budget. The
    // dashboard generator (`tag === 'generate'`) gets no kind/timeout — fall
    // through to the default in timeoutMinutesFor.
    const timeoutMin = kind ? timeoutMinutesFor({ tag, kind }) : 15;
    const watchdog = setTimeout(() => {
      console.log(`${prefix(tag)} ⏱  exceeded ${timeoutMin} min — killing child`);
      try { child.kill('SIGKILL'); } catch {}
    }, timeoutMin * 60 * 1000);

    child.on('close', (code, signal) => {
      clearTimeout(watchdog);
      clearInterval(heartbeat);
      const dur = ((Date.now() - started) / 1000).toFixed(1);
      const killed = signal === 'SIGKILL';
      const ok = code === 0 && !killed;
      const mark = ok ? (skipped ? '↷' : '✅') : '❌';
      const tail = killed ? ` (killed by watchdog)` : ` exited ${code}`;
      console.log(`${prefix(tag)} ${mark}${tail} after ${dur}s`);
      resolve({ tag, script, code, ok, killed, skipped, durationSec: +dur });
    });
  });
}

// Wrap runScraper with one auto-retry on failure. Many scraper failures are
// transient (login redirect race, Power BI iframe slow load) and recover on
// a fresh child. Disable with --no-retry.
async function runScraperWithRetry(s) {
  const first = await runScraper(s);
  if (first.ok || NO_RETRY) return first;
  console.log(`${prefix(s.tag)} 🔁 retrying once after failure`);
  const second = await runScraper(s);
  // Tag the result so summary can show "retried"
  second.retried = true;
  second.firstAttempt = { code: first.code, killed: first.killed, durationSec: first.durationSec };
  return second;
}

// ── Pre-warm: ensure Edge + Nezha auth before fan-out ────────────────────────

// Additional SSO surfaces beyond Nezha. Each is opened in its own tab during
// pre-warm so the user is prompted to sign in to *all* required sites upfront
// (not lazily, mid-scrape, where it's easy to miss and hangs an individual
// scraper for ~45 minutes before it times out).
//
// `needsTags` lists which scraper tags drive traffic to the surface — we skip
// the probe if none of those scrapers are in the current plan.
const SSO_SURFACES = [
  {
    name: 'Power BI (msit)',
    // Landing on a real report URL means Power BI runs its full SSO redirect
    // (login.microsoftonline.com → app.powerbi.com → msit.powerbi.com) and
    // primes the cookies the AI Reach / Autofill scrapers rely on.
    probeUrl: 'https://msit.powerbi.com/home',
    needsTags: ['ai-reach', 'autofill'],
  },
  {
    name: 'OCV (ocv.microsoft.com)',
    probeUrl: 'https://ocv.microsoft.com/',
    needsTags: ['ocv'],
  },
  {
    name: 'AskIdeas (askideas.microsoft.net)',
    probeUrl: 'https://askideas.microsoft.net/',
    needsTags: ['agent-comp', 'ext-api'],
  },
];

// URL substrings that indicate a sign-in flow is in progress.
const LOGIN_HOST_MARKERS = [
  'login.microsoftonline.com',
  'login.microsoft.com',
  'login.live.com',
  'login.windows.net',
  '/login/',           // generic OAuth/Superset login pages
  '/oauth2/',
];

function looksLikeLoginUrl(url) {
  return LOGIN_HOST_MARKERS.some(m => url.includes(m));
}

/**
 * Try to auto-click the @microsoft.com account tile on the MSAL account
 * picker. Returns true if a click landed, false otherwise. Non-fatal.
 *
 * The MSAL picker renders tiles like:
 *   <div data-test-id="tile">zachros@microsoft.com</div>
 * If the user has multiple cached accounts, we pick the @microsoft.com one.
 */
async function tryClickMicrosoftAccountTile(page) {
  const selectors = [
    'div[data-test-id="tile"]:has-text("@microsoft.com")',
    'div.tile:has-text("@microsoft.com")',
    '[role="button"]:has-text("@microsoft.com")',
    'button:has-text("@microsoft.com")',
    'a:has-text("@microsoft.com")',
  ];
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
        await el.click({ force: true, timeout: 3000 });
        return true;
      }
    } catch {}
  }
  // Last-ditch: any element containing the email text
  try {
    await page.getByText('@microsoft.com').first().click({ timeout: 1500, force: true });
    return true;
  } catch {}
  return false;
}

/**
 * Open a probe URL in its own tab and wait until the page lands somewhere
 * that is NOT a sign-in flow. If we're still on a login page after a short
 * grace period, try to auto-click the @microsoft.com tile. Only if that also
 * fails do we print an ACTION REQUIRED message and wait for the user.
 */
async function primeSsoSurface(context, { name, probeUrl }) {
  const page = await context.newPage();
  await page.bringToFront().catch(() => {});
  console.log(`  → ${name}: opening ${probeUrl}`);

  try {
    await page.goto(probeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
      .catch(() => { /* may redirect through MSAL; ignore nav errors */ });
  } catch { /* ignore */ }

  // Short grace period for cached-SSO instant redirects.
  const graceMs = 5000;
  const graceUntil = Date.now() + graceMs;
  while (Date.now() < graceUntil) {
    if (!looksLikeLoginUrl(page.url())) break;
    await page.waitForTimeout(500);
  }

  if (!looksLikeLoginUrl(page.url())) {
    console.log(`  ✓ ${name}: authenticated`);
    await page.close().catch(() => {});
    return true;
  }

  // Still on login — try auto-clicking the account tile. Many MSAL pickers
  // just need one click to proceed with the cached @microsoft.com account.
  for (let attempt = 0; attempt < 3; attempt++) {
    const clicked = await tryClickMicrosoftAccountTile(page);
    if (clicked) {
      console.log(`  → ${name}: auto-clicked @microsoft.com account tile`);
      // Wait for redirect off the login page
      try {
        await page.waitForURL(u => !looksLikeLoginUrl(u), { timeout: 20000 });
        console.log(`  ✓ ${name}: authenticated (auto)`);
        await page.close().catch(() => {});
        return true;
      } catch {
        // Tile click didn't move us — maybe another tile/step appeared
        await page.waitForTimeout(1500);
      }
    } else {
      break;
    }
  }

  if (!looksLikeLoginUrl(page.url())) {
    console.log(`  ✓ ${name}: authenticated`);
    await page.close().catch(() => {});
    return true;
  }

  // Auto-click failed — fall back to user prompt.
  console.log('');
  console.log('  ╔══════════════════════════════════════════════════════════╗');
  console.log(`  ║  🔒 SIGN-IN REQUIRED: ${name.padEnd(34, ' ')}║`);
  console.log('  ║  An Edge tab has been opened for this site.              ║');
  console.log('  ║  Please complete sign-in there to continue.              ║');
  console.log('  ╚══════════════════════════════════════════════════════════╝');

  const manualTimeoutMs = 5 * 60 * 1000;
  const deadline = Date.now() + manualTimeoutMs;
  while (Date.now() < deadline) {
    if (!looksLikeLoginUrl(page.url())) {
      console.log(`  ✓ ${name}: sign-in complete`);
      await page.close().catch(() => {});
      return true;
    }
    await page.waitForTimeout(1000);
  }

  console.log(`  ⚠ ${name}: sign-in not completed within 5 min — scraper will retry on its own`);
  await page.close().catch(() => {});
  return false;
}

// Heavy Nezha dashboards whose Superset queries take minutes to execute.
// During pre-warm we open these in background tabs so Superset's server-side
// query cache is warm by the time the actual scraper runs. The scraper does
// its own page.goto() — it benefits because the underlying SQL is already
// cached/in-flight server-side.
//
// Fire-and-forget: we do NOT block the scraper fan-out on these.
// Disable with --no-dashboard-prewarm.
const DASHBOARD_PREWARM = [
  {
    tag: 'kav2',
    url: 'https://www.microsoftnezha.com/nezha/dashboard/a82f4c8e-6f29-4402-8fa1-c0af49a5132d/' +
         '?native_filters_key=iOIcu0pfBE05BLfowV8-q5iq1KeUnErct0NSidwW-ANMHTtA0GKIlMh2lZR8fpA3',
  },
  {
    tag: 'all-up',
    url: 'https://www.microsoftnezha.com/nezha/dashboard/3682/' +
         '?native_filters_key=4v6f3MjgDkrMxW-fLhldqrEPg1MV5f5cpEM2ohbwLXWwHNe8swZovIj1P5xmVvpN',
  },
  {
    tag: 'skills',
    url: 'https://www.microsoftnezha.com/nezha/dashboard/7082/' +
         '?native_filters_key=eQ56XXFTXV8sk_ZBoFFj7lvsSsubQzRrdx_FyoyhWDFbUMIOho9oQb2XnBR4aeYW',
  },
  {
    tag: 'makers-automations',
    url: 'https://www.microsoftnezha.com/nezha/dashboard/3611/' +
         '?native_filters_key=NkpQHvY6Rk5g2X5gghrA0bZb-ycyEj4Z6rAjY3pjkhRs6mt4E1SSPRgJvWd2frPW',
  },
  {
    tag: 'makers-lists',
    url: 'https://www.microsoftnezha.com/nezha/dashboard/1814/' +
         '?native_filters_key=2uT9jcgQ0saAtOVoz5WE_7OAg1lRjeamBcfCEnMLn0T1je89FNElUT4yMF_E1DIb',
  },
];

/**
 * Open a heavy dashboard URL in a background tab so Superset starts executing
 * (and caching) its queries. We wait for network to settle, then close. The
 * server-side cache stays warm — when the actual scraper navigates to the
 * same URL minutes later, queries return instantly.
 *
 * Errors are non-fatal — if a pre-warm tab fails, the scraper still runs.
 */
async function primeDashboard(context, { tag, url }) {
  const t0 = Date.now();
  let page;
  try {
    page = await context.newPage();
    // Don't bring to front — we don't want to steal focus from the user.
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    // Wait for Superset to finish issuing queries. networkidle = 500ms of no
    // network activity. Cap at 4 min — by then the cache is warm enough.
    await page.waitForLoadState('networkidle', { timeout: 240_000 }).catch(() => {});
    const dur = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`  ✓ dashboard ${tag}: warm (${dur}s)`);
  } catch (e) {
    const dur = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`  ⚠ dashboard ${tag}: prewarm error after ${dur}s (non-fatal): ${e.message}`);
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

async function prewarmEdgeAndAuth() {
  // Only worth doing if any browser-class scraper is in the plan.
  if (!plan.some(s => s.kind === 'browser')) return;

  console.log('── Pre-warming Edge + SSO surfaces ──────────────────────────');
  console.log('  Opening every site that may need sign-in upfront, so you');
  console.log('  can handle all auth prompts before the scrapers fan out.\n');

  const { connectToEdge } = require('./lib/cdp-connect');
  const { ensureLoggedIn } = require('./lib/nezha-auth');

  const { browser, context, page } = await connectToEdge();

  // 1. Nezha — has its own interactive auth helper (handles /login/ + tile picker).
  const NEZHA_PROBE = 'https://www.microsoftnezha.com/nezha/dashboard/';
  const nezhaOk = await ensureLoggedIn(page, NEZHA_PROBE).catch(e => {
    console.log(`  ⚠ Nezha pre-warm failed (non-fatal, scrapers will retry): ${e.message}`);
    return false;
  });
  await page.close().catch(() => {});
  if (nezhaOk) console.log('  ✓ Nezha cookies primed');

  // 2. Other SSO surfaces — open each in its own tab IN PARALLEL and prompt
  //    user if needed. Running these concurrently means one round of clicks
  //    instead of waiting on each in sequence.
  const planTags = new Set(plan.map(s => s.tag));
  const relevant = SSO_SURFACES.filter(s => s.needsTags.some(t => planTags.has(t)));
  await Promise.all(relevant.map(surface =>
    primeSsoSurface(context, surface).catch(e => {
      console.log(`  ⚠ ${surface.name}: pre-warm error (non-fatal): ${e.message}`);
      return false;
    })
  ));

  // 3. Heavy dashboard pre-warm — fire-and-forget. We start these in the
  //    background and return immediately so scrapers can begin. By the time
  //    a scraper actually issues queries, Superset's cache is warm.
  if (!NO_DASHBOARD_PREWARM && nezhaOk) {
    const relevantDashboards = DASHBOARD_PREWARM.filter(d => {
      // Match dashboard tag to scraper tag (e.g. "makers-lists" → "makers").
      const scraperTag = d.tag.split('-')[0];
      return planTags.has(d.tag) || planTags.has(scraperTag);
    });
    if (relevantDashboards.length) {
      console.log(`  → kicking off ${relevantDashboards.length} dashboard pre-warm tab(s) (background, non-blocking)`);
      // Track for cleanup at end of main()
      global.__dashboardPrewarmPromises = relevantDashboards.map(d =>
        primeDashboard(context, d).catch(() => {})
      );
    }
  }

  // NOTE: we deliberately do NOT close the browser here — fire-and-forget
  // dashboard pre-warm tabs need the connection to stay alive. The browser
  // (and the orchestrator process) are forcibly torn down via process.exit()
  // at the end of main().
  global.__prewarmBrowser = browser;

  console.log('');
}

// ── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  const t0 = Date.now();
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║          Parallel scrape orchestrator                      ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`Plan: ${plan.map(s => s.tag).join(', ')}`);
  console.log(`Browser concurrency: ${SEQUENTIAL ? 1 : BROWSER_CONCURRENCY}`);
  console.log(`REST concurrency:    ${SEQUENTIAL ? 1 : 'unbounded'}`);
  if (FORCE) console.log(`Force mode:          ON — MIN_SCRAPE_AGE_HOURS=0 for all children`);
  console.log('');

  try {
    await prewarmEdgeAndAuth();
  } catch (e) {
    console.log(`Pre-warm error (continuing): ${e.message}\n`);
  }

  const browserLimit = makeLimiter(SEQUENTIAL ? 1 : BROWSER_CONCURRENCY);
  const restLimit    = makeLimiter(SEQUENTIAL ? 1 : plan.length || 1);

  const promises = plan.map(s => {
    const limit = s.kind === 'browser' ? browserLimit : restLimit;
    return limit(() => runScraperWithRetry(s));
  });

  const results = await Promise.all(promises);

  // Persist successful durations for next run's LPT scheduling.
  for (const r of results) {
    if (r.ok && r.durationSec > 0) {
      STATS[r.tag] = { lastDurationSec: r.durationSec, lastRunAt: new Date().toISOString() };
    }
  }
  saveStats(STATS);

  // ── Summary ────────────────────────────────────────────────────────────────
  const totalSec = ((Date.now() - t0) / 1000).toFixed(1);
  const failures = results.filter(r => !r.ok);

  console.log('\n────────────────────────────────────────────────────────────');
  console.log(`Scrape summary — total wall time ${totalSec}s`);
  console.log('────────────────────────────────────────────────────────────');
  for (const r of results.sort((a, b) => b.durationSec - a.durationSec)) {
    const mark = r.ok ? (r.skipped ? '↷' : '✅') : '❌';
    const retryTag  = r.retried ? (r.ok ? ' (recovered on retry)' : ' (failed on retry)') : '';
    const skipTag   = r.skipped ? ' (skipped — data fresh, no new scrape)' : '';
    console.log(`  ${mark} ${r.tag.padEnd(12)} ${r.durationSec.toFixed(1).padStart(6)}s   ${r.script}${retryTag}${skipTag}`);
  }
  const skippedCount = results.filter(r => r.skipped).length;
  if (skippedCount) {
    console.log(`\n${skippedCount} scraper(s) skipped due to freshness guard.`);
    console.log(`  Re-run with --force (or --fresh) to bypass all guards.`);
  }
  if (failures.length) {
    console.log(`\n${failures.length} scraper(s) failed: ${failures.map(f => f.tag).join(', ')}`);
  }

  // ── Regenerate dashboard data ──────────────────────────────────────────────
  if (!SKIP_GENERATE) {
    console.log('\n── Regenerating dashboard-data ──────────────────────────────');
    const gen = await runScraper({ tag: 'generate', script: 'generate-dashboard-data.js' });
    if (!gen.ok) process.exitCode = 1;
  }

  if (failures.length) process.exitCode = 1;

  // Close the CDP socket from prewarm if it's still around (kept alive for
  // fire-and-forget dashboard pre-warm tabs).
  if (global.__prewarmBrowser) {
    try { await global.__prewarmBrowser.close(); } catch {}
  }

  // Belt-and-braces: even after browser.close(), some Playwright workers or
  // dangling sockets can keep the event loop alive. Force exit.
  process.exit(process.exitCode || 0);
})();

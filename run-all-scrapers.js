'use strict';

/**
 * run-all-scrapers.js
 *
 * Parallel scrape orchestrator. Launches all browser scrapers simultaneously
 * (each gets its own tab via connectToEdge → context.newPage()), plus all
 * API-only scrapers concurrently. Report generation and email run after.
 *
 * Usage:
 *   node run-all-scrapers.js
 *   SEND_EMAIL=1 node run-all-scrapers.js
 *   FORCE=1 node run-all-scrapers.js        # bypass freshness guards
 *   MIN_SCRAPE_AGE_HOURS=0 node run-all-scrapers.js
 */

const { spawn, execSync } = require('child_process');
const { chromium } = require('playwright');
const { ensureEdgeRunning, CDP_URL } = require('./lib/cdp-connect');
const { ensureLoggedIn } = require('./lib/nezha-auth');

// ── Scraper definitions ───────────────────────────────────────────────────────

// Each browser scraper opens its own new tab via connectToEdge()
const BROWSER_SCRAPERS = [
  { name: 'kav2+fab+ai-allup', script: 'scrape-all-dashboards.js'        },
  { name: 'extensibility-api', script: 'scrape-extensibility-api.js'     },  // IDEAS Official SPO agents (replaces scrape-agents-io.js)
  { name: 'makers',            script: 'scrape-makers.js'                },
  { name: 'ai-reach',          script: 'scrape-ai-reach.js'              },
  { name: 'autofill',          script: 'scrape-autofill.js'              },
  { name: 'skills',            script: 'scrape-skills.js'                },
  { name: 'skills-adx',        script: 'scrape-skills-adx.js'           },
];

// No browser needed — pure API calls, run in parallel with browser scrapers
const API_SCRAPERS = [
  { name: 'ideas-sp',     script: 'scrape-ideas-sp-subproducts.js' },
  { name: 'ideas-m365',   script: 'scrape-ideas-metrics.js'        },
  { name: 'user-intent',  script: 'fetch-user-intent.js'           },
];

// ── Process runner ────────────────────────────────────────────────────────────

function spawnScript(name, script) {
  const label    = `[${name}]`.padEnd(22);
  const startMs  = Date.now();

  return new Promise(resolve => {
    const child = spawn('node', [script], {
      cwd: __dirname,
      env: process.env,
      windowsHide: true,
    });

    child.stdout.on('data', data => {
      data.toString().split('\n').forEach(line => {
        if (line.trim()) process.stdout.write(`${label} ${line}\n`);
      });
    });

    child.stderr.on('data', data => {
      data.toString().split('\n').forEach(line => {
        if (line.trim()) process.stderr.write(`${label} ${line}\n`);
      });
    });

    child.on('close', code => {
      const elapsedS = Math.round((Date.now() - startMs) / 1000);
      resolve({ name, script, code, elapsedS });
    });

    child.on('error', err => {
      process.stderr.write(`${label} ERROR starting process: ${err.message}\n`);
      resolve({ name, script, code: 1, elapsedS: 0 });
    });
  });
}

// ── Nezha auth pre-warm ───────────────────────────────────────────────────────

/**
 * Navigate one page to Nezha and complete SSO if needed.
 * The resulting session cookie is stored in the browser profile and will be
 * sent automatically by all subsequent new pages in the same context,
 * letting those pages skip the SSO flow entirely.
 */
async function warmNezhaAuth() {
  console.log('Pre-warming Nezha auth...');
  let browser, page;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    const context = browser.contexts()[0] ?? await browser.newContext();
    page = await context.newPage();
    const ok = await ensureLoggedIn(page, 'https://www.microsoftnezha.com/nezha/');
    if (ok) {
      console.log('✓ Nezha session established\n');
    } else {
      console.log('⚠️  Nezha auth incomplete — browser may need manual login\n');
    }
  } catch (e) {
    console.log(`⚠️  Nezha pre-warm skipped: ${e.message}\n`);
  } finally {
    await page?.close().catch(() => {});
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const totalStart = Date.now();

  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║              Parallel Dashboard Scraper                       ║');
  console.log(`║  ${BROWSER_SCRAPERS.length} browser + ${API_SCRAPERS.length} API scrapers → parallel                     ║`);
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log(`Started: ${new Date().toLocaleString()}\n`);

  // Ensure Edge is running before browser scrapers try to connect
  await ensureEdgeRunning();
  // Establish Nezha session once so parallel Nezha scrapers skip SSO
  await warmNezhaAuth();
  console.log('Spawning all scrapers in parallel...\n');

  const allScrapers = [...BROWSER_SCRAPERS, ...API_SCRAPERS];
  const results = await Promise.all(
    allScrapers.map(({ name, script }) => spawnScript(name, script))
  );

  // ── Scraper summary ───────────────────────────────────────────────────────
  const scrapeElapsed = Math.round((Date.now() - totalStart) / 1000);
  console.log('\n' + '═'.repeat(65));
  console.log('SCRAPER RESULTS');
  console.log('═'.repeat(65));

  let failures = 0;
  for (const r of results) {
    const ok = r.code === 0;
    if (!ok) failures++;
    const marker = ok ? '✓' : '✗';
    console.log(`  ${marker} ${r.name.padEnd(22)} ${String(r.elapsedS).padStart(4)}s  (exit ${r.code})`);
  }
  console.log(`\n  Wall-clock scrape time: ${scrapeElapsed}s (${Math.round(scrapeElapsed / 60)}m)`);

  if (failures === allScrapers.length) {
    console.error('\n❌ Every scraper failed — aborting before report generation');
    process.exit(1);
  }

  // ── Report generation ─────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(65));
  console.log('REPORT GENERATION');
  console.log('═'.repeat(65));

  const reportResult = await spawnScript('report', 'generate-sharepoint-ai-report.js');
  if (reportResult.code !== 0) {
    console.error('\n❌ Report generation failed — skipping email');
    process.exit(1);
  }

  await spawnScript('report-fab', 'generate-fab-report.js');

  // ── Email ─────────────────────────────────────────────────────────────────
  if (process.env.SEND_EMAIL === '1') {
    console.log('\n' + '═'.repeat(65));
    console.log('SENDING EMAIL');
    console.log('═'.repeat(65));
    try {
      execSync('powershell -ExecutionPolicy Bypass -File send-report-email.ps1', {
        cwd: __dirname,
        stdio: 'inherit',
      });
      console.log('✓ Email sent');
    } catch (e) {
      console.error('⚠️  Email failed:', e.message);
    }
  }

  const totalElapsed = Math.round((Date.now() - totalStart) / 1000);
  console.log(`\n✅ Total time: ${totalElapsed}s (${Math.round(totalElapsed / 60)}m)\n`);
}

main().catch(e => {
  console.error('Fatal orchestrator error:', e);
  process.exit(1);
});

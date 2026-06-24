'use strict';

/**
 * lib/cdp-connect.js
 *
 * CDP connection model mirrored from sharepoint-ai-demos/tools/run-demo.mjs.
 *
 * Flow:
 *   1. checkCdpAvailable() — HTTP GET /json/version with 2 s timeout
 *   2. If not available → findEdgePath() + spawn Edge with debug port
 *   3. Poll every 600 ms for up to 15 s until CDP responds
 *   4. chromium.connectOverCDP(CDP_URL)
 *
 * User-data-dir:  %LOCALAPPDATA%\MSFTReportingEdge
 *   — Separate from the user's normal Edge profile so both can coexist.
 *   — Persists login cookies across reboots (unlike %TEMP%\edge-debug).
 *   — Override with the CDP_USER_DATA_DIR env var if needed.
 */

const { chromium } = require('playwright');
const { get: httpGet } = require('http');
const { existsSync, mkdirSync } = require('fs');
const { spawn } = require('child_process');
const path = require('path');

// Playwright fires this when Edge auto-dismisses a dialog (e.g. "Leave site?")
// before Playwright's internal handler can call Page.handleJavaScriptDialog.
// The scrape has already finished by the time this fires — suppress it.
process.on('unhandledRejection', (err) => {
  if (err?.method === 'Page.handleJavaScriptDialog') return;
  throw err;
});

const CDP_URL = process.env.CDP_URL || 'http://localhost:9223';

// Persistent profile dir — keeps logins alive between scraper runs
const DEFAULT_USER_DATA_DIR = path.join(
  process.env.LOCALAPPDATA || path.join(require('os').homedir(), 'AppData', 'Local'),
  'MSFTReportingEdge'
);
const USER_DATA_DIR = process.env.CDP_USER_DATA_DIR || DEFAULT_USER_DATA_DIR;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Ensure Edge is running with --remote-debugging-port, then return a
 * connected Playwright browser + the page to use.
 *
 * @returns {Promise<{ browser: import('playwright').Browser,
 *                     page:    import('playwright').Page }>}
 */
async function connectToEdge() {
  await ensureEdgeRunning();

  console.log(`Connecting to Edge via CDP (${CDP_URL})...`);
  const browser = await chromium.connectOverCDP(CDP_URL);

  const context = browser.contexts()[0] ?? await browser.newContext();
  const page    = await context.newPage();

  await page.bringToFront().catch(() => {});
  return { browser, context, page };
}

// ── Edge lifecycle ────────────────────────────────────────────────────────────

/** HTTP GET /json/version — resolves to true if Edge is listening. */
function checkCdpAvailable() {
  return new Promise(resolve => {
    const u   = new URL(CDP_URL);
    const req = httpGet(
      { hostname: u.hostname, port: +u.port || 9223, path: '/json/version', timeout: 2000 },
      res => { resolve(res.statusCode < 400); res.resume(); }
    );
    req.on('error',   () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

/** Locate msedge.exe — checks LOCALAPPDATA then the two standard install paths. */
function findEdgePath() {
  const candidates = [
    process.env.LOCALAPPDATA &&
      path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);
  return candidates.find(p => existsSync(p)) ?? null;
}

/**
 * If CDP is already available, return immediately.
 * Otherwise find Edge, spawn it with the debug port, and poll until ready.
 */
async function ensureEdgeRunning() {
  if (await checkCdpAvailable()) {
    console.log('Edge CDP already available.');
    return;
  }

  console.log('Edge not detected on CDP port — launching Edge with remote debugging...');

  const edgePath = findEdgePath();
  if (!edgePath) {
    throw new Error(
      'msedge.exe not found. Launch Edge manually:\n' +
      `  msedge.exe --remote-debugging-port=9223 --user-data-dir="${USER_DATA_DIR}"`
    );
  }

  // Ensure the user-data-dir exists (Edge will also create it, but be explicit)
  if (!existsSync(USER_DATA_DIR)) mkdirSync(USER_DATA_DIR, { recursive: true });

  const port = new URL(CDP_URL).port || '9223';
  const launchArgs = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${USER_DATA_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-session-crashed-bubble',
  ];

  console.log(`  Launching: ${edgePath}`);
  console.log(`  Args: ${launchArgs.join(' ')}`);

  spawn(edgePath, launchArgs, { detached: true, stdio: 'ignore' }).unref();

  // Poll every 600 ms for up to 15 s (same as demo script)
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 600));
    if (await checkCdpAvailable()) {
      console.log('Edge is ready.\n');
      return;
    }
  }
  throw new Error('Edge launched but did not become available on CDP within 15 seconds.');
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  connectToEdge,
  checkCdpAvailable,
  ensureEdgeRunning,
  findEdgePath,
  CDP_URL,
  USER_DATA_DIR,
};

'use strict';

/**
 * update-wiki-playwright.js
 *
 * 1. Screenshots key charts from the local dashboard HTML
 * 2. Uploads them to the ODSPRepo Wiki asset folder via SP REST API
 *    (uses the Edge browser session — same auth as editing the wiki)
 * 3. Generates wiki-usage-summary.md with the chart image URLs embedded
 * 4. Pastes the markdown into the Smart Wiki editor and saves
 *
 * Usage:  node update-wiki-playwright.js
 */

const fs   = require('fs');
const path = require('path');
const { connectToEdge } = require('./lib/cdp-connect');
const { generate: generateSummary } = require('./generate-wiki-summary');

const ROOT          = __dirname;
const DASHBOARD_FILE = path.join(ROOT, 'dashboard-sharepoint.html');
const WIKI_URL      = 'https://microsoft.sharepoint-df.com/sites/ODSPRepo/Wiki/Forms/smartwiki.aspx/AI%20Usage.md?pageId=70';
const SP_ORIGIN     = 'https://microsoft.sharepoint-df.com';
const ASSETS_FOLDER = '/sites/ODSPRepo/Wiki/SmartWikiAppData/Wiki Assets/ai-usage-charts';

// Which tabs to screenshot and what section key they map to
const CHART_CAPTURES = [
  { tabId: 'overview',  sectionKey: 'overview',    file: 'kav2-overview.png' },
  { tabId: 'm365',      sectionKey: 'm365',         file: 'm365-comparison.png' },
  { tabId: 'm365',      sectionKey: 'subproducts',  file: 'sp-subproducts.png',  scrollPct: 0.55 },
  { tabId: 'agents',    sectionKey: 'agents',       file: 'agents.png' },
];

// ── Chart screenshots ─────────────────────────────────────────────────────────

async function screenshotCharts(context) {
  if (!fs.existsSync(DASHBOARD_FILE)) {
    console.log('  dashboard-sharepoint.html not found — skipping chart screenshots');
    return {};
  }

  const page = await context.newPage();
  await page.setViewportSize({ width: 1400, height: 820 });

  try {
    const dashUrl = 'file:///' + DASHBOARD_FILE.replace(/\\/g, '/');
    console.log('  Opening local dashboard...');
    await page.goto(dashUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    const buffers = {};
    let lastTabId = null;

    for (const { tabId, sectionKey, file, scrollPct } of CHART_CAPTURES) {
      // Switch tab only if needed
      if (tabId !== lastTabId) {
        await page.evaluate(id => window.showTab(id), tabId);
        await page.waitForTimeout(1500);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(300);
        lastTabId = tabId;
      }

      // Scroll to a fraction of the panel height if requested
      if (scrollPct) {
        await page.evaluate((pct) => {
          const panel = document.querySelector('.tab-panel.active, [id^="panel-"]:not([style*="none"])');
          if (panel) window.scrollTo(0, panel.scrollHeight * pct);
        }, scrollPct);
        await page.waitForTimeout(400);
      }

      const buf = await page.screenshot({ type: 'png' });
      buffers[sectionKey] = { file, buffer: buf };
      console.log(`  Screenshotted ${sectionKey} (${(buf.length / 1024).toFixed(0)} KB)`);

      // Reset scroll for next capture on same tab
      if (scrollPct) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(200);
      }
    }

    return buffers;
  } finally {
    await page.close();
  }
}

// ── SP REST upload ────────────────────────────────────────────────────────────

async function getDigest(page) {
  return page.evaluate(async (origin) => {
    const res = await fetch(`${origin}/sites/ODSPRepo/_api/contextinfo`, {
      method: 'POST',
      headers: { Accept: 'application/json;odata=verbose' },
      credentials: 'include',
    });
    const j = await res.json();
    return j.d?.GetContextWebInformation?.FormDigestValue || null;
  }, SP_ORIGIN);
}

async function ensureFolder(page, digest) {
  return page.evaluate(async ({ origin, folderPath, digest }) => {
    // Try to create; ignore 'already exists' (400)
    const res = await fetch(
      `${origin}/sites/ODSPRepo/_api/web/folders`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json;odata=verbose',
          'Content-Type': 'application/json;odata=verbose',
          'X-RequestDigest': digest,
        },
        body: JSON.stringify({ __metadata: { type: 'SP.Folder' }, ServerRelativeUrl: folderPath }),
        credentials: 'include',
      }
    );
    return { status: res.status };
  }, { origin: SP_ORIGIN, folderPath: ASSETS_FOLDER, digest });
}

async function uploadImage(page, digest, filename, b64) {
  return page.evaluate(async ({ origin, folderPath, filename, b64, digest }) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

    const encodedPath = folderPath.replace(/ /g, '%20');
    const url = `${origin}/sites/ODSPRepo/_api/web/GetFolderByServerRelativeUrl('${encodedPath}')/Files/Add(url='${encodeURIComponent(filename)}',overwrite=true)`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json;odata=verbose',
        'X-RequestDigest': digest,
      },
      body: bytes,
      credentials: 'include',
    });
    const j = await res.json();
    if (j.d?.ServerRelativeUrl) {
      return `${origin}${j.d.ServerRelativeUrl.replace(/ /g, '%20')}`;
    }
    return null;
  }, { origin: SP_ORIGIN, folderPath: ASSETS_FOLDER, filename, b64, digest });
}

async function uploadCharts(page, captures) {
  if (!Object.keys(captures).length) return {};

  console.log('  Getting SP request digest...');
  const digest = await getDigest(page);
  if (!digest) { console.warn('  Could not get digest — skipping image upload'); return {}; }

  console.log('  Ensuring asset folder exists...');
  const { status } = await ensureFolder(page, digest);
  console.log(`    Folder status: ${status} (${status === 200 || status === 201 ? 'created' : status === 400 ? 'already exists' : 'unknown'})`);

  const imageUrls = {};
  for (const [sectionKey, { file, buffer }] of Object.entries(captures)) {
    const b64 = buffer.toString('base64');
    const url = await uploadImage(page, digest, file, b64);
    if (url) {
      imageUrls[sectionKey] = url;
      console.log(`  Uploaded ${file}`);
    } else {
      console.warn(`  Upload failed for ${file}`);
    }
  }
  return imageUrls;
}

// ── Wiki editor ───────────────────────────────────────────────────────────────

async function updateWikiPage(page, markdown) {
  console.log('Navigating to wiki page...');
  await page.goto(WIKI_URL, { waitUntil: 'networkidle', timeout: 30000 });

  console.log('Opening editor...');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.waitForSelector('.cm-content', { timeout: 10000 });

  console.log('Pasting content...');
  await page.evaluate(async (text) => {
    await navigator.clipboard.writeText(text);
  }, markdown);

  // Scroll editor to top, click the very first pixel to anchor at line 1
  await page.locator('.cm-content').evaluate(el => el.scrollTop = 0);
  const box = await page.locator('.cm-content').boundingBox();
  await page.mouse.click(box.x + 4, box.y + 4);
  await page.waitForTimeout(200);
  // Escape any table-cell focus, then select from here to end
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Home');
  await page.waitForTimeout(100);
  await page.keyboard.press('Control+Shift+End');
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(1000);

  console.log('Saving...');
  await page.getByRole('button', { name: 'Save and exit' }).click();
  await page.waitForTimeout(2000);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const { browser, context, page } = await connectToEdge();

  try {
    // 1. Screenshot charts from the local dashboard
    console.log('\nScreenshotting charts...');
    const captures = await screenshotCharts(context);

    // 2. Upload chart images via the wiki page session
    console.log('\nUploading chart images...');
    // Navigate to wiki first to get a page with SP auth session
    await page.goto(WIKI_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const imageUrls = await uploadCharts(page, captures);
    console.log(`  ${Object.keys(imageUrls).length} images uploaded`);

    // 3. Generate markdown with image URLs
    console.log('\nGenerating wiki summary...');
    const markdown = generateSummary(imageUrls);

    // 4. Update the wiki page
    console.log('\nUpdating wiki page...');
    await updateWikiPage(page, markdown);

    console.log(`\n✅ Wiki updated: ${WIKI_URL}`);
    console.log(`   Charts: ${Object.keys(imageUrls).join(', ') || 'none'}`);
  } finally {
    await page.close();
    await browser.close();
  }
}

main().catch(err => { console.error('\nWiki update failed:', err.message); process.exit(1); });

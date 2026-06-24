'use strict';

const https   = require('https');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');
const { execSync } = require('child_process');

const ROOT          = __dirname;
const DATA_DIR      = path.join(ROOT, 'data');
const MANIFEST_FILE = path.join(ROOT, 'publish-manifest.json');
const CONCURRENCY   = 8;

const DRIVE_ID     = 'b!OTauWEvpAUmnaIJf8gaOF_DEBcfI2rZNnwjZOO8Xmdav7A78FKxfSJctDUDIxjVG';
const STATS_FOLDER = 'Stats';

const SP_HOST         = 'microsoft.sharepoint-df.com';
const DASHBOARD_FILE  = 'dashboard-sharepoint.html';
const STATS_URL       = `https://${SP_HOST}/teams/SPAI/Shared%20Documents/${STATS_FOLDER}`;

const WIKI_URL     = 'https://microsoft.sharepoint-df.com/sites/ODSPRepo/Wiki/Forms/smartwiki.aspx/AI%20Usage.md?pageId=70';

// ── Auth ──────────────────────────────────────────────────────────────────────

function getToken() {
  const raw = execSync('az account get-access-token --resource "https://graph.microsoft.com"', { encoding: 'utf8' });
  return JSON.parse(raw).accessToken;
}

// ── Graph API ─────────────────────────────────────────────────────────────────

function graphRequest(method, apiPath, token, body) {
  return new Promise((resolve, reject) => {
    const buf = body ? (Buffer.isBuffer(body) ? body : Buffer.from(body)) : null;
    const req = https.request({
      hostname: 'graph.microsoft.com',
      port: 443,
      path: apiPath,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(buf ? {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(buf.length),
        } : {}),
      },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (buf) req.write(buf);
    req.end();
  });
}

async function uploadFileToDrive(driveId, itemPath, buf, token, retries = 3) {
  const encoded = itemPath.split('/').map(encodeURIComponent).join('/');
  const apiPath = `/v1.0/drives/${driveId}/root:/${encoded}:/content`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const { status, body } = await graphRequest('PUT', apiPath, token, buf);
    if (status < 400) return;
    if ((status === 503 || status === 429 || status === 500) && attempt < retries) {
      await new Promise(r => setTimeout(r, (attempt + 1) * 2000));
      continue;
    }
    throw new Error(`Upload failed for ${itemPath} (${status}): ${body.toString().slice(0, 300)}`);
  }
}

async function uploadFile(itemPath, buf, token, retries = 3) {
  return uploadFileToDrive(DRIVE_ID, itemPath, buf, token, retries);
}


// ── Concurrency limiter ───────────────────────────────────────────────────────

function makeLimiter(concurrency) {
  let active = 0;
  const queue = [];
  return fn => new Promise((resolve, reject) => {
    const run = async () => {
      active++;
      try { resolve(await fn()); }
      catch (e) { reject(e); }
      finally {
        active--;
        if (queue.length) queue.shift()();
      }
    };
    if (active < concurrency) run();
    else queue.push(run);
  });
}

// ── Manifest ──────────────────────────────────────────────────────────────────

const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');

function loadManifest() {
  try { return JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8')); }
  catch { return {}; }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function walkDir(dir, base) {
  base = base || dir;
  const results = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) results.push(...walkDir(full, base));
    else results.push({ full, rel: path.relative(base, full).replace(/\\/g, '/') });
  }
  return results;
}

function buildInlinedDashboard() {
  execSync('node build-standalone.js', { cwd: ROOT, stdio: 'inherit' });
  return fs.readFileSync(path.join(ROOT, 'dashboard-sharepoint.html'), 'utf8');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!fs.existsSync(path.join(ROOT, 'dashboard-data.js'))) {
    console.error('ERROR: dashboard-data.js not found — run: node generate-dashboard-data.js');
    process.exit(1);
  }

  console.log('Acquiring Graph token...');
  const token = await getToken();
  console.log('Token acquired.\n');

  const manifest    = loadManifest();
  const newManifest = { ...manifest };
  const limit       = makeLimiter(CONCURRENCY);

  // ── Desktop Dashboard HTML ─────────────────────────────────────────────────
  process.stdout.write(`Building ${DASHBOARD_FILE}...`);
  const dashBuf  = Buffer.from(buildInlinedDashboard(), 'utf8');
  const dashHash = sha256(dashBuf);
  let dashUploaded = false;

  if (manifest['__dashboard__'] === dashHash) {
    console.log(' unchanged, skipping.\n');
  } else {
    process.stdout.write(' uploading...');
    await uploadFile(`${STATS_FOLDER}/${DASHBOARD_FILE}`, dashBuf, token);
    newManifest['__dashboard__'] = dashHash;
    dashUploaded = true;
    console.log(' done.\n');
  }

  // ── Data files: hash all, queue only changed ───────────────────────────────
  const allFiles = walkDir(DATA_DIR);
  const toUpload = [];
  let skipped = 0;

  for (const { full, rel } of allFiles) {
    const buf  = fs.readFileSync(full);
    const hash = sha256(buf);
    if (manifest[rel] === hash) {
      skipped++;
    } else {
      toUpload.push({ rel, buf, hash });
    }
  }

  console.log(`Data files: ${allFiles.length} total — ${skipped} unchanged, ${toUpload.length} to upload`);

  let done = 0;
  const errors = [];

  if (toUpload.length > 0) {
    await Promise.all(toUpload.map(({ rel, buf, hash }) =>
      limit(async () => {
        try {
          await uploadFile(`${STATS_FOLDER}/data/${rel}`, buf, token);
          newManifest[rel] = hash;
          done++;
          process.stdout.write(`  [${done}/${toUpload.length}] ${rel}\n`);
        } catch (err) {
          errors.push({ rel, err });
          process.stdout.write(`  [FAIL] ${rel}: ${err.message}\n`);
        }
      })
    ));
  }

  fs.writeFileSync(MANIFEST_FILE, JSON.stringify(newManifest, null, 2));

  if (errors.length) {
    console.error(`\n${errors.length} upload(s) failed — will retry on next publish.`);
  }

  const dashStr = dashUploaded ? '1 dashboard' : '0 dashboards (unchanged)';
  console.log(`\nPublish complete — ${done} data files + ${dashStr}`);
  console.log(`\n  Dashboard: ${STATS_URL}/${DASHBOARD_FILE}`);

  // ── Wiki summary ───────────────────────────────────────────────────────────
  process.stdout.write('\nGenerating wiki summary...');
  require('./generate-wiki-summary').generate();

  process.stdout.write(`Updating ODSPRepo wiki via browser...`);
  try {
    execSync('node update-wiki-playwright.js', { cwd: ROOT, stdio: 'inherit' });
    console.log(`\n${WIKI_URL}\n`);
  } catch (err) {
    console.error(` FAILED: ${err.message}`);
    console.error('  Wiki not updated — dashboard publish was still successful.\n');
  }
}

main().catch(err => { console.error('\n' + err.message); process.exit(1); });

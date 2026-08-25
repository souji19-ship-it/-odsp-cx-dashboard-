'use strict';

const https = require('https');
const fs = require('fs');
const { execSync } = require('child_process');

const SP_HOST = 'microsoft.sharepoint-df.com';
const SITE_PATH = '/teams/OneDriveSharePointinAgenticWork';
const LOCAL_FILE = 'C:\\Users\\v-sogattu\\OneDrive - Microsoft\\ODSP-AW-Dashboard\\ODSP-AW-Weekly-Pulse.html';
const TARGET_NAME = process.argv[2] || 'ODSP-AW-Weekly-Pulse.html';

function getToken() {
  const raw = execSync('az account get-access-token --resource "https://graph.microsoft.com"', { encoding: 'utf8' });
  return JSON.parse(raw).accessToken;
}

function graph(method, apiPath, token, body, contentType) {
  return new Promise((resolve, reject) => {
    const buf = body ? (Buffer.isBuffer(body) ? body : Buffer.from(body)) : null;
    const req = https.request({
      hostname: 'graph.microsoft.com', port: 443, path: apiPath, method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(buf ? { 'Content-Type': contentType || 'application/octet-stream', 'Content-Length': String(buf.length) } : {}),
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

async function main() {
  const token = getToken();

  // 1. Resolve site
  const siteResp = await graph('GET', `/v1.0/sites/${SP_HOST}:${SITE_PATH}`, token);
  if (siteResp.status >= 400) throw new Error(`Site lookup failed (${siteResp.status}): ${siteResp.body.toString().slice(0, 400)}`);
  const site = JSON.parse(siteResp.body.toString());
  console.log('Site:', site.displayName, '\n  id:', site.id);

  // 2. Default drive
  const driveResp = await graph('GET', `/v1.0/sites/${site.id}/drive`, token);
  if (driveResp.status >= 400) throw new Error(`Drive lookup failed (${driveResp.status}): ${driveResp.body.toString().slice(0, 400)}`);
  const drive = JSON.parse(driveResp.body.toString());
  console.log('Drive:', drive.name, '\n  id:', drive.id);

  // 3. List root children
  const childResp = await graph('GET', `/v1.0/drives/${drive.id}/root/children?$select=name,size,lastModifiedDateTime,webUrl`, token);
  const children = JSON.parse(childResp.body.toString()).value || [];
  console.log('\nRoot document library contents:');
  children.forEach(c => console.log('  -', c.name, `(${c.size} bytes, mod ${c.lastModifiedDateTime})`));

  if (process.argv.includes('--list-only')) return;

  // 4. Upload (PUT overwrites if exists)
  const buf = fs.readFileSync(LOCAL_FILE);
  const encoded = encodeURIComponent(TARGET_NAME);
  const upResp = await graph('PUT', `/v1.0/drives/${drive.id}/root:/${encoded}:/content`, token, buf, 'text/html');
  if (upResp.status >= 400) throw new Error(`Upload failed (${upResp.status}): ${upResp.body.toString().slice(0, 400)}`);
  const item = JSON.parse(upResp.body.toString());
  console.log(`\nUploaded "${TARGET_NAME}" (${buf.length} bytes)`);
  console.log('  webUrl:', item.webUrl);
}

main().catch(e => { console.error('\nERROR:', e.message); process.exit(1); });

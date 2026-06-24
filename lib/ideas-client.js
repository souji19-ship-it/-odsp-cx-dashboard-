'use strict';

/**
 * lib/ideas-client.js
 *
 * Direct HTTP client for the IDEAS AURA MCP endpoint.
 * Handles Azure AD token acquisition (reuses the same MSAL cache as the
 * ideas MCP proxy so authentication only needs to happen once) and sends
 * MCP JSON-RPC messages directly without requiring Claude Code.
 *
 * Usage:
 *   const ideas = require('./lib/ideas-client');
 *   const rows  = await ideas.getMetricData('WeeklyActiveUserCount', {
 *     filters: { ProductKey: ['4999588089921664978'] },
 *   });
 */

const https  = require('https');
const http   = require('http');
const msal   = require(`${__dirname}/../../IDEAS-AI-Plugins/plugins/ideas/node_modules/@azure/msal-node`);
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');

// ── Config (mirrors ideas/index.js exactly so token cache is shared) ──────────

const CLIENT_ID   = process.env.IDEAS_CLIENT_ID || '3cdb839e-2398-48d5-a903-dc2e7f64a9bb';
const TENANT_ID   = process.env.IDEAS_TENANT_ID || '72f988bf-86f1-41af-91ab-2d7cd011db47';
const MCP_URL     = process.env.IDEAS_MCP_URL   || 'https://aura.ideas.microsoft.com/mcp';
const SCOPES      = [process.env.IDEAS_SCOPE    || 'api://de120412-e659-4b81-9f46-705995561afd/.default'];
const AUTHORITY   = `https://login.microsoftonline.com/${TENANT_ID}`;

// Shared cache dir/file with the MCP proxy — same key "ideas"
const CACHE_DIR  = path.join(process.env.LOCALAPPDATA || process.env.HOME || '.', 'IdeasMcpPlugin');
const CACHE_FILE = path.join(CACHE_DIR, 'token_cache_ideas.json');
fs.mkdirSync(CACHE_DIR, { recursive: true });

const cachePlugin = {
  beforeCacheAccess: async ctx => {
    if (fs.existsSync(CACHE_FILE)) {
      try { ctx.tokenCache.deserialize(fs.readFileSync(CACHE_FILE, 'utf8')); } catch {}
    }
  },
  afterCacheAccess: async ctx => {
    if (ctx.cacheHasChanged) fs.writeFileSync(CACHE_FILE, ctx.tokenCache.serialize());
  },
};

const msalApp = new msal.PublicClientApplication({
  auth: { clientId: CLIENT_ID, authority: AUTHORITY },
  cache: { cachePlugin },
});

// ── Auth ──────────────────────────────────────────────────────────────────────

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.listen(0, () => { const p = srv.address().port; srv.close(() => resolve(p)); });
    srv.on('error', reject);
  });
}

async function acquireTokenInteractive() {
  const port = await findFreePort();
  const redirectUri = `http://localhost:${port}`;
  const verifier  = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url  = new URL(req.url, redirectUri);
      const code = url.searchParams.get('code');
      if (!code) { res.writeHead(200); res.end('<p>Waiting...</p>'); return; }
      try {
        const result = await msalApp.acquireTokenByCode({
          code, scopes: SCOPES, redirectUri, codeVerifier: verifier,
        });
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<h2>Signed in!</h2><p>Welcome, ${result.account.username}. You can close this tab.</p>`);
        server.close();
        resolve(result.accessToken);
      } catch (err) {
        res.writeHead(500); res.end(err.message);
        server.close(); reject(err);
      }
    });

    server.listen(port, async () => {
      const authUrl = await msalApp.getAuthCodeUrl({
        scopes: SCOPES, redirectUri, codeChallenge: challenge, codeChallengeMethod: 'S256',
      });
      process.stderr.write(`[IdeasClient] Opening browser for sign-in...\n`);
      const cmd = process.platform === 'win32' ? `start "" "${authUrl}"` : `open "${authUrl}"`;
      exec(cmd, () => {});
    });
    server.on('error', reject);
  });
}

async function getToken() {
  const accounts = await msalApp.getTokenCache().getAllAccounts();
  if (accounts.length > 0) {
    try {
      const r = await msalApp.acquireTokenSilent({ account: accounts[0], scopes: SCOPES });
      return r.accessToken;
    } catch {}
  }
  process.stderr.write('[IdeasClient] No cached token — launching browser sign-in...\n');
  return acquireTokenInteractive();
}

// ── MCP HTTP transport ────────────────────────────────────────────────────────

function postMcp(body, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(MCP_URL);
    const req = https.request({
      hostname: u.hostname,
      port:     u.port || 443,
      path:     u.pathname,
      method:   'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`,
        'Accept':        'text/event-stream, application/json',
      },
    }, resolve);
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function readMcpResponse(res) {
  const chunks = [];
  for await (const chunk of res) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf-8');
  const contentType = res.headers['content-type'] || '';

  const jsonLines = contentType.includes('text/event-stream')
    ? raw.split('\n').filter(l => l.startsWith('data: ')).map(l => l.slice(6))
    : [raw];

  const messages = jsonLines
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);

  return messages[messages.length - 1] ?? null;
}

// Send initialize once per process to satisfy MCP protocol requirements
let _initDone = false;
async function ensureInit(token) {
  if (_initDone) return;
  const msg = JSON.stringify({
    jsonrpc: '2.0', id: '0', method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'msft-reporting', version: '1.0.0' },
    },
  });
  const res = await postMcp(msg, token);
  await readMcpResponse(res); // consume; we don't need the response body
  _initDone = true;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Call any IDEAS MCP tool by name.
 * Returns the text content string from the tool response.
 */
async function callTool(toolName, args) {
  const token = await getToken();
  await ensureInit(token);

  const msg = JSON.stringify({
    jsonrpc: '2.0',
    id: String(Date.now()),
    method: 'tools/call',
    params: { name: toolName, arguments: args },
  });

  const res    = await postMcp(msg, token);
  const parsed = await readMcpResponse(res);
  if (!parsed) return null;

  // MCP tools/call response shape:
  //   { result: { content: [{ type: "text", text: "..." }] } }
  const content = parsed.result?.content ?? [];
  return content.map(c => c.text ?? '').join('\n');
}

/**
 * Parse row data out of the formatted IDEAS response text.
 * Extracts all JSON arrays from "Data:\n[...]" blocks.
 * Deduplicates by (Date, ProductKey) — takes last occurrence per key.
 */
function parseDataRows(text) {
  if (!text) return [];
  const rows = [];
  // Match Data: followed by a JSON array (possibly multi-line)
  const re = /Data:\s*(\[[\s\S]*?\])\s*(?:(?:===|$))/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    try {
      const arr = JSON.parse(m[1]);
      rows.push(...arr);
    } catch {}
  }
  // Deduplicate — latest asset wins for same (Date, ProductKey)
  const seen = new Map();
  for (const row of rows) {
    const key = `${row.Date}|${row.ProductKey ?? ''}`;
    seen.set(key, row);
  }
  return Array.from(seen.values());
}

/**
 * Fetch metric data for one or more products.
 *
 * @param {string} metricName        e.g. 'WeeklyActiveUserCount'
 * @param {object} opts
 * @param {object|string} [opts.filters]       dimension filters
 * @param {string}        [opts.startDate]     ISO-8601
 * @param {string}        [opts.endDate]       ISO-8601
 * @param {string}        [opts.selectColumns] comma-separated
 * @returns {Promise<object[]>} array of row objects
 */
async function getMetricData(metricName, opts = {}) {
  const { filters, startDate, endDate, selectColumns } = opts;
  const args = {
    metricName,
    hydrateDimensions: true,
    userPrompt: `scrape-ideas-metrics automated pull: ${metricName}`,
  };
  if (filters)       args.filters       = typeof filters === 'string' ? filters : JSON.stringify(filters);
  if (startDate)     args.startDate     = startDate;
  if (endDate)       args.endDate       = endDate;
  if (selectColumns) args.selectColumns = selectColumns;

  const text = await callTool('get_metric_data', args);
  return parseDataRows(text);
}

module.exports = { callTool, getMetricData, getToken };

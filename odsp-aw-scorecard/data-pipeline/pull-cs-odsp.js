// ============================================================================
// pull-cs-odsp.js  —  Re-pull ODSP-in-Copilot-Studio 301/401 with Sandeep's
// corrected methodology (nested CustomDimensions, KnowledgeCategory, FailureClass,
// StatusClass, OperationId, Value latency, drop ConsentPending).
// Fan-out over 19 FDA-Island clusters x 6 Sun-Sat weeks. Resumable + concurrent.
// Writes per-cluster-week JSON into ./cs-pull/. Run: node pull-cs-odsp.js
// ============================================================================
const { Client, KustoConnectionStringBuilder } = require('azure-kusto-data');
const { AzureCliCredential } = require('@azure/identity');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'cs-pull');
fs.mkdirSync(OUT, { recursive: true });

const CLUSTERS = [
  'fdislandsus.centralus','fdislandseu.westeurope','fdislandsin.centralindia',
  'fdislandsjp.japaneast','fdislandsau.australiaeast','fdislandsuk.uksouth',
  'fdislandsca.canadacentral','fdislandsbr.brazilsouth','fdislandsfr.francecentral',
  'fdislandsde.germanywestcentral','fdislandsch.switzerlandnorth','fdislandsno.norwayeast',
  'fdislandsse.swedencentral','fdislandsit.italynorth','fdislandsza.southafricanorth',
  'fdislandsae.uaenorth','fdislandskr.koreasouth','fdislandsas.southeastasia',
  'fdislandssg.southeastasia',
];

// Sun-Sat weeks: [label, startInclusive, endExclusive]
const WEEKS = [
  ['Jun 7-13',     '2026-06-07','2026-06-14'],
  ['Jun 14-20',    '2026-06-14','2026-06-21'],
  ['Jun 21-27',    '2026-06-21','2026-06-28'],
  ['Jun 28-Jul 4', '2026-06-28','2026-07-05'],
  ['Jul 5-11',     '2026-07-05','2026-07-12'],
  ['Jul 12-18',    '2026-07-12','2026-07-19'],
];

const APP = `applicationName in ("fabric:/CopilotStudio.AgenticRuntime","fabric:/CopilotStudio.AgenticLoopApp")`;

function q401(s, e) { return `
TraceEvents
| where env_time >= datetime(${s}) and env_time < datetime(${e})
| where ${APP}
| where eventName == 'AgenticLoopToolCallLatency'
| where customDimensions has 'shared_sharepointonline' or customDimensions has 'shared_onedriveforbusiness'
| extend nd = parse_json(tostring(parse_json(customDimensions).CustomDimensions))
| extend Conn = tolower(tostring(nd.ConnectorId))
| where Conn in ('shared_sharepointonline','shared_onedriveforbusiness')
| extend ToolCat = tostring(nd.ToolCategory)
| where ToolCat != 'ConsentPending'
| extend Ok = tostring(nd.Success)=='True', FC = tostring(nd.FailureClass), SC = tostring(nd.StatusClass),
         Op = tostring(nd.OperationId), V = todouble(nd.Value),
         Ch = tolower(tostring(parse_json(customDimensions).ChannelId))
| extend Tier = iff(Ch in ('pva-studio','pva-maker-evaluation'),'C1','C2')
| summarize Calls=count(), Ok=countif(Ok), SvcF=countif(FC=='Service'), AuthF=countif(FC=='Author'),
    UsrF=countif(FC=='User'), c4xx=countif(SC=='4xx'), c5xx=countif(SC=='5xx'),
    throttle=countif(SC has 'Throttl' or SC=='429'), timeout=countif(SC has 'Timeout'),
    sumV=sumif(V, isnotnull(V)), cntV=countif(isnotnull(V)),
    p50=percentile(V,50), p95=percentile(V,95)
    by Conn, Op, Tier`;
}

function q301(s, e) { return `
TraceEvents
| where env_time >= datetime(${s}) and env_time < datetime(${e})
| where ${APP}
| where eventName in ('AgenticLoopTurnLatency','AgenticLoopToolCallLatency','KnowledgeSourceLatency')
| extend meta = parse_json(customDimensions)
| extend Ch = tolower(tostring(meta.ChannelId))
| extend Tier = iff(Ch in ('pva-studio','pva-maker-evaluation'),'C1','C2')
| extend UserId = tostring(principalObjectId), TenantId = tostring(principalTenantId), ConvId = tostring(meta.ConversationId)
| extend odspHint = (eventName=='AgenticLoopToolCallLatency' and (customDimensions has 'shared_sharepointonline' or customDimensions has 'shared_onedriveforbusiness'))
                 or (eventName=='KnowledgeSourceLatency' and customDimensions has 'SharePoint')
| extend nd = iff(odspHint, parse_json(tostring(meta.CustomDimensions)), dynamic(null))
| extend Conn = tolower(tostring(nd.ConnectorId)), KCat = tostring(nd.KnowledgeCategory)
| extend IsTool = eventName=='AgenticLoopToolCallLatency', IsTurn = eventName=='AgenticLoopTurnLatency'
| extend IsODSPtool = IsTool and Conn in ('shared_sharepointonline','shared_onedriveforbusiness')
| extend IsODSPknow = eventName=='KnowledgeSourceLatency' and KCat=='SharePoint'
| extend IsODSP = IsODSPtool or IsODSPknow
| summarize
    ODSP_ToolCalls=countif(IsODSPtool), ODSP_Know=countif(IsODSPknow),
    ODSP_Users=dcountif(UserId, IsODSP and isnotempty(UserId)),
    ODSP_Tenants=dcountif(TenantId, IsODSP and isnotempty(TenantId)),
    ODSP_Tasks=dcountif(ConvId, IsODSP and isnotempty(ConvId)),
    CS_Users=dcountif(UserId, IsTurn and isnotempty(UserId)),
    CS_Tenants=dcountif(TenantId, IsTurn and isnotempty(TenantId)),
    CS_Tasks=dcountif(ConvId, IsTurn and isnotempty(ConvId)),
    CS_ToolCalls=countif(IsTool)
    by Tier`;
}

function clientFor(cluster) {
  return new Client(KustoConnectionStringBuilder.withTokenCredential(
    `https://${cluster}.kusto.windows.net`, new AzureCliCredential()));
}

async function runWithRetry(client, db, query, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await client.execute(db, query);
      return r.primaryResults[0].toJSON().data;
    } catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 4000 * (i + 1))); }
  }
  throw lastErr;
}

async function pullCell(cluster, wk) {
  const [label, s, e] = wk;
  const outFile = path.join(OUT, `${cluster}__${label.replace(/[^\w]+/g,'_')}.json`);
  if (fs.existsSync(outFile)) return { cluster, label, skipped: true };
  const client = clientFor(cluster);
  try {
    const [r401, r301] = await Promise.all([
      runWithRetry(client, 'CAPAnalytics', q401(s, e)),
      runWithRetry(client, 'CAPAnalytics', q301(s, e)),
    ]);
    fs.writeFileSync(outFile, JSON.stringify({ cluster, label, r401, r301 }));
    return { cluster, label, ok: true, ops: r401.length };
  } catch (err) {
    fs.writeFileSync(outFile.replace('.json', '.ERROR.json'), JSON.stringify({ cluster, label, error: String(err.message||err) }));
    return { cluster, label, error: String(err.message || err) };
  } finally { await client.close?.(); }
}

async function main() {
  const jobs = [];
  for (const c of CLUSTERS) for (const w of WEEKS) jobs.push([c, w]);
  const CONC = 5;
  let idx = 0, done = 0;
  const started = Date.now();
  async function worker() {
    while (idx < jobs.length) {
      const [c, w] = jobs[idx++];
      const res = await pullCell(c, w);
      done++;
      const tag = res.skipped ? 'skip' : res.ok ? `ok(${res.ops}ops)` : `ERR ${res.error}`;
      console.log(`[${done}/${jobs.length}] ${res.cluster} ${res.label} ${tag} (${((Date.now()-started)/1000).toFixed(0)}s)`);
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  console.log(`DONE ${done}/${jobs.length} in ${((Date.now()-started)/1000).toFixed(0)}s`);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });

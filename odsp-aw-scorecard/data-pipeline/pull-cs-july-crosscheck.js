// Cross-check pull: full calendar July (2026-07-01 .. 2026-08-01, endExclusive)
// per cluster, using Sandeep's EXACT q301/q401/agents logic (period grain, not weekly).
// Distinct users/tenants/tasks = per-cluster dcount summed across regions (Sandeep's
// regional-sum). Agents = exact client-side union of make_set(CdsBotId). Success from 401.
// Read-only. Run: node pull-cs-july-crosscheck.js
const { Client, KustoConnectionStringBuilder } = require('azure-kusto-data');
const { AzureCliCredential } = require('@azure/identity');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'cs-july-crosscheck');
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

const S = '2026-07-01', E = '2026-08-01';
const APP = `applicationName in ("fabric:/CopilotStudio.AgenticRuntime","fabric:/CopilotStudio.AgenticLoopApp")`;

// 401 — service success by op/tier (matches pull-cs-odsp.js q401)
function q401() { return `
TraceEvents
| where env_time >= datetime(${S}) and env_time < datetime(${E})
| where ${APP}
| where eventName == 'AgenticLoopToolCallLatency'
| where customDimensions has 'shared_sharepointonline' or customDimensions has 'shared_onedriveforbusiness'
| extend nd = parse_json(tostring(parse_json(customDimensions).CustomDimensions))
| extend Conn = tolower(tostring(nd.ConnectorId))
| where Conn in ('shared_sharepointonline','shared_onedriveforbusiness')
| extend ToolCat = tostring(nd.ToolCategory)
| where ToolCat != 'ConsentPending'
| extend Ok = tostring(nd.Success)=='True', FC = tostring(nd.FailureClass),
         Ch = tolower(tostring(parse_json(customDimensions).ChannelId))
| extend Tier = iff(Ch in ('pva-studio','pva-maker-evaluation'),'C1','C2')
| summarize Calls=count(), Ok=countif(Ok), SvcF=countif(FC=='Service') by Tier`;
}

// 301 — reach/engagement + agent set (matches pull-cs-odsp.js q301 + agents pull)
function q301() { return `
TraceEvents
| where env_time >= datetime(${S}) and env_time < datetime(${E})
| where ${APP}
| where eventName in ('AgenticLoopTurnLatency','AgenticLoopToolCallLatency','KnowledgeSourceLatency')
| extend meta = parse_json(customDimensions)
| extend Ch = tolower(tostring(meta.ChannelId))
| extend Tier = iff(Ch in ('pva-studio','pva-maker-evaluation'),'C1','C2')
| extend UserId = tostring(principalObjectId), TenantId = tostring(principalTenantId), ConvId = tostring(meta.ConversationId)
| extend BotId = tostring(meta.CdsBotId)
| extend odspHint = (eventName=='AgenticLoopToolCallLatency' and (customDimensions has 'shared_sharepointonline' or customDimensions has 'shared_onedriveforbusiness'))
                 or (eventName=='KnowledgeSourceLatency' and customDimensions has 'SharePoint')
| extend nd = iff(odspHint, parse_json(tostring(meta.CustomDimensions)), dynamic(null))
| extend Conn = tolower(tostring(nd.ConnectorId)), KSrc = tostring(nd.KnowledgeSource)
| extend IsTool = eventName=='AgenticLoopToolCallLatency', IsTurn = eventName=='AgenticLoopTurnLatency'
| extend IsODSPtool = IsTool and Conn in ('shared_sharepointonline','shared_onedriveforbusiness')
| extend IsODSPknow = eventName=='KnowledgeSourceLatency' and KSrc in ('SharePoint','SharePointList')
| extend IsODSP = IsODSPtool or IsODSPknow
| summarize
    ODSP_ToolCalls=countif(IsODSPtool), ODSP_Know=countif(IsODSPknow),
    ODSP_Users=dcountif(UserId, IsODSP and isnotempty(UserId)),
    ODSP_Tenants=dcountif(TenantId, IsODSP and isnotempty(TenantId)),
    ODSP_Tasks=dcountif(ConvId, IsODSP and isnotempty(ConvId)),
    agents=make_set_if(BotId, IsODSP and isnotempty(BotId), 1048576)
    by Tier`;
}

function clientFor(c) {
  return new Client(KustoConnectionStringBuilder.withTokenCredential(
    `https://${c}.kusto.windows.net`, new AzureCliCredential()));
}
async function runRetry(client, query, tries=3){
  let le; for(let i=0;i<tries;i++){try{const r=await client.execute('CAPAnalytics',query);return r.primaryResults[0].toJSON().data;}catch(e){le=e;await new Promise(r=>setTimeout(r,5000*(i+1)));}}
  throw le;
}
async function cell(c){
  const f=path.join(OUT,`${c}.json`);
  if(fs.existsSync(f)) return {c,skipped:true};
  const client=clientFor(c);
  try{
    const [r301,r401]=await Promise.all([runRetry(client,q301()),runRetry(client,q401())]);
    fs.writeFileSync(f,JSON.stringify({c,r301,r401}));
    return {c,ok:true};
  }catch(err){
    fs.writeFileSync(f.replace('.json','.ERROR.json'),JSON.stringify({c,error:String(err.message||err)}));
    return {c,error:String(err.message||err)};
  }finally{await client.close?.();}
}
async function main(){
  let idx=0,done=0; const t0=Date.now();
  async function worker(){while(idx<CLUSTERS.length){const c=CLUSTERS[idx++];const r=await cell(c);done++;console.log(`[${done}/${CLUSTERS.length}] ${r.c} ${r.skipped?'skip':r.ok?'ok':'ERR '+r.error} (${((Date.now()-t0)/1000).toFixed(0)}s)`);}}
  await Promise.all(Array.from({length:5},worker));
  console.log(`DONE in ${((Date.now()-t0)/1000).toFixed(0)}s`);
}
main().catch(e=>{console.error('FATAL',e.message);process.exit(1);});

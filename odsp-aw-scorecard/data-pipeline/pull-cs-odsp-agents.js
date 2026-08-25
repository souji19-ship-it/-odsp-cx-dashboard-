// Per-cluster ODSP-active AGENTS (distinct CdsBotId on ODSP tool/knowledge events).
// Emits make_set(BotId) per (Tier) so the global distinct is an EXACT client-side union
// (taxonomy-sanctioned exact variant of the HLL push-down). ODSP detection matches the
// validated q301 in pull-cs-odsp.js exactly. Run: node pull-cs-odsp-agents.js
const { Client, KustoConnectionStringBuilder } = require('azure-kusto-data');
const { AzureCliCredential } = require('@azure/identity');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'cs-odsp-agents');
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

const WEEKS = [
  ['Jul 12-18', '2026-07-12','2026-07-19'],
  ['Jul 19-25', '2026-07-19','2026-07-26'],
];

const APP = `applicationName in ("fabric:/CopilotStudio.AgenticRuntime","fabric:/CopilotStudio.AgenticLoopApp")`;

function q(s, e) { return `
TraceEvents
| where env_time >= datetime(${s}) and env_time < datetime(${e})
| where ${APP}
| where eventName in ('AgenticLoopToolCallLatency','KnowledgeSourceLatency')
| extend meta = parse_json(customDimensions)
| extend Ch = tolower(tostring(meta.ChannelId))
| extend Tier = iff(Ch in ('pva-studio','pva-maker-evaluation'),'C1','C2')
| extend BotId = tostring(meta.CdsBotId)
| extend odspHint = (eventName=='AgenticLoopToolCallLatency' and (customDimensions has 'shared_sharepointonline' or customDimensions has 'shared_onedriveforbusiness'))
                 or (eventName=='KnowledgeSourceLatency' and customDimensions has 'SharePoint')
| extend nd = iff(odspHint, parse_json(tostring(meta.CustomDimensions)), dynamic(null))
| extend Conn = tolower(tostring(nd.ConnectorId)), KCat = tostring(nd.KnowledgeCategory), KSrc = tostring(nd.KnowledgeSource)
| extend IsODSPtool = eventName=='AgenticLoopToolCallLatency' and Conn in ('shared_sharepointonline','shared_onedriveforbusiness')
| extend IsODSPknow = eventName=='KnowledgeSourceLatency' and KSrc in ('SharePoint','SharePointList')
| where (IsODSPtool or IsODSPknow) and isnotempty(BotId)
| summarize agents = make_set(BotId, 1048576) by Tier`;
}

function clientFor(c) {
  return new Client(KustoConnectionStringBuilder.withTokenCredential(
    `https://${c}.kusto.windows.net`, new AzureCliCredential()));
}
async function runRetry(client, query, tries=3){
  let le; for(let i=0;i<tries;i++){try{const r=await client.execute('CAPAnalytics',query);return r.primaryResults[0].toJSON().data;}catch(e){le=e;await new Promise(r=>setTimeout(r,4000*(i+1)));}}
  throw le;
}
async function cell(c, wk){
  const [label,s,e]=wk;
  const f=path.join(OUT,`${c}__${label.replace(/[^\w]+/g,'_')}.json`);
  if(fs.existsSync(f)) return {c,label,skipped:true};
  const client=clientFor(c);
  try{const rows=await runRetry(client,q(s,e));fs.writeFileSync(f,JSON.stringify({c,label,rows}));return {c,label,ok:true};}
  catch(err){fs.writeFileSync(f.replace('.json','.ERROR.json'),JSON.stringify({c,label,error:String(err.message||err)}));return {c,label,error:String(err.message||err)};}
  finally{await client.close?.();}
}
async function main(){
  const jobs=[]; for(const c of CLUSTERS) for(const w of WEEKS) jobs.push([c,w]);
  let idx=0,done=0; const t0=Date.now();
  async function worker(){while(idx<jobs.length){const [c,w]=jobs[idx++];const r=await cell(c,w);done++;console.log(`[${done}/${jobs.length}] ${r.c} ${r.label} ${r.skipped?'skip':r.ok?'ok':'ERR '+r.error} (${((Date.now()-t0)/1000).toFixed(0)}s)`);}}
  await Promise.all(Array.from({length:5},worker));
  console.log(`DONE in ${((Date.now()-t0)/1000).toFixed(0)}s`);
}
main().catch(e=>{console.error('FATAL',e.message);process.exit(1);});

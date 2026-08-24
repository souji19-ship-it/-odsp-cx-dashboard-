// Global-distinct pull for a window: returns make_set of UserId/TenantId/ConvId (ODSP)
// per cluster so we can UNION client-side => true global distinct (matches Sandeep).
// Also returns 401 with Ok=countif(Success) so we can test both success-rate definitions.
// Run: node pull-cs-distinct.js <startInclusive> <endExclusive> <outDir>
const { Client, KustoConnectionStringBuilder } = require('azure-kusto-data');
const { AzureCliCredential } = require('@azure/identity');
const fs = require('fs');
const path = require('path');

const S = process.argv[2], E = process.argv[3], OUTNAME = process.argv[4];
if (!S || !E || !OUTNAME) { console.error('usage: node pull-cs-distinct.js <start> <endExclusive> <outDir>'); process.exit(1); }
const OUT = path.join(__dirname, OUTNAME);
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
const APP = `applicationName in ("fabric:/CopilotStudio.AgenticRuntime","fabric:/CopilotStudio.AgenticLoopApp")`;

function qsets() { return `
TraceEvents
| where env_time >= datetime(${S}) and env_time < datetime(${E})
| where ${APP}
| where eventName in ('AgenticLoopTurnLatency','AgenticLoopToolCallLatency','KnowledgeSourceLatency')
| extend meta = parse_json(customDimensions)
| extend UserId = tostring(principalObjectId), TenantId = tostring(principalTenantId), ConvId = tostring(meta.ConversationId)
| extend odspHint = (eventName=='AgenticLoopToolCallLatency' and (customDimensions has 'shared_sharepointonline' or customDimensions has 'shared_onedriveforbusiness'))
                 or (eventName=='KnowledgeSourceLatency' and customDimensions has 'SharePoint')
| extend nd = iff(odspHint, parse_json(tostring(meta.CustomDimensions)), dynamic(null))
| extend Conn = tolower(tostring(nd.ConnectorId)), KSrc = tostring(nd.KnowledgeSource)
| extend IsODSPtool = eventName=='AgenticLoopToolCallLatency' and Conn in ('shared_sharepointonline','shared_onedriveforbusiness')
| extend IsODSPknow = eventName=='KnowledgeSourceLatency' and KSrc in ('SharePoint','SharePointList')
| extend IsODSP = IsODSPtool or IsODSPknow
| where IsODSP
| summarize users=make_set_if(UserId, isnotempty(UserId), 1048576),
            tenants=make_set_if(TenantId, isnotempty(TenantId), 1048576),
            tasks=make_set_if(ConvId, isnotempty(ConvId), 1048576)`;
}
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
| extend Ok = tostring(nd.Success)=='True', FC = tostring(nd.FailureClass)
| summarize Calls=count(), Ok=countif(Ok), SvcF=countif(FC=='Service')`;
}
function clientFor(c){return new Client(KustoConnectionStringBuilder.withTokenCredential(`https://${c}.kusto.windows.net`, new AzureCliCredential()));}
async function runRetry(client,query,tries=3){let le;for(let i=0;i<tries;i++){try{const r=await client.execute('CAPAnalytics',query);return r.primaryResults[0].toJSON().data;}catch(e){le=e;await new Promise(r=>setTimeout(r,5000*(i+1)));}}throw le;}
async function cell(c){
  const f=path.join(OUT,`${c}.json`);
  if(fs.existsSync(f)) return {c,skipped:true};
  const client=clientFor(c);
  try{
    const [sets,r401]=await Promise.all([runRetry(client,qsets()),runRetry(client,q401())]);
    fs.writeFileSync(f,JSON.stringify({c,sets,r401}));
    return {c,ok:true};
  }catch(err){fs.writeFileSync(f.replace('.json','.ERROR.json'),JSON.stringify({c,error:String(err.message||err)}));return {c,error:String(err.message||err)};}
  finally{await client.close?.();}
}
async function main(){
  console.log(`distinct ${S}..${E} -> ${OUTNAME}`);
  let idx=0,done=0;const t0=Date.now();
  async function w(){while(idx<CLUSTERS.length){const c=CLUSTERS[idx++];const r=await cell(c);done++;console.log(`[${done}/${CLUSTERS.length}] ${r.c} ${r.skipped?'skip':r.ok?'ok':'ERR '+r.error} (${((Date.now()-t0)/1000).toFixed(0)}s)`);}}
  await Promise.all(Array.from({length:5},w));
  console.log(`DONE ${OUTNAME} in ${((Date.now()-t0)/1000).toFixed(0)}s`);
}
main().catch(e=>{console.error('FATAL',e.message);process.exit(1);});

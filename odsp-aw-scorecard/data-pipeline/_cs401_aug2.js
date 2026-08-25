// Targeted Aug 2-8 pull of CS ODSP 401 (+301 for cross-check) using the EXACT
// q401/q301 from pull-cs-odsp.js. Single week only (fits timeout). Writes
// per-cluster JSON into cs-pull/ with __Aug_2_8 tag for merge-cs-aug2.js.
const { Client, KustoConnectionStringBuilder } = require('azure-kusto-data');
const { AzureCliCredential } = require('@azure/identity');
const fs = require('fs'); const path = require('path');
const OUT = path.join(__dirname, 'cs-pull'); fs.mkdirSync(OUT, { recursive: true });
const CLUSTERS = [
  'fdislandsus.centralus','fdislandseu.westeurope','fdislandsin.centralindia',
  'fdislandsjp.japaneast','fdislandsau.australiaeast','fdislandsuk.uksouth',
  'fdislandsca.canadacentral','fdislandsbr.brazilsouth','fdislandsfr.francecentral',
  'fdislandsde.germanywestcentral','fdislandsch.switzerlandnorth','fdislandsno.norwayeast',
  'fdislandsse.swedencentral','fdislandsit.italynorth','fdislandsza.southafricanorth',
  'fdislandsae.uaenorth','fdislandskr.koreasouth','fdislandsas.southeastasia',
  'fdislandssg.southeastasia'];
const WK = ['Aug 2-8', '2026-08-02', '2026-08-09'];
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
| extend Conn = tolower(tostring(nd.ConnectorId)), KCat = tostring(nd.KnowledgeCategory), KSrc = tostring(nd.KnowledgeSource)
| extend IsTool = eventName=='AgenticLoopToolCallLatency', IsTurn = eventName=='AgenticLoopTurnLatency'
| extend IsODSPtool = IsTool and Conn in ('shared_sharepointonline','shared_onedriveforbusiness')
| extend IsODSPknow = eventName=='KnowledgeSourceLatency' and KSrc in ('SharePoint','SharePointList')
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
function clientFor(c){return new Client(KustoConnectionStringBuilder.withTokenCredential(`https://${c}.kusto.windows.net`, new AzureCliCredential()));}
async function runRetry(client, q, tries=3){let le;for(let i=0;i<tries;i++){try{const r=await client.execute('CAPAnalytics',q);return r.primaryResults[0].toJSON().data;}catch(e){le=e;await new Promise(r=>setTimeout(r,5000*(i+1)));}}throw le;}
async function cell(c){const[label,s,e]=WK;const f=path.join(OUT,`${c}__${label.replace(/[^\w]+/g,'_')}.json`);if(fs.existsSync(f))return{c,skipped:true};const client=clientFor(c);try{const[r401,r301]=await Promise.all([runRetry(client,q401(s,e)),runRetry(client,q301(s,e))]);fs.writeFileSync(f,JSON.stringify({cluster:c,label,r401,r301}));return{c,ok:true,ops:r401.length};}catch(err){fs.writeFileSync(f.replace('.json','.ERROR.json'),JSON.stringify({c,error:String(err.message||err)}));return{c,error:String(err.message||err)};}finally{await client.close?.();}}
async function main(){let idx=0,done=0;const t0=Date.now();async function w(){while(idx<CLUSTERS.length){const c=CLUSTERS[idx++];const r=await cell(c);done++;console.log(`[${done}/${CLUSTERS.length}] ${r.c} ${r.skipped?'skip':r.ok?'ok('+r.ops+'ops)':'ERR '+r.error} (${((Date.now()-t0)/1000).toFixed(0)}s)`);}}await Promise.all(Array.from({length:4},w));console.log(`DONE ${((Date.now()-t0)/1000).toFixed(0)}s`);}
main().catch(e=>{console.error('FATAL',e.message);process.exit(1);});

// validate-cs-fanout.js — per-cluster parallel run of Sandeep's authoritative
// ODSP-CS filters. Distinct metrics via make_set (exact union); Tasks via
// per-cluster dcount (ConversationId is region-local) summed; counts summed.
const { Client, KustoConnectionStringBuilder, ClientRequestProperties } = require('azure-kusto-data');
const { AzureCliCredential } = require('@azure/identity');
const fs = require('fs'); const path = require('path');

const OUT = path.join(__dirname, 'cs-validate-tier'); fs.mkdirSync(OUT, { recursive: true });
const CLUSTERS = [
 'fdislandsus.centralus','fdislandsas.southeastasia','fdislandsau.australiaeast',
 'fdislandsbr.brazilsouth','fdislandsca.canadacentral','fdislandsch.switzerlandnorth',
 'fdislandsde.germanywestcentral','fdislandseu.westeurope','fdislandsfr.francecentral',
 'fdislandsin.centralindia','fdislandsjp.japaneast','fdislandskr.koreasouth',
 'fdislandsno.norwayeast','fdislandsse.swedencentral','fdislandssg.southeastasia',
 'fdislandsuk.uksouth','fdislandsza.southafricanorth'];

const KQL = `
let StartWeek = datetime(2026-07-12);
let apps = dynamic(['fabric:/CopilotStudio.AgenticRuntime','fabric:/CopilotStudio.AgenticLoopApp']);
let ODSPconn = dynamic(['shared_sharepointonline','shared_onedriveforbusiness']);
let ODSPks = dynamic(['SharePoint','SharePointList']);
TraceEvents
| where env_time >= StartWeek
| where applicationName in (apps)
| where eventName in ('AgenticLoopToolCallLatency','KnowledgeSourceLatency')
| where (eventName == 'AgenticLoopToolCallLatency' and (customDimensions contains 'shared_sharepointonline' or customDimensions contains 'shared_onedriveforbusiness'))
     or (eventName == 'KnowledgeSourceLatency' and customDimensions contains 'SharePoint')
| extend cd = parse_json(customDimensions)
| extend inner = parse_json(tostring(cd.CustomDimensions))
| extend conn = tostring(inner.ConnectorId), ks = tostring(inner.KnowledgeSource)
| extend isTool = (eventName == 'AgenticLoopToolCallLatency' and conn in (ODSPconn)),
         isKnow = (eventName == 'KnowledgeSourceLatency' and ks in (ODSPks))
| where isTool or isKnow
| extend Ch = tolower(tostring(cd.ChannelId))
| extend Tier = iff(Ch in ('pva-studio','pva-maker-evaluation'),'C1','C2')
| extend Wk = startofweek(env_time)
| extend svcFail = iff(isTool and tostring(inner.FailureClass) == 'Service', 1, 0),
         isPatch = iff(isTool and tostring(inner.OperationId) == 'PatchItem', 1, 0)
| summarize Users = make_set(tostring(principalObjectId), 1048576),
            Tenants = make_set(tostring(principalTenantId), 1048576),
            Agents = make_set(tostring(cd.CdsBotId), 1048576),
            Tasks = dcount(tostring(cd.ConversationId)),
            Tools = countif(isTool), Knows = countif(isKnow),
            SvcFail = sum(svcFail), Patch = sum(isPatch) by Wk, Tier
| extend WeekLabel = strcat(format_datetime(Wk,'MM/dd'), '-', format_datetime(Wk + 6d,'MM/dd'))
`;

function clientFor(c){return new Client(KustoConnectionStringBuilder.withTokenCredential(`https://${c}.kusto.windows.net`, new AzureCliCredential()));}
async function runRetry(client, tries=3){let le;for(let i=0;i<tries;i++){try{const p=new ClientRequestProperties();p.setTimeout(6*60*1000);p.setOption('servertimeout','00:05:00');const r=await client.executeQuery('CAPAnalytics',KQL,p);return r.primaryResults[0].toJSON().data;}catch(e){le=e;await new Promise(r=>setTimeout(r,4000*(i+1)));}}throw le;}
async function cell(c){const f=path.join(OUT,`${c}.json`);if(fs.existsSync(f))return{c,skipped:true};const client=clientFor(c);try{const rows=await runRetry(client);fs.writeFileSync(f,JSON.stringify({c,rows}));return{c,ok:true,weeks:rows.length};}catch(err){fs.writeFileSync(f.replace('.json','.ERROR.json'),JSON.stringify({c,error:String(err.message||err)}));return{c,error:String(err.message||err)};}finally{await client.close?.();}}
async function main(){let idx=0,done=0;const t0=Date.now();async function w(){while(idx<CLUSTERS.length){const c=CLUSTERS[idx++];const r=await cell(c);done++;console.log(`[${done}/${CLUSTERS.length}] ${r.c} ${r.skipped?'skip':r.ok?'ok w='+r.weeks:'ERR '+r.error} (${((Date.now()-t0)/1000).toFixed(0)}s)`);}}await Promise.all(Array.from({length:5},w));console.log(`DONE ${((Date.now()-t0)/1000).toFixed(0)}s`);}
main().catch(e=>{console.error('FATAL',e.message);process.exit(1);});

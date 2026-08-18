// All-up CS 201 dcount by (Prod,Tier) for Aug 2-8, per cluster (cached), via Node SDK.
// Prod=IsDesignMode false; Tier from ChannelId. Union of 4 agentic events (owner def).
// Segment sub-rows use summed-dcount (region-local approx, same as prior scorecard);
// all-up TOTAL is overridden with the exact make_set union elsewhere.
const { Client, KustoConnectionStringBuilder } = require('azure-kusto-data');
const { AzureCliCredential } = require('@azure/identity');
const fs = require('fs'); const path = require('path');
const OUT = path.join(__dirname, process.env.CS_SEG_OUT || 'cs201seg-aug2'); fs.mkdirSync(OUT, { recursive: true });
const CLUSTERS = [
  'fdislandsus.centralus','fdislandseu.westeurope','fdislandsin.centralindia',
  'fdislandsjp.japaneast','fdislandsau.australiaeast','fdislandsuk.uksouth',
  'fdislandsca.canadacentral','fdislandsbr.brazilsouth','fdislandsfr.francecentral',
  'fdislandsde.germanywestcentral','fdislandsch.switzerlandnorth','fdislandsno.norwayeast',
  'fdislandsse.swedencentral','fdislandsit.italynorth','fdislandsza.southafricanorth',
  'fdislandsae.uaenorth','fdislandskr.koreasouth','fdislandsas.southeastasia',
  'fdislandssg.southeastasia'];
const S=process.env.CS_START_WEEK || '2026-08-02', E=process.env.CS_END_WEEK || '2026-08-09';
const APP = `applicationName in ("fabric:/CopilotStudio.AgenticRuntime","fabric:/CopilotStudio.AgenticLoopApp")`;
const KQL = `
TraceEvents
| where env_time >= datetime(${S}) and env_time < datetime(${E})
| where ${APP}
| where eventName in ('AgenticLoopTurnLatency','AgenticLoopToolCallLatency','KnowledgeSourceLatency','AgenticLoopLlmCallLatency')
| extend meta = parse_json(customDimensions)
| extend Ch = tolower(tostring(meta.ChannelId)), IsDesign = tolower(tostring(meta.IsDesignMode))
| extend Tier = iff(Ch in ('pva-studio','pva-maker-evaluation'),'C1','C2')
| extend Prod = iff(IsDesign=='true','NonProd','Prod')
| summarize Users=dcount(tostring(principalObjectId)), Tenants=dcount(tostring(principalTenantId)),
            Agents=dcount(tostring(meta.CdsBotId)), Tasks=dcount(tostring(meta.ConversationId)),
            Tools=countif(eventName=='AgenticLoopToolCallLatency') by Prod, Tier`;
function clientFor(c){return new Client(KustoConnectionStringBuilder.withTokenCredential(`https://${c}.kusto.windows.net`, new AzureCliCredential()));}
async function runRetry(client, tries=4){let le;for(let i=0;i<tries;i++){try{const r=await client.execute('CAPAnalytics',KQL);return r.primaryResults[0].toJSON().data;}catch(e){le=e;await new Promise(r=>setTimeout(r,6000*(i+1)));}}throw le;}
async function cell(c){const f=path.join(OUT,`${c}.json`);if(fs.existsSync(f))return{c,skipped:true};const client=clientFor(c);try{const rows=await runRetry(client);fs.writeFileSync(f,JSON.stringify({c,rows}));return{c,ok:true,rows:rows.length};}catch(err){fs.writeFileSync(f.replace('.json','.ERROR.json'),JSON.stringify({c,error:String(err.message||err)}));return{c,error:String(err.message||err)};}finally{await client.close?.();}}
async function main(){let idx=0,done=0;const t0=Date.now();async function w(){while(idx<CLUSTERS.length){const c=CLUSTERS[idx++];const r=await cell(c);done++;console.log(`[${done}/${CLUSTERS.length}] ${r.c} ${r.skipped?'skip':r.ok?'ok('+r.rows+')':'ERR '+r.error} (${((Date.now()-t0)/1000).toFixed(0)}s)`);}}await Promise.all(Array.from({length:3},w));
  // aggregate
  const seg={}; for(const k of ['Prod|C1','Prod|C2','NonProd|C1','NonProd|C2']) seg[k]={Users:0,Tenants:0,Agents:0,Tasks:0,Tools:0};
  let miss=[];
  for(const c of CLUSTERS){const f=path.join(OUT,`${c}.json`);if(!fs.existsSync(f)){miss.push(c);continue;}const j=JSON.parse(fs.readFileSync(f,'utf8'));for(const r of j.rows){const k=`${r.Prod}|${r.Tier}`;if(seg[k]){for(const m of ['Users','Tenants','Agents','Tasks','Tools'])seg[k][m]+=Number(r[m])||0;}}}
  const S2=(a,b)=>({Users:a.Users+b.Users,Tenants:a.Tenants+b.Tenants,Agents:a.Agents+b.Agents,Tasks:a.Tasks+b.Tasks,Tools:a.Tools+b.Tools});
  const out={Prod_C1:seg['Prod|C1'],Prod_C2:seg['Prod|C2'],Prod_T:S2(seg['Prod|C1'],seg['Prod|C2']),
    NonProd_C1:seg['NonProd|C1'],NonProd_C2:seg['NonProd|C2'],NonProd_T:S2(seg['NonProd|C1'],seg['NonProd|C2']),
    Allup_C1:S2(seg['Prod|C1'],seg['NonProd|C1']),Allup_C2:S2(seg['Prod|C2'],seg['NonProd|C2']),
    Allup_T:S2(S2(seg['Prod|C1'],seg['Prod|C2']),S2(seg['NonProd|C1'],seg['NonProd|C2']))};
  const outFile=process.env.CS_SEG_AGG_OUT||'cs201seg-aug2.json';
  fs.writeFileSync(path.join(__dirname,outFile),JSON.stringify(out,null,2));
  console.log('missing clusters:',miss.length?miss.join(','):'none');
  console.log(JSON.stringify(out,null,2));
  console.log(`DONE ${((Date.now()-t0)/1000).toFixed(0)}s`);}
main().catch(e=>{console.error('FATAL',e.message);process.exit(1);});

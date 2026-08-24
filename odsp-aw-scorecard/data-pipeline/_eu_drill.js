const { Client, KustoConnectionStringBuilder } = require('azure-kusto-data');
const { AzureCliCredential } = require('@azure/identity');
const S=process.argv[2], E=process.argv[3];
const APP=`applicationName in ("fabric:/CopilotStudio.AgenticRuntime","fabric:/CopilotStudio.AgenticLoopApp")`;
const q=`
TraceEvents
| where env_time >= datetime(${S}) and env_time < datetime(${E})
| where ${APP}
| where eventName == 'AgenticLoopToolCallLatency'
| extend meta=parse_json(customDimensions)
| extend inner=parse_json(tostring(meta.CustomDimensions))
| extend Conn=tolower(tostring(inner.ConnectorId))
| where Conn in ('shared_sharepointonline','shared_onedriveforbusiness')
| extend TenantId=tostring(principalTenantId), AgentId=tostring(meta.CdsBotId)
| summarize Calls=count(), Tasks=dcount(tostring(meta.ConversationId)), Users=dcount(tostring(principalObjectId)) by TenantId
| top 12 by Calls desc`;
(async()=>{
  const c=new Client(KustoConnectionStringBuilder.withTokenCredential('https://fdislandseu.westeurope.kusto.windows.net', new AzureCliCredential()));
  const r=await c.execute('CAPAnalytics',q);
  const rows=r.primaryResults[0].toJSON().data;
  console.log(`West Europe ODSP tool calls by tenant  ${S}..${E}`);
  let tot=0; for(const x of rows) tot+=x.Calls;
  console.log('rank  calls        tasks    users   tenant');
  rows.forEach((x,i)=>console.log(`${String(i+1).padStart(2)}  ${String(x.Calls).padStart(9)}  ${String(x.Tasks).padStart(7)}  ${String(x.Users).padStart(6)}   ${x.TenantId}`));
  await c.close?.();
})().catch(e=>{console.error(e.message);process.exit(1);});

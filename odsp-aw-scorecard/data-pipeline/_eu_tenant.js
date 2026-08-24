const { Client, KustoConnectionStringBuilder } = require('azure-kusto-data');
const { AzureCliCredential } = require('@azure/identity');
const T='a376937a-74b0-41c5-98e1-6157ec71fafc';
const APP=`applicationName in ("fabric:/CopilotStudio.AgenticRuntime","fabric:/CopilotStudio.AgenticLoopApp")`;
const q=`
TraceEvents
| where env_time >= datetime(2026-08-16) and env_time < datetime(2026-08-23)
| where ${APP}
| where principalTenantId == '${T}'
| extend meta=parse_json(customDimensions)
| extend inner=parse_json(tostring(meta.CustomDimensions))
| extend Conn=tolower(tostring(inner.ConnectorId)), KSrc=tostring(inner.KnowledgeSource),
         Cat=tostring(inner.ToolCategory), FC=tostring(inner.FailureClass)
| extend IsODSPtool = eventName=='AgenticLoopToolCallLatency' and Conn in ('shared_sharepointonline','shared_onedriveforbusiness')
| extend IsODSPknow = eventName=='KnowledgeSourceLatency' and KSrc in ('SharePoint','SharePointList')
| summarize ToolCalls=countif(IsODSPtool), Knowledge=countif(IsODSPknow),
    Elig=countif(IsODSPtool and Cat!='ConsentPending'),
    SvcF=countif(IsODSPtool and Cat!='ConsentPending' and FC=='Service'),
    Agents=dcount(tostring(meta.CdsBotId)), Tasks=dcount(tostring(meta.ConversationId))`;
(async()=>{
  const c=new Client(KustoConnectionStringBuilder.withTokenCredential('https://fdislandseu.westeurope.kusto.windows.net', new AzureCliCredential()));
  const r=await c.execute('CAPAnalytics',q);
  console.log(JSON.stringify(r.primaryResults[0].toJSON().data[0],null,2));
  await c.close?.();
})().catch(e=>{console.error(e.message);process.exit(1);});

// run-cs-validate.js — runs Sandeep's EXACT authoritative CS ODSP query
// (from chat screenshot) via cross-cluster federation on a driver cluster.
const { Client, KustoConnectionStringBuilder, ClientRequestProperties } = require('azure-kusto-data');
const { AzureCliCredential } = require('@azure/identity');
const fs = require('fs');

const DRIVER = 'https://fdislandsus.centralus.kusto.windows.net';

const KQL = `
set query_results_cache_max_age = time(24h);
set best_effort = true;
let StartWeek = datetime(2026-07-12);
let apps = dynamic(['fabric:/CopilotStudio.AgenticRuntime','fabric:/CopilotStudio.AgenticLoopApp']);
let ODSPconn = dynamic(['shared_sharepointonline','shared_onedriveforbusiness']);
let ODSPks = dynamic(['SharePoint','SharePointList']);
let D = (T:(env_time:datetime, applicationName:string, eventName:string, principalObjectId:string, principalTenantId:string, customDimensions:string)) {
    T
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
    | extend Wk = startofweek(env_time)
    | extend svcFail = iff(isTool and tostring(inner.FailureClass) == 'Service', 1, 0),
             isPatch = iff(isTool and tostring(inner.OperationId) == 'PatchItem', 1, 0)
    | summarize hU = hll(tostring(principalObjectId)), hT = hll(tostring(principalTenantId)),
                hA = hll(tostring(cd.CdsBotId)), hC = hll(tostring(cd.ConversationId)),
                Tools = countif(isTool), Knows = countif(isKnow), SvcFail = sum(svcFail), Patch = sum(isPatch) by Wk
};
union isfuzzy=true
  D(cluster('fdislandsus.centralus.kusto.windows.net').database('CAPAnalytics').TraceEvents),
  D(cluster('fdislandsas.southeastasia.kusto.windows.net').database('CAPAnalytics').TraceEvents),
  D(cluster('fdislandsau.australiaeast.kusto.windows.net').database('CAPAnalytics').TraceEvents),
  D(cluster('fdislandsbr.brazilsouth.kusto.windows.net').database('CAPAnalytics').TraceEvents),
  D(cluster('fdislandsca.canadacentral.kusto.windows.net').database('CAPAnalytics').TraceEvents),
  D(cluster('fdislandsch.switzerlandnorth.kusto.windows.net').database('CAPAnalytics').TraceEvents),
  D(cluster('fdislandsde.germanywestcentral.kusto.windows.net').database('CAPAnalytics').TraceEvents),
  D(cluster('fdislandseu.westeurope.kusto.windows.net').database('CAPAnalytics').TraceEvents),
  D(cluster('fdislandsfr.francecentral.kusto.windows.net').database('CAPAnalytics').TraceEvents),
  D(cluster('fdislandsin.centralindia.kusto.windows.net').database('CAPAnalytics').TraceEvents),
  D(cluster('fdislandsjp.japaneast.kusto.windows.net').database('CAPAnalytics').TraceEvents),
  D(cluster('fdislandskr.koreasouth.kusto.windows.net').database('CAPAnalytics').TraceEvents),
  D(cluster('fdislandsno.norwayeast.kusto.windows.net').database('CAPAnalytics').TraceEvents),
  D(cluster('fdislandsse.swedencentral.kusto.windows.net').database('CAPAnalytics').TraceEvents),
  D(cluster('fdislandssg.southeastasia.kusto.windows.net').database('CAPAnalytics').TraceEvents),
  D(cluster('fdislandsuk.uksouth.kusto.windows.net').database('CAPAnalytics').TraceEvents),
  D(cluster('fdislandsza.southafricanorth.kusto.windows.net').database('CAPAnalytics').TraceEvents)
| summarize hU = hll_merge(hU), hT = hll_merge(hT), hA = hll_merge(hA), hC = hll_merge(hC),
            Tools = sum(Tools), Knows = sum(Knows), SvcFail = sum(SvcFail), Patch = sum(Patch) by Wk
| extend WeekLabel = strcat(format_datetime(Wk,'MM/dd'), '-', format_datetime(Wk + 6d,'MM/dd'))
| order by Wk asc
| project WeekLabel,
    ActiveUsers = dcount_hll(hU), ActiveTenants = dcount_hll(hT), ActiveAgents = dcount_hll(hA),
    Tasks = dcount_hll(hC), ToolCalls = Tools,
    ToolSuccessPct = iff(Tools > 0, round(100.0 * (1.0 - todouble(SvcFail) / Tools), 1), real(null)),
    PatchItem = Patch, SharePointKnowledge = Knows
`;

(async () => {
  const client = new Client(KustoConnectionStringBuilder.withTokenCredential(DRIVER, new AzureCliCredential()));
  const props = new ClientRequestProperties();
  props.setTimeout(9 * 60 * 1000);
  props.setOption('servertimeout', '00:08:00');
  const r = await client.executeQuery('CAPAnalytics', KQL, props);
  const rows = r.primaryResults[0].toJSON().data;
  fs.writeFileSync('cs-validate-out.json', JSON.stringify(rows, null, 2));
  console.table(rows);
  await client.close?.();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });

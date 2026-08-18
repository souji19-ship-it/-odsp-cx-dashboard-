// Targeted re-pull of centralus (largest cluster) for the single Aug 2-8 week,
// which timed out in the full multi-week fanout. Same ODSP-CS filters / corrected
// knowledge basis as validate-cs-fanout-tier.js. Writes the cluster's json into
// cs-validate-tier so validate-cs-tier-agg.js picks it up for the Aug 2-8 row.
const { Client, KustoConnectionStringBuilder, ClientRequestProperties } = require('azure-kusto-data');
const { AzureCliCredential } = require('@azure/identity');
const fs = require('fs'); const path = require('path');
const OUT = path.join(__dirname, 'cs-validate-tier');
const C = 'fdislandsus.centralus';
const KQL = `
let StartWeek = datetime(2026-08-02);
let EndWeek = datetime(2026-08-09);
let apps = dynamic(['fabric:/CopilotStudio.AgenticRuntime','fabric:/CopilotStudio.AgenticLoopApp']);
let ODSPconn = dynamic(['shared_sharepointonline','shared_onedriveforbusiness']);
let ODSPks = dynamic(['SharePoint','SharePointList']);
TraceEvents
| where env_time >= StartWeek and env_time < EndWeek
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
(async () => {
  const client = new Client(KustoConnectionStringBuilder.withTokenCredential(`https://${C}.kusto.windows.net`, new AzureCliCredential()));
  const p = new ClientRequestProperties();
  p.setTimeout(9 * 60 * 1000); p.setOption('servertimeout', '00:08:00');
  const r = await client.executeQuery('CAPAnalytics', KQL, p);
  const rows = r.primaryResults[0].toJSON().data;
  fs.writeFileSync(path.join(OUT, `${C}.json`), JSON.stringify({ c: C, rows }));
  console.log('OK', C, 'rows', rows.length, rows.map(x => `${x.WeekLabel}/${x.Tier} U=${(x.Users||[]).length} Tk=${x.Tasks} Tl=${x.Tools} Kn=${x.Knows}`).join(' | '));
  await client.close?.();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });

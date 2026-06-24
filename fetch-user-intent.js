'use strict';

const fs   = require('fs');
const path = require('path');
const { Client: KustoClient, KustoConnectionStringBuilder } = require('azure-kusto-data');
const { DefaultAzureCredential } = require('@azure/identity');

const CLUSTER  = 'https://odxaugloop.eastus.kusto.windows.net';
const DATABASE = 'ODX AugLoop Service';
const OUT      = path.join(__dirname, 'data', 'user-intent.json');

const QUERY = `
let _end = now();
let _start = _end - 28d;
WorkflowOperationEvent
| where TIMESTAMP between (_start .. _end)
| where workflow == 'SharepointKnowledgeAgent'
| where clientReleaseAudienceGroup == 'Production'
| where operationName == 'AgentRuntimeEvalDimension'
| where dimension0 == 'sendMessageStreamingOperation'
| extend datafield = parse_json(dataFields)
| extend mainCategory = tostring(datafield['UserIntent.main_category'])
| extend subCategory  = tostring(datafield['UserIntent.sub_category'])
| extend queryId      = tostring(datafield.queryId)
| where isnotempty(mainCategory)
| join kind=leftouter (
    WorkflowOperationEvent
    | where TIMESTAMP between (_start .. _end)
    | where workflow == 'EvaluationWorkflow'
    | where clientReleaseAudienceGroup == 'Production'
    | where operationName == 'EVAL__DIMENSIONS'
    | where dimension0 == 'OnDemandFromChat'
    | extend dataField = parse_json(dataFields)
    | extend queryId   = tostring(dataField.queryId)
    | extend feedback  = tostring(dataField.FeedbackType)
    | project queryId, feedback
) on queryId
| summarize
    Total      = count(),
    ThumbsUp   = countif(feedback =~ 'ThumbsUp'),
    ThumbsDown = countif(feedback =~ 'ThumbsDown')
  by mainCategory, subCategory
| order by Total desc
`.trim();

async function main() {
  console.log('[fetch-user-intent] Connecting to AugLoop Kusto...');

  const kcsb   = KustoConnectionStringBuilder.withTokenCredential(CLUSTER, new DefaultAzureCredential());
  const client = new KustoClient(kcsb);

  console.log('[fetch-user-intent] Running 28-day intent query...');
  const response = await client.execute(DATABASE, QUERY);
  const table    = response.primaryResults[0];

  const rows = [];
  for (const row of table.rows()) {
    rows.push({
      main_category: row.getValueAt(0) ?? '',
      sub_category:  row.getValueAt(1) ?? '',
      total:         Number(row.getValueAt(2)) || 0,
      thumbs_up:     Number(row.getValueAt(3)) || 0,
      thumbs_down:   Number(row.getValueAt(4)) || 0,
    });
  }

  const out = { fetchedAt: new Date().toISOString(), rows };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`[fetch-user-intent] ✅ ${rows.length} rows written to data/user-intent.json`);

  client.close();
}

main().catch(err => {
  console.error('[fetch-user-intent] ERROR:', err.message || err);
  process.exit(1);
});

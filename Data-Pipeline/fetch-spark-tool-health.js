'use strict';

const fs   = require('fs');
const path = require('path');
const { Client: KustoClient, KustoConnectionStringBuilder } = require('azure-kusto-data');
const { DefaultAzureCredential } = require('@azure/identity');

const CLUSTER  = 'https://odxaugloop.eastus.kusto.windows.net';
const DATABASE = 'ODX AugLoop Service';
const OUT_DIR  = process.env.ODSP_DATA_DIR || path.join(__dirname, '..', 'Data-Public', 'spark');
const OUT      = path.join(OUT_DIR, 'spark-tool-health.json');

// SPARK SP tool call health — 7 day production
// Uses native durationMs column + dimension0 for tool name
const QUERY = `
let _end = now();
let _start = _end - 7d;
WorkflowOperationEvent
| where TIMESTAMP between (_start .. _end)
| where workflow == 'SharepointKnowledgeAgent'
| where clientReleaseAudienceGroup == 'Production'
| where operationName == 'ODSPAgentRuntime_tool_invoke'
| extend toolName = dimension0
| where isnotempty(toolName)
| extend datafield = parse_json(dataFields)
| extend outputSize = tolong(datafield['Data.m_ToolOutputSize'])
| extend sourceAttribs = tolong(datafield['Data.m_SourceAttributionsCount'])
| extend timeToFirstChunk = tolong(datafield['Data.m_TimeToFirstChunkMs'])
| summarize
    Total        = count(),
    AvgLatencyMs = avg(durationMs),
    P50Ms        = percentile(durationMs, 50),
    P95Ms        = percentile(durationMs, 95),
    P99Ms        = percentile(durationMs, 99),
    AvgOutputKB  = avg(outputSize) / 1024.0,
    AvgSources   = avg(sourceAttribs)
  by toolName
| extend SuccessProxy = iff(AvgOutputKB > 0, 'likely_success', 'check')
| order by Total desc
`.trim();

// Daily trend for top tools
const DAILY_TREND = `
let _end = now();
let _start = _end - 7d;
WorkflowOperationEvent
| where TIMESTAMP between (_start .. _end)
| where workflow == 'SharepointKnowledgeAgent'
| where clientReleaseAudienceGroup == 'Production'
| where operationName == 'ODSPAgentRuntime_tool_invoke'
| extend toolName = dimension0
| where toolName in ('list_items', 'cat_file', 'learn_tool', 'find_items', 'search_content_tool',
                      'discover_sharepoint_lists', 'create_or_update_list', 'create_list_items',
                      'execute_code', 'read_from_workspace')
| summarize
    Calls       = count(),
    AvgLatMs    = avg(durationMs),
    P95LatMs    = percentile(durationMs, 95)
  by toolName, Day = bin(TIMESTAMP, 1d)
| order by Day asc, Calls desc
`.trim();

async function main() {
  console.log('[spark-tool-health] Connecting...');
  const kcsb = KustoConnectionStringBuilder.withTokenCredential(CLUSTER, new DefaultAzureCredential());
  const client = new KustoClient(kcsb);
  const results = {};

  for (const [name, query] of [['summary', QUERY], ['daily_trend', DAILY_TREND]]) {
    console.log(`  Running: ${name}...`);
    try {
      const resp = await client.execute(DATABASE, query);
      const table = resp.primaryResults[0];
      const cols = table.columns.map(c => c.name);
      const rows = [];
      for (const row of table.rows()) {
        const obj = {};
        cols.forEach((col, i) => { obj[col] = row.getValueAt(i); });
        rows.push(obj);
      }
      results[name] = { row_count: rows.length, rows };
      console.log(`    ✅ ${rows.length} rows`);
    } catch (e) {
      console.log(`    ❌ ${e.message}`);
      results[name] = { error: e.message };
    }
  }

  results.fetchedAt = new Date().toISOString();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
  console.log(`✅ Written to ${OUT}`);
  client.close();
}

main().catch(err => { console.error('ERROR:', err.message); process.exit(1); });

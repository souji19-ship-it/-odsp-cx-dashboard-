const { Client, KustoConnectionStringBuilder, ClientRequestProperties } = require('azure-kusto-data');
const { AzureCliCredential } = require('@azure/identity');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'cs-audit-aug15');
fs.mkdirSync(OUT, { recursive: true });

const CLUSTERS = [
  'fdislandsus.centralus', 'fdislandseu.westeurope', 'fdislandsin.centralindia',
  'fdislandsjp.japaneast', 'fdislandsau.australiaeast', 'fdislandsuk.uksouth',
  'fdislandsca.canadacentral', 'fdislandsbr.brazilsouth', 'fdislandsfr.francecentral',
  'fdislandsde.germanywestcentral', 'fdislandsch.switzerlandnorth', 'fdislandsno.norwayeast',
  'fdislandsse.swedencentral', 'fdislandsit.italynorth', 'fdislandsza.southafricanorth',
  'fdislandsae.uaenorth', 'fdislandskr.koreasouth', 'fdislandsas.southeastasia',
  'fdislandssg.southeastasia',
];

const BASE = `
let Start = datetime(2026-08-02);
let End = datetime(2026-08-16);
let Apps = dynamic(['fabric:/CopilotStudio.AgenticRuntime','fabric:/CopilotStudio.AgenticLoopApp']);
let Connectors = dynamic(['shared_sharepointonline','shared_onedriveforbusiness']);
let KnowledgeSources = dynamic(['SharePoint','SharePointList']);
TraceEvents
| where env_time >= Start and env_time < End
| where applicationName in (Apps)
`;

const TASK_QUERY = `${BASE}
| where eventName in ('AgenticLoopToolCallLatency','KnowledgeSourceLatency')
| where (eventName == 'AgenticLoopToolCallLatency' and
         (customDimensions contains 'shared_sharepointonline' or customDimensions contains 'shared_onedriveforbusiness'))
      or (eventName == 'KnowledgeSourceLatency' and customDimensions contains 'SharePoint')
| extend meta = parse_json(customDimensions)
| extend inner = parse_json(tostring(meta.CustomDimensions))
| extend Connector = tolower(tostring(inner.ConnectorId)),
         KnowledgeSource = tostring(inner.KnowledgeSource),
         ConversationId = tostring(meta.ConversationId),
         Channel = tolower(tostring(meta.ChannelId))
| extend IsODSP = (eventName == 'AgenticLoopToolCallLatency' and Connector in (Connectors))
               or (eventName == 'KnowledgeSourceLatency' and KnowledgeSource in (KnowledgeSources))
| where IsODSP and isnotempty(ConversationId)
| extend Week = format_datetime(startofweek(env_time), 'yyyy-MM-dd'),
         Tier = iff(Channel in ('pva-studio','pva-maker-evaluation'),'C1','C2')
| summarize Conversations=make_set(ConversationId, 1048576) by Week, Tier
`;

const LATENCY_QUERY = `${BASE}
| where eventName == 'AgenticLoopToolCallLatency'
| where customDimensions contains 'shared_sharepointonline' or customDimensions contains 'shared_onedriveforbusiness'
| extend meta = parse_json(customDimensions)
| extend inner = parse_json(tostring(meta.CustomDimensions))
| extend Connector = tolower(tostring(inner.ConnectorId)),
         ToolCategory = tostring(inner.ToolCategory),
         Value = todouble(inner.Value)
| where Connector in (Connectors) and ToolCategory != 'ConsentPending' and isfinite(Value)
| extend Week = format_datetime(startofweek(env_time), 'yyyy-MM-dd'),
         Milliseconds = tolong(round(Value, 0))
| summarize Calls=count() by Week, Milliseconds
`;

function clientFor(cluster) {
  return new Client(KustoConnectionStringBuilder.withTokenCredential(
    `https://${cluster}.kusto.windows.net`,
    new AzureCliCredential(),
  ));
}

async function execute(client, query) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const properties = new ClientRequestProperties();
      properties.setTimeout(6 * 60 * 1000);
      properties.setOption('servertimeout', '00:05:00');
      const result = await client.executeQuery('CAPAnalytics', query, properties);
      return result.primaryResults[0].toJSON().data;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, attempt * 5000));
    }
  }
  throw lastError;
}

async function pull(cluster) {
  const file = path.join(OUT, `${cluster}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const client = clientFor(cluster);
  try {
    const [tasks, latency] = await Promise.all([
      execute(client, TASK_QUERY),
      execute(client, LATENCY_QUERY),
    ]);
    const result = { cluster, tasks, latency };
    fs.writeFileSync(file, JSON.stringify(result));
    return result;
  } finally {
    await client.close?.();
  }
}

function percentile(histogram, percentileValue) {
  const entries = [...histogram.entries()].sort((a, b) => a[0] - b[0]);
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  const target = Math.ceil(total * percentileValue);
  let cumulative = 0;
  for (const [value, count] of entries) {
    cumulative += count;
    if (cumulative >= target) return value;
  }
  return null;
}

async function main() {
  const results = [];
  let next = 0;
  async function worker() {
    while (next < CLUSTERS.length) {
      const cluster = CLUSTERS[next++];
      const result = await pull(cluster);
      results.push(result);
      console.log(`[${results.length}/${CLUSTERS.length}] ${cluster}`);
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));

  const weeks = {};
  for (const result of results) {
    for (const row of result.tasks) {
      const week = weeks[row.Week] ||= {
        C1: new Set(), C2: new Set(), Total: new Set(), latency: new Map(),
      };
      for (const conversation of row.Conversations || []) {
        week[row.Tier].add(conversation);
        week.Total.add(conversation);
      }
    }
    for (const row of result.latency) {
      const week = weeks[row.Week] ||= {
        C1: new Set(), C2: new Set(), Total: new Set(), latency: new Map(),
      };
      const ms = Number(row.Milliseconds);
      week.latency.set(ms, (week.latency.get(ms) || 0) + Number(row.Calls || 0));
    }
  }

  const output = {};
  for (const [weekLabel, week] of Object.entries(weeks).sort()) {
    const calls = [...week.latency.values()].reduce((sum, count) => sum + count, 0);
    output[weekLabel] = {
      ODSP_Tasks_C1: week.C1.size,
      ODSP_Tasks_C2: week.C2.size,
      ODSP_Tasks_Total: week.Total.size,
      CrossTierOverlap: week.C1.size + week.C2.size - week.Total.size,
      LatencyCalls: calls,
      LatencyP50Ms: percentile(week.latency, 0.50),
      LatencyP95Ms: percentile(week.latency, 0.95),
    };
  }
  const outputFile = path.join(__dirname, 'cs-audit-aug15.json');
  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});

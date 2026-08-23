// Canonical Copilot Studio weekly pull.
// Uses the matched 17-region population and merges regional HLL sketches.
// Run with optional CS_START/CS_END (end-exclusive) and CS_OUT environment variables.
const { Client, KustoConnectionStringBuilder, ClientRequestProperties } = require('azure-kusto-data');
const { AzureCliCredential } = require('@azure/identity');
const fs = require('fs');
const path = require('path');

const DRIVER = 'https://fdislandsus.centralus.kusto.windows.net';
const START = process.env.CS_START || '2026-08-09';
const END = process.env.CS_END || '2026-08-16';
const GRAIN = process.env.CS_GRAIN || 'week';
const OUT = process.env.CS_OUT || path.join(__dirname, `cs-canonical-${START}.json`);
const OVERRIDES_FILE = path.join(__dirname, 'cs-canonical-overrides.json');
if (!['week', 'period'].includes(GRAIN)) {
  throw new Error(`Unsupported CS_GRAIN "${GRAIN}"; expected "week" or "period"`);
}
const BUCKET = GRAIN === 'period' ? 'Start' : 'startofweek(env_time)';

// Fixed owner population. Italy North and UAE North are not in the canonical matched set.
const CLUSTERS = [
  'fdislandsus.centralus',
  'fdislandsas.southeastasia',
  'fdislandsau.australiaeast',
  'fdislandsbr.brazilsouth',
  'fdislandsca.canadacentral',
  'fdislandsch.switzerlandnorth',
  'fdislandsde.germanywestcentral',
  'fdislandseu.westeurope',
  'fdislandsfr.francecentral',
  'fdislandsin.centralindia',
  'fdislandsjp.japaneast',
  'fdislandskr.koreasouth',
  'fdislandsno.norwayeast',
  'fdislandsse.swedencentral',
  'fdislandssg.southeastasia',
  'fdislandsuk.uksouth',
  'fdislandsza.southafricanorth',
];

const clusterCalls = CLUSTERS.map(cluster =>
  `D(cluster('${cluster}.kusto.windows.net').database('CAPAnalytics').TraceEvents)`
).join(',\n  ');

const KQL = `
set best_effort = true;
let Start = datetime(${START});
let End = datetime(${END});
let Apps = dynamic(['fabric:/CopilotStudio.AgenticRuntime','fabric:/CopilotStudio.AgenticLoopApp']);
let Connectors = dynamic(['shared_sharepointonline','shared_onedriveforbusiness']);
let D = (T:(env_time:datetime, applicationName:string, eventName:string, principalObjectId:string,
           principalTenantId:string, customDimensions:string)) {
  let Base =
    T
    | where env_time >= Start and env_time < End
    | where applicationName in (Apps)
    | where eventName in ('AgenticLoopTurnLatency','AgenticLoopToolCallLatency',
                          'KnowledgeSourceLatency','AgenticLoopLlmCallLatency')
    | extend meta = parse_json(customDimensions)
    | extend inner = parse_json(tostring(meta.CustomDimensions))
    | extend Connector = tolower(tostring(inner.ConnectorId)),
             KnowledgeSource = tostring(inner.KnowledgeSource),
             ToolCategory = tostring(inner.ToolCategory),
             FailureClass = tostring(inner.FailureClass),
             UserId = tostring(principalObjectId),
             TenantId = tostring(principalTenantId),
             AgentId = tostring(meta.CdsBotId),
             ConversationId = tostring(meta.ConversationId),
             Week = ${BUCKET}
    | extend IsTool = eventName == 'AgenticLoopToolCallLatency',
             IsKnowledge = eventName == 'KnowledgeSourceLatency',
             IsODSPTool = eventName == 'AgenticLoopToolCallLatency' and Connector in (Connectors),
             IsODSPKnowledge = eventName == 'KnowledgeSourceLatency'
               and KnowledgeSource in ('SharePoint','SharePointList')
    | extend IsODSP = IsODSPTool or IsODSPKnowledge,
             IsEligibleODSPTool = IsODSPTool and ToolCategory != 'ConsentPending';
  union
    (Base
      | summarize hU=hll(UserId), hT=hll(TenantId), hA=hll(AgentId), hC=hll(ConversationId),
          Tools=countif(IsTool),
          Knowledge=countif(IsKnowledge and isnotempty(KnowledgeSource)),
          EligibleTools=long(0), ServiceFailures=long(0) by Week
      | extend Scope='Allup'),
    (Base
      | where IsODSP
      | summarize hU=hll(UserId), hT=hll(TenantId), hA=hll(AgentId), hC=hll(ConversationId),
          Tools=countif(IsODSPTool), Knowledge=countif(IsODSPKnowledge),
          EligibleTools=countif(IsEligibleODSPTool),
          ServiceFailures=countif(IsEligibleODSPTool and FailureClass == 'Service') by Week
      | extend Scope='ODSP')
};
union isfuzzy=true
  ${clusterCalls}
| summarize hU=hll_merge(hU), hT=hll_merge(hT), hA=hll_merge(hA), hC=hll_merge(hC),
            Tools=sum(Tools), Knowledge=sum(Knowledge),
            EligibleTools=sum(EligibleTools), ServiceFailures=sum(ServiceFailures)
  by Week, Scope
| project Week=format_datetime(Week,'yyyy-MM-dd'), Scope,
    Users=dcount_hll(hU), Tenants=dcount_hll(hT), Agents=dcount_hll(hA), Tasks=dcount_hll(hC),
    ToolCalls=Tools, KnowledgeSources=Knowledge,
    EligibleToolCalls=EligibleTools, ServiceFailures,
    PublishedServiceSuccess=iff(Scope == 'ODSP' and Tools > 0,
      round(100.0 * (1.0 - todouble(ServiceFailures) / Tools), 1), real(null)),
    ConsentExcludedServiceSuccess=iff(Scope == 'ODSP' and EligibleTools > 0,
      round(100.0 * (1.0 - todouble(ServiceFailures) / EligibleTools), 1), real(null))
| order by Week asc, Scope asc
`;

function regionKql(start, end) {
  return `
let Start = datetime(${start});
let End = datetime(${end});
let Apps = dynamic(['fabric:/CopilotStudio.AgenticRuntime','fabric:/CopilotStudio.AgenticLoopApp']);
let Connectors = dynamic(['shared_sharepointonline','shared_onedriveforbusiness']);
let Base =
  TraceEvents
  | where env_time >= Start and env_time < End
  | where applicationName in (Apps)
  | where eventName in ('AgenticLoopTurnLatency','AgenticLoopToolCallLatency',
                        'KnowledgeSourceLatency','AgenticLoopLlmCallLatency')
  | extend meta = parse_json(customDimensions)
  | extend inner = parse_json(tostring(meta.CustomDimensions))
  | extend Connector = tolower(tostring(inner.ConnectorId)),
           KnowledgeSource = tostring(inner.KnowledgeSource),
           ToolCategory = tostring(inner.ToolCategory),
           FailureClass = tostring(inner.FailureClass),
           UserId = tostring(principalObjectId),
           TenantId = tostring(principalTenantId),
           AgentId = tostring(meta.CdsBotId),
           ConversationId = tostring(meta.ConversationId),
           Week = ${BUCKET}
  | extend IsTool = eventName == 'AgenticLoopToolCallLatency',
           IsKnowledge = eventName == 'KnowledgeSourceLatency',
           IsODSPTool = eventName == 'AgenticLoopToolCallLatency' and Connector in (Connectors),
           IsODSPKnowledge = eventName == 'KnowledgeSourceLatency'
             and KnowledgeSource in ('SharePoint','SharePointList')
  | extend IsODSP = IsODSPTool or IsODSPKnowledge,
           IsEligibleODSPTool = IsODSPTool and ToolCategory != 'ConsentPending';
union
  (Base
    | summarize hU=hll(UserId), hT=hll(TenantId), hA=hll(AgentId), hC=hll(ConversationId),
        Tools=countif(IsTool), Knowledge=countif(IsKnowledge and isnotempty(KnowledgeSource)),
        EligibleTools=long(0), ServiceFailures=long(0) by Week
    | extend Scope='Allup'),
  (Base
    | where IsODSP
    | summarize hU=hll(UserId), hT=hll(TenantId), hA=hll(AgentId), hC=hll(ConversationId),
        Tools=countif(IsODSPTool), Knowledge=countif(IsODSPKnowledge),
        EligibleTools=countif(IsEligibleODSPTool),
        ServiceFailures=countif(IsEligibleODSPTool and FailureClass == 'Service') by Week
    | extend Scope='ODSP')
| project Week, Scope,
    hU=tostring(hU), hT=tostring(hT), hA=tostring(hA), hC=tostring(hC),
    Tools, Knowledge, EligibleTools, ServiceFailures
`;
}

function clientFor(cluster) {
  return new Client(KustoConnectionStringBuilder.withTokenCredential(
    `https://${cluster}.kusto.windows.net`,
    new AzureCliCredential(),
  ));
}

async function execute(client, query, timeoutMinutes = 5) {
  try {
    const properties = new ClientRequestProperties();
    properties.setTimeout(timeoutMinutes * 60 * 1000);
    properties.setOption('servertimeout', `00:${String(timeoutMinutes).padStart(2, '0')}:00`);
    const response = await client.executeQuery('CAPAnalytics', query, properties);
    return response.primaryResults[0].toJSON().data;
  } catch (error) {
    const details = error.response?.data;
    if (details) error.message += `: ${typeof details === 'string' ? details : JSON.stringify(details)}`;
    throw error;
  }
}

async function executeRetry(client, query, timeoutMinutes = 5, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await execute(client, query, timeoutMinutes);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise(resolve => setTimeout(resolve, attempt * 5000));
      }
    }
  }
  throw lastError;
}

async function pullAndMergeRegionalSketches() {
  const cacheDir = path.join(__dirname, `cs-canonical-sketches-${START}-${END}-${GRAIN}`);
  fs.mkdirSync(cacheDir, { recursive: true });
  let next = 0;
  const regionalRows = [];
  function weeklyChunks() {
    const chunks = [];
    let start = new Date(`${START}T00:00:00Z`);
    const finalEnd = new Date(`${END}T00:00:00Z`);
    while (start < finalEnd) {
      const end = new Date(Math.min(start.getTime() + 7 * 86400000, finalEnd.getTime()));
      chunks.push([
        start.toISOString().slice(0, 10),
        end.toISOString().slice(0, 10),
      ]);
      start = end;
    }
    return chunks;
  }
  async function worker() {
    while (next < CLUSTERS.length) {
      const cluster = CLUSTERS[next++];
      const cacheFile = path.join(cacheDir, `${cluster}.json`);
      if (fs.existsSync(cacheFile)) {
        const rows = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        regionalRows.push(...rows);
        console.log(`[${regionalRows.length / 2}/${CLUSTERS.length}] ${cluster} cached`);
        continue;
      }
      const client = clientFor(cluster);
      try {
        let rows;
        try {
          rows = await executeRetry(client, regionKql(START, END), 6);
        } catch (error) {
          console.warn(`${cluster} full-period query unavailable; retrying in weekly chunks.`);
          rows = [];
          for (const [start, end] of weeklyChunks()) {
            rows.push(...await executeRetry(client, regionKql(start, end), 6));
          }
        }
        if (rows.length < 2 || rows.length % 2 !== 0) {
          throw new Error(`${cluster} returned ${rows.length} scope rows`);
        }
        fs.writeFileSync(cacheFile, JSON.stringify(rows));
        regionalRows.push(...rows);
        console.log(`${cluster} (${rows.length / 2} period chunk${rows.length === 2 ? '' : 's'})`);
      } finally {
        await client.close?.();
      }
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  const cachedClusters = fs.readdirSync(cacheDir).filter(file => file.endsWith('.json')).length;
  if (cachedClusters !== CLUSTERS.length) {
    throw new Error(`Expected ${CLUSTERS.length} regional cache files; got ${cachedClusters}`);
  }
  const driver = clientFor('fdislandsus.centralus');
  async function mergeRows(rows, finalize) {
    const values = rows.map(row => [
      `datetime(${new Date(row.Week).toISOString()})`,
      JSON.stringify(row.Scope),
      `dynamic(${row.hU})`,
      `dynamic(${row.hT})`,
      `dynamic(${row.hA})`,
      `dynamic(${row.hC})`,
      Number(row.Tools || 0),
      Number(row.Knowledge || 0),
      Number(row.EligibleTools || 0),
      Number(row.ServiceFailures || 0),
    ].join(',')).join(',\n');
    const projection = finalize ? `
| project Week=format_datetime(Week,'yyyy-MM-dd'), Scope,
    Users=dcount_hll(hU), Tenants=dcount_hll(hT), Agents=dcount_hll(hA), Tasks=dcount_hll(hC),
    ToolCalls=Tools, KnowledgeSources=Knowledge,
    EligibleToolCalls=EligibleTools, ServiceFailures,
    PublishedServiceSuccess=iff(Scope == 'ODSP' and Tools > 0,
      round(100.0 * (1.0 - todouble(ServiceFailures) / Tools), 1), real(null)),
    ConsentExcludedServiceSuccess=iff(Scope == 'ODSP' and EligibleTools > 0,
      round(100.0 * (1.0 - todouble(ServiceFailures) / EligibleTools), 1), real(null))
| order by Week asc, Scope asc` : `
| project Week, Scope, hU=tostring(hU), hT=tostring(hT), hA=tostring(hA), hC=tostring(hC),
          Tools, Knowledge, EligibleTools, ServiceFailures`;
    const mergeKql = `
datatable(Week:datetime, Scope:string, hU:dynamic, hT:dynamic, hA:dynamic, hC:dynamic,
          Tools:long, Knowledge:long, EligibleTools:long, ServiceFailures:long)
[
${values}
]
| summarize hU=hll_merge(hU), hT=hll_merge(hT), hA=hll_merge(hA), hC=hll_merge(hC),
            Tools=sum(Tools), Knowledge=sum(Knowledge),
            EligibleTools=sum(EligibleTools), ServiceFailures=sum(ServiceFailures)
  by Week, Scope
${projection}
`;
    return executeRetry(driver, mergeKql, 5);
  }
  try {
    async function reduceScope(scope) {
      let current = regionalRows.filter(row => row.Scope === scope);
      while (current.length > 1) {
        const nextRows = [];
        for (let index = 0; index < current.length; index += 2) {
          const pair = current.slice(index, index + 2);
          if (pair.length === 1) nextRows.push(pair[0]);
          else nextRows.push(...await mergeRows(pair, false));
        }
        current = nextRows;
      }
      return current[0];
    }
    const merged = [
      await reduceScope('Allup'),
      await reduceScope('ODSP'),
    ];
    return await mergeRows(merged, true);
  } finally {
    await driver.close?.();
  }
}

async function main() {
  const client = new Client(KustoConnectionStringBuilder.withTokenCredential(
    DRIVER,
    new AzureCliCredential(),
  ));
  let rows;
  try {
    try {
      if (process.env.CS_FORCE_FANOUT === '1') throw new Error('fan-out requested');
      rows = await execute(client, KQL, 9);
    } catch (error) {
      console.warn(`Federated query unavailable (${error.message}); using regional HLL fan-out.`);
      rows = await pullAndMergeRegionalSketches();
    }
    const byWeek = {};
    for (const row of rows) {
      const week = byWeek[row.Week] ||= {};
      week[row.Scope] = row;
    }
    for (const [week, scopes] of Object.entries(byWeek)) {
      if (!scopes.ODSP || !scopes.Allup) throw new Error(`Incomplete canonical scopes for ${week}`);
      scopes.Combined = {
        ODSPToolCallsAndKnowledge: scopes.ODSP.ToolCalls + scopes.ODSP.KnowledgeSources,
        AllupToolCallsAndKnowledge: scopes.Allup.ToolCalls + scopes.Allup.KnowledgeSources,
      };
      scopes.Combined.WeightedComposition = +(
        100 * scopes.Combined.ODSPToolCallsAndKnowledge /
        scopes.Combined.AllupToolCallsAndKnowledge
      ).toFixed(1);
    }
    const overrides = fs.existsSync(OVERRIDES_FILE)
      ? JSON.parse(fs.readFileSync(OVERRIDES_FILE, 'utf8'))
      : {};
    for (const [week, scopes] of Object.entries(byWeek)) {
      const override = overrides[week];
      scopes.Computed = JSON.parse(JSON.stringify(scopes));
      if (!override) {
        scopes.PublicationStatus = 'PROVISIONAL: no platform-team/Omega calibration supplied';
        continue;
      }
      for (const scope of ['ODSP', 'Allup', 'Combined']) {
        if (override[scope]) Object.assign(scopes[scope], override[scope]);
      }
      scopes.PublicationStatus = `CANONICAL OVERRIDE: ${override.source}`;
    }
    fs.writeFileSync(OUT, JSON.stringify({
      methodology: {
        regions: CLUSTERS,
        start: START,
        endExclusive: END,
        grain: GRAIN,
        distinctMethod: 'regional HLL sketches merged across the fixed 17-region population',
        odspKnowledge: "KnowledgeSource in ('SharePoint','SharePointList')",
      },
      weeks: byWeek,
    }, null, 2));
    console.log(JSON.stringify(byWeek, null, 2));
    console.log(`Wrote ${OUT}`);
  } finally {
    await client.close?.();
  }
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});

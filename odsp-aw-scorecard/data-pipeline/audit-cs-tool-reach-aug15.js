const { Client, KustoConnectionStringBuilder, ClientRequestProperties } = require('azure-kusto-data');
const { AzureCliCredential } = require('@azure/identity');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'cs-audit-tool-reach-aug15');
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

const QUERY = `
TraceEvents
| where env_time >= datetime(2026-08-02) and env_time < datetime(2026-08-16)
| where applicationName in ("fabric:/CopilotStudio.AgenticRuntime","fabric:/CopilotStudio.AgenticLoopApp")
| where eventName == 'AgenticLoopToolCallLatency'
| where customDimensions has 'shared_sharepointonline' or customDimensions has 'shared_onedriveforbusiness'
| extend meta = parse_json(customDimensions)
| extend inner = parse_json(tostring(meta.CustomDimensions))
| extend Connector = tolower(tostring(inner.ConnectorId))
| where Connector in ('shared_sharepointonline','shared_onedriveforbusiness')
| extend Week = format_datetime(startofweek(env_time), 'yyyy-MM-dd')
| summarize
    Users=make_set(tostring(principalObjectId), 1048576),
    Tenants=make_set(tostring(principalTenantId), 1048576),
    Agents=make_set(tostring(meta.CdsBotId), 1048576)
  by Week
`;

function clientFor(cluster) {
  return new Client(KustoConnectionStringBuilder.withTokenCredential(
    `https://${cluster}.kusto.windows.net`,
    new AzureCliCredential(),
  ));
}

async function execute(client) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const properties = new ClientRequestProperties();
      properties.setTimeout(6 * 60 * 1000);
      properties.setOption('servertimeout', '00:05:00');
      const result = await client.executeQuery('CAPAnalytics', QUERY, properties);
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
    const result = { cluster, rows: await execute(client) };
    fs.writeFileSync(file, JSON.stringify(result));
    return result;
  } finally {
    await client.close?.();
  }
}

async function main() {
  let next = 0;
  const results = [];
  async function worker() {
    while (next < CLUSTERS.length) {
      const cluster = CLUSTERS[next++];
      results.push(await pull(cluster));
      console.log(`[${results.length}/${CLUSTERS.length}] ${cluster}`);
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));

  const weeks = {};
  for (const result of results) {
    for (const row of result.rows) {
      const week = weeks[row.Week] ||= {
        Users: new Set(), Tenants: new Set(), Agents: new Set(),
      };
      for (const metric of ['Users', 'Tenants', 'Agents']) {
        for (const value of row[metric] || []) {
          if (value) week[metric].add(value);
        }
      }
    }
  }

  const output = {};
  for (const [week, metrics] of Object.entries(weeks).sort()) {
    output[week] = Object.fromEntries(
      Object.entries(metrics).map(([metric, values]) => [metric, values.size]),
    );
  }
  fs.writeFileSync(
    path.join(__dirname, 'cs-audit-tool-reach-aug15.json'),
    JSON.stringify(output, null, 2),
  );
  console.log(JSON.stringify(output, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});

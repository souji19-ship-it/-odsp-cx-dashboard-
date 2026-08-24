// One-shot MTD merge from cached regional sketches (Aug 1-23 period).
// Reads cs-canonical-sketches-2026-08-01-2026-08-23-period/*.json, builds a single
// datatable of all region rows, merges HLL by Scope on the driver in ONE query per scope.
const { Client, KustoConnectionStringBuilder, ClientRequestProperties } = require('azure-kusto-data');
const { AzureCliCredential } = require('@azure/identity');
const fs = require('fs');
const path = require('path');

const CACHE = path.join(__dirname, 'cs-canonical-sketches-2026-08-01-2026-08-23-period');
const DRIVER = 'https://fdislandsus.centralus.kusto.windows.net';

function rowsForScope(scope) {
  const out = [];
  for (const f of fs.readdirSync(CACHE)) {
    if (!f.endsWith('.json')) continue;
    const rows = JSON.parse(fs.readFileSync(path.join(CACHE, f), 'utf8'));
    for (const r of rows) if (r.Scope === scope) out.push(r);
  }
  return out;
}

function mergeKql(rows) {
  const values = rows.map(r => [
    JSON.stringify(r.Scope),
    `dynamic(${r.hU})`, `dynamic(${r.hT})`, `dynamic(${r.hA})`, `dynamic(${r.hC})`,
    Number(r.Tools || 0), Number(r.Knowledge || 0),
    Number(r.EligibleTools || 0), Number(r.ServiceFailures || 0),
  ].join(',')).join(',\n');
  return `
datatable(Scope:string, hU:dynamic, hT:dynamic, hA:dynamic, hC:dynamic,
          Tools:long, Knowledge:long, EligibleTools:long, ServiceFailures:long)
[
${values}
]
| summarize hU=hll_merge(hU), hT=hll_merge(hT), hA=hll_merge(hA), hC=hll_merge(hC),
            Tools=sum(Tools), Knowledge=sum(Knowledge),
            EligibleTools=sum(EligibleTools), ServiceFailures=sum(ServiceFailures) by Scope
| project Scope,
    Users=dcount_hll(hU), Tenants=dcount_hll(hT), Agents=dcount_hll(hA), Tasks=dcount_hll(hC),
    ToolCalls=Tools, KnowledgeSources=Knowledge,
    EligibleToolCalls=EligibleTools, ServiceFailures,
    PublishedServiceSuccess=iff(Tools>0, round(100.0*(1.0-todouble(ServiceFailures)/Tools),1), real(null)),
    ConsentExcludedServiceSuccess=iff(EligibleTools>0, round(100.0*(1.0-todouble(ServiceFailures)/EligibleTools),1), real(null))`;
}

(async () => {
  const client = new Client(KustoConnectionStringBuilder.withTokenCredential(DRIVER, new AzureCliCredential()));
  const props = new ClientRequestProperties();
  props.setTimeout(5 * 60 * 1000);
  props.setOption('servertimeout', '00:05:00');
  const result = {};
  for (const scope of ['Allup', 'ODSP']) {
    const rows = rowsForScope(scope);
    const r = await client.executeQuery('CAPAnalytics', mergeKql(rows), props);
    result[scope] = r.primaryResults[0].toJSON().data[0];
    console.error(`${scope}: ${rows.length} region-rows merged`);
  }
  const odsp = result.ODSP, allup = result.Allup;
  const share = (a, b) => b ? +(100 * a / b).toFixed(1) : null;
  result.Combined = {
    ODSPToolCallsAndKnowledge: odsp.ToolCalls + odsp.KnowledgeSources,
    AllupToolCallsAndKnowledge: allup.ToolCalls + allup.KnowledgeSources,
  };
  result.Combined.WeightedComposition = share(result.Combined.ODSPToolCallsAndKnowledge, result.Combined.AllupToolCallsAndKnowledge);
  result.Shares = {
    Users: share(odsp.Users, allup.Users), Tenants: share(odsp.Tenants, allup.Tenants),
    Agents: share(odsp.Agents, allup.Agents), Tasks: share(odsp.Tasks, allup.Tasks),
    ToolCalls: share(odsp.ToolCalls, allup.ToolCalls), Knowledge: share(odsp.KnowledgeSources, allup.KnowledgeSources),
  };
  fs.writeFileSync(path.join(__dirname, 'cs-canonical-aug-mtd.json'), JSON.stringify({ '2026-08-01': result }, null, 2));
  console.log(JSON.stringify({ '2026-08-01': result }, null, 2));
  await client.close?.();
})().catch(e => { console.error(e.message); process.exit(1); });

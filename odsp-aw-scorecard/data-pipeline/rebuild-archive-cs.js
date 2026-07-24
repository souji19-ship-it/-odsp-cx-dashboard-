// rebuild-archive-cs.js
// Rebuild the CS 301/401 of the 2026-07-11 weekly snapshot to Sandeep's corrected
// methodology (service-success headline, nested fields, KnowledgeCategory rule,
// P50/P95 latency, per-op split) using the real re-pulled numbers
// (This = Jul 5-11, Last = Jun 28-Jul 4). Older snapshots (Jun 14-20, Jun 21-27,
// Jun 28-Jul 4) predate the modern CS methodology and are left as-is, flagged
// "pre-correction methodology" in the archive table.
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'dashboard', 'ODSP-in-Agentic-Work-Scorecard.html');
const raw = fs.readFileSync(FILE, 'utf8');
const EOL = raw.includes('\r\n') ? '\r\n' : '\n';
const lines = raw.split(/\r?\n/);
const idx = lines.findIndex(l => l.startsWith('window.SNAP='));
if (idx < 0) throw new Error('SNAP line not found');
const SNAP = JSON.parse(lines[idx].replace(/^window\.SNAP=/, '').replace(/;\s*$/, ''));

let snap = SNAP['2026-07-11'];
if (!snap) throw new Error('2026-07-11 snapshot missing');

function replaceOnce(hay, re, rep, label) {
  const before = hay;
  const out = hay.replace(re, rep);
  if (out === before) throw new Error('replacement did not match: ' + label);
  return out;
}

// ---- 301: corrected footprint msrc (methodology text; numbers untouched) ----
const foot301 = `<div class="msrc"><b>ODSP-in-CS = two surfaces</b> (per taxonomy): <b>Tool</b> = <code>AgenticLoopToolCallLatency</code> with <code>ConnectorId</code> in <code>shared_sharepointonline</code> / <code>shared_onedriveforbusiness</code>; <b>Knowledge</b> = <code>KnowledgeSourceLatency</code> with <code>KnowledgeCategory == "SharePoint"</code> &mdash; that single field bundles SharePoint, SharePointList <b>and OneDriveBusiness</b>, so OneDrive knowledge is no longer dropped. Users / Tenants / Tasks are the de-duplicated union of both surfaces. <b>C1 / C2 = channel tier</b> (<code>ChannelId</code>). Distinct counts globally de-duplicated via HLL. <b>Fields read from nested <code>CustomDimensions</code></b> (ConnectorId / KnowledgeCategory / Success live inside <code>customDimensions.CustomDimensions</code>, not the top level &mdash; the top-level <code>Success</code> is blank in older weeks). <b>This-wk pulled &ge;3 days after week close</b> so the still-arriving tool / knowledge / task counts settle. WoW in the chart to the right.</div>`;
snap = replaceOnce(snap,
  /<div class="msrc"><b>ODSP-in-CS = two surfaces<\/b> \(per taxonomy\):[\s\S]*?WoW in the chart to the right\.<\/div>/,
  foot301, '301 footprint msrc');

// ---- 301: corrected methodology "Knowledge searches" row ----
const knowRow = `<tr><td class="mm">Knowledge searches</td><td class="md">ODSP <b>knowledge</b> &mdash; <code>KnowledgeSourceLatency</code> with <code>KnowledgeCategory == "SharePoint"</code>, which bundles <code>SharePoint</code>, <code>SharePointList</code> <b>and OneDriveBusiness</b> (OneDrive is its own knowledge source, not federated &mdash; the old <code>SharePoint</code>/<code>SharePointList</code> rule silently dropped OneDrive hits).</td></tr>`;
snap = replaceOnce(snap,
  /<tr><td class="mm">Knowledge searches<\/td><td class="md">[\s\S]*?<\/td><\/tr>/,
  knowRow, '301 methodology knowledge row');

// ---- 301: corrected methodology card msrc ----
const method301msrc = `<div class="msrc">Source: Dracarys Kusto (CAP Analytics). <b>ODSP-in-CS = two surfaces</b> (per reporting taxonomy): tool = <code>ConnectorId</code> <code>shared_sharepointonline</code> / <code>shared_onedriveforbusiness</code>; knowledge = <code>KnowledgeCategory == "SharePoint"</code> (bundles SharePoint + SharePointList + OneDriveBusiness). <b>All fields read from the nested <code>customDimensions.CustomDimensions</code></b> object (ConnectorId / KnowledgeCategory / Success), not the top level (top-level <code>Success</code> is unreliable / blank in older weeks). WorkIQ MCP connectors are a <i>separate</i> surface and excluded here. <b>This-wk counts pulled &ge;3 days after week close</b> to let still-arriving tool / knowledge / task events settle. Distinct users / tenants globally de-duplicated via HLL push-down (not per-region summed).</div>`;
snap = replaceOnce(snap,
  /<div class="msrc">Source: Dracarys Kusto \(CAP Analytics\)[\s\S]*?<\/div>/,
  method301msrc, '301 methodology msrc');

// ---- 401: full corrected section (This = Jul 5-11, Last = Jun 28-Jul 4) ----
const new401 = `<div class="lvlhead cs"><span class="badge">401</span><h2>ODSP in Copilot Studio – Performance</h2><span class="desc">scenario &amp; tool health &middot; corrected methodology (2026-07-24)</span></div>
    <div class="pair tri">
      <div class="tcard cs">
        <div class="th">ODSP in Copilot Studio Performance <span class="tag">LIVE</span></div>
        <table>
          <tr><th class="metric">Metric</th><th>Last wk <span class="wk">(Jun 28&ndash;Jul 4)</span></th><th>This wk <span class="wk">(Jul 5&ndash;11)</span></th><th>WoW</th></tr>
            <tr><td class="metric">ODSP service success <span class="wk">(headline)</span></td><td><span class="n">86.0%</span></td><td><span class="n">83.9%</span></td><td class="wow down">&#9660; 2.1pp</td></tr>
            <tr><td class="metric">End-to-end success <span class="wk">(incl. agent faults)</span></td><td><span class="n">86.0%</span></td><td><span class="n">65.4%</span></td><td class="wow down">&#9660; 20.6pp</td></tr>
            <tr><td class="metric">Turn success rate <span class="wk">(platform)</span></td><td><span class="n">97.6%</span></td><td><span class="n">98.3%</span></td><td class="wow up">&#9650; 0.7pp</td></tr>
            <tr><td class="metric">Latency P50 <span class="wk">(end-to-end)</span></td><td><span class="n">830 ms</span></td><td><span class="n">484 ms</span></td><td class="wow up">&#9650; faster 41.7%</td></tr>
            <tr><td class="metric">Latency P95 <span class="wk">(end-to-end)</span></td><td><span class="n">2,693 ms</span></td><td><span class="n">1,375 ms</span></td><td class="wow up">&#9650; faster 48.9%</td></tr>
        </table>
        <div class="msrc"><b>ODSP service success is the headline</b> = 1 &minus; (Service-class failures &divide; calls). This week the end-to-end rate diverges sharply from service because <b>Author-class 404s appear</b> (agents calling <code>PatchItem</code> on non-existent items) &mdash; a pattern that was essentially absent the prior week (Jun 28&ndash;Jul 4 had no Author faults, so service &equiv; e2e &asymp; 86%). This wk: Service failures <b>25,965</b> vs Author <b>29,719</b> (53% of all failures) &middot; User 69.</div>
      </div>
      <div class="vchart cs">
          <div class="ch">ODSP in Copilot Studio Performance – WoW <span class="tag">LIVE</span></div>
          <div class="vcb">
            <div class="vgrp"><div class="vplot"><div class="vbar last" style="height:100.0%"><span class="vv">86.0%</span></div><div class="vbar this" style="height:97.6%"><span class="vv">83.9%</span></div></div><div class="vmeta"><span class="vm-lbl">Service succ</span><span class="vm-wow down">&#9660; 2.1pp</span></div></div>
            <div class="vgrp"><div class="vplot"><div class="vbar last" style="height:100.0%"><span class="vv">86.0%</span></div><div class="vbar this" style="height:76.0%"><span class="vv">65.4%</span></div></div><div class="vmeta"><span class="vm-lbl">E2E succ</span><span class="vm-wow down">&#9660; 20.6pp</span></div></div>
            <div class="vgrp"><div class="vplot"><div class="vbar last" style="height:100.0%"><span class="vv">830 ms</span></div><div class="vbar this" style="height:58.3%"><span class="vv">484 ms</span></div></div><div class="vmeta"><span class="vm-lbl">P50</span><span class="vm-wow up">&#9650; faster 41.7%</span></div></div>
            <div class="vgrp"><div class="vplot"><div class="vbar last" style="height:100.0%"><span class="vv">2,693</span></div><div class="vbar this" style="height:51.1%"><span class="vv">1,375</span></div></div><div class="vmeta"><span class="vm-lbl">P95 ms</span><span class="vm-wow up">&#9650; faster 48.9%</span></div></div>
          </div>
          <div class="vlegend"><span><i class="vswatch" style="background:#c3ccd8"></i>Last wk</span><span><i class="vswatch" style="background:var(--cs)"></i>This wk</span></div>
        </div>
        <div class="tcard cs method">
          <div class="th">Performance – Definitions <span class="tag">DEFINITIONS</span></div>
          <table>
            <tr><th class="metric">Metric</th><th class="metric">How it is calculated</th></tr>
            <tr><td class="mm">ODSP service success</td><td class="md"><b>Headline.</b> 1 &minus; (<code>FailureClass == "Service"</code> &divide; total ODSP tool calls) — isolates real ODSP-backend health, excluding agent-side (Author) and user-side faults. <code>ConsentPending</code> calls dropped from the denominator (consent prompts, not executions).</td></tr>
            <tr><td class="mm">End-to-end success</td><td class="md">Successful calls &divide; all ODSP tool calls (<b>includes Author &amp; User faults</b>) — the old single "tool success". Low mostly because agents call <code>PatchItem</code> on non-existent items (Author 404s).</td></tr>
            <tr><td class="mm">Turn success rate</td><td class="md"><b>Copilot-Studio-wide</b> turn success (not ODSP-specific) &middot; platform context.</td></tr>
            <tr><td class="mm">Latency P50 / P95</td><td class="md"><b>True end-to-end tool-call time</b> from the nested <code>Value</code> field (not top-level <code>TotalMilliseconds</code>, which is only the HTTP leg — ~2.4&times; too small &amp; often blank). Percentiles, not the mean, so the long tail is visible.</td></tr>
            <tr><td class="mm">WoW</td><td class="md">Rates: percentage-point delta (pp). Latency: % change. &#9650; up / &#9660; down.</td></tr>
          </table>
          <div class="msrc">Source: Dracarys Kusto (live) &middot; <code>AgenticLoopToolCallLatency</code>, fields read from nested <code>customDimensions.CustomDimensions</code> (<code>FailureClass</code> / <code>StatusClass</code> / <code>Value</code>). Service/Author/User = <code>FailureClass</code>. <code>ConsentPending</code> excluded. Turn-success is Copilot-Studio-wide.</div>
        </div>
    </div>

    <div class="pair tri">
          <div class="tcard cs">
            <div class="th">ODSP Tools by Connector <span class="tag">LIVE</span></div>
            <table>
            <tr><th class="metric">ODSP connector</th><th>Share <span class="wk">(this)</span></th><th>Svc succ <span class="wk">last</span></th><th>Svc succ <span class="wk">this</span></th><th>WoW</th></tr>
            <tr><td class="metric">SharePoint Online</td><td><span class="n">93.1%</span></td><td><span class="n">85.7%</span></td><td><span class="n">83.2%</span></td><td class="wow down">&#9660; 2.5pp</td></tr>
            <tr><td class="metric" style="padding-left:22px;font-weight:500">&#8627; C1 (maker)</td><td><span class="n">&mdash;</span></td><td><span class="n">79.1%</span></td><td><span class="n">82.3%</span></td><td class="wow up">&#9650; 3.2pp</td></tr>
            <tr><td class="metric" style="padding-left:22px;font-weight:500">&#8627; C2 (runtime)</td><td><span class="n">&mdash;</span></td><td><span class="n">92.7%</span></td><td><span class="n">83.5%</span></td><td class="wow down">&#9660; 9.2pp</td></tr>
            <tr><td class="metric">OneDrive for Business</td><td><span class="n">6.9%</span></td><td><span class="n">90.2%</span></td><td><span class="n">92.9%</span></td><td class="wow up">&#9650; 2.7pp</td></tr>
            </table>
            <div class="msrc">The two authoritative ODSP tool connectors (<code>shared_sharepointonline</code>, <code>shared_onedriveforbusiness</code>). Share = % of ODSP tool calls this wk. <b>Success shown is ODSP service success</b> (<code>FailureClass == "Service"</code> excluded), call-weighted; WoW = pp delta. The service-success dip is concentrated in <b>C2 (end-user runtime) SharePoint</b> (92.7% &rarr; 83.5%); C1 maker SharePoint improved and OneDrive stayed healthy. This wk = Jul 5&ndash;11 vs Jun 28&ndash;Jul 4.</div>
          </div>
          <div class="panel cs">
            <div class="ph">ODSP Failure &amp; Latency Breakdown <span class="tag">LIVE &middot; Jul 5–11</span></div>
            <div class="pb">
            <div class="sig bad"><span class="sk">Failure mix (by class)</span><span class="sv"><span>Author 53% &middot; Service 47%</span><small>Author 29,719 (agent faults) &middot; Service 25,965 &middot; User 69</small></span></div>
            <div class="sig"><span class="sk">Status class</span><span class="sv"><span>4xx dominates</span><small>4xx 55,043 &middot; 5xx 431 &middot; throttle 0 &middot; timeout 35</small></span></div>
            <div class="sig bad"><span class="sk">Biggest end-to-end drag</span><span class="sv"><span>PatchItem</span><small>29,629 Author 404s — calls on non-existent items; service 84.8% but e2e 39.2%</small></span></div>
            <div class="sig"><span class="sk">Weakest service op</span><span class="sv"><span>GetTables</span><small>55.9% service (7,730 service failures) &middot; PostItem 64.3%</small></span></div>
            <div class="sig good"><span class="sk">Healthiest high-volume</span><span class="sv"><span>GetDataSets / GetTable</span><small>99.8% / 97.7% service &middot; OneDrive 92.9%</small></span></div>
            <div class="sig"><span class="sk">Latency (end-to-end)</span><span class="sv"><span>P50 484 ms &middot; P95 1,375 ms</span><small>from nested <code>Value</code> — mean hides the long tail</small></span></div>
            <div class="sig" style="display:block;border-top:1px solid var(--line);padding-top:8px"><span class="sk" style="font-size:10px;line-height:1.45;color:var(--faint)"><b>Failure class</b> from <code>FailureClass</code> (Service = ODSP backend, Author = agent misuse, User = end-user). <b>Status class</b> from <code>StatusClass</code>. <code>ConsentPending</code> excluded. Fields read from nested <code>customDimensions.CustomDimensions</code>; call-weighted across 19 regional Dracarys clusters. This wk = Jul 5&ndash;11 &middot; Dracarys Kusto.</span></div>
            </div>
          </div>
          <div class="tcard cs">
            <div class="th">ODSP Tools by Operation <span class="tag">LIVE &middot; Jul 5–11</span></div>
            <table>
            <tr><th class="metric">Operation</th><th>Calls</th><th>Service</th><th>End-to-end</th><th>Note</th></tr>
            <tr><td class="metric">PatchItem</td><td><span class="n">64,907</span></td><td><span class="n">84.8%</span></td><td><span class="n">39.2%</span></td><td class="wk">29.6K Author 404s</td></tr>
            <tr><td class="metric">GetTables</td><td><span class="n">17,528</span></td><td><span class="n">55.9%</span></td><td><span class="n">55.9%</span></td><td class="wk">service-side soft</td></tr>
            <tr><td class="metric">GetTable</td><td><span class="n">9,860</span></td><td><span class="n">97.7%</span></td><td><span class="n">97.7%</span></td><td class="wk">healthy</td></tr>
            <tr><td class="metric">GetItems</td><td><span class="n">9,200</span></td><td><span class="n">82.0%</span></td><td><span class="n">81.9%</span></td><td class="wk">&mdash;</td></tr>
            <tr><td class="metric">ListFolder</td><td><span class="n">8,617</span></td><td><span class="n">93.4%</span></td><td><span class="n">93.3%</span></td><td class="wk">&mdash;</td></tr>
            <tr><td class="metric">GetDataSets</td><td><span class="n">7,795</span></td><td><span class="n">99.8%</span></td><td><span class="n">99.6%</span></td><td class="wk">healthy</td></tr>
            <tr><td class="metric">PostItem</td><td><span class="n">5,479</span></td><td><span class="n">64.3%</span></td><td><span class="n">64.2%</span></td><td class="wk">service-side soft</td></tr>
            <tr><td class="metric">CreateFile</td><td><span class="n">4,816</span></td><td><span class="n">92.1%</span></td><td><span class="n">91.7%</span></td><td class="wk">file op</td></tr>
            <tr><td class="metric">GetTableViews</td><td><span class="n">4,771</span></td><td><span class="n">99.8%</span></td><td><span class="n">99.8%</span></td><td class="wk">healthy</td></tr>
            </table>
            <div class="msrc">Per-<code>OperationId</code> breakdown (top by volume). <b>Service</b> = ODSP-backend success (<code>FailureClass == "Service"</code> excluded); <b>End-to-end</b> includes Author / User faults. The gap between the two is agent misuse — clearest on <code>PatchItem</code> (84.8% service vs 39.2% e2e, from 29.6K Author 404s on non-existent items). <b>File operations</b> (Get / Create / Content) sit at 92&ndash;99% service; the list / table operations (GetTables, PostItem) carry the service-side softness. <code>ConsentPending</code> excluded.</div>
          </div>
    </div>

`;
snap = replaceOnce(snap,
  /<div class="lvlhead cs"><span class="badge">401<\/span>[\s\S]*?(?=<p class="note fullnote">)/,
  new401, '401 section');

// ---- CS fullnote (corrected, Jul 5-11 story) ----
const fullnote = `<p class="note fullnote">Copilot Studio (Dracarys) = Builder platform, excluded from agent counts per the reporting taxonomy. 201/301/401 pulled live via az-cli Kusto from the Dracarys clusters (<code>fdislandsus.centralus</code> + 18 regional peers &middot; DB <code>CAPAnalytics</code> &middot; table <code>TraceEvents</code>), Sun&ndash;Sat calendar weeks (CST). <b>ODSP-in-CS = two surfaces</b>: tool calls with <code>ConnectorId</code> <code>shared_sharepointonline</code>/<code>shared_onedriveforbusiness</code>, and knowledge searches (<code>KnowledgeSourceLatency</code>, <code>KnowledgeCategory == "SharePoint"</code> — bundles SharePoint + SharePointList + OneDriveBusiness); WorkIQ MCP is a separate surface. <b>All fields read from the nested <code>customDimensions.CustomDimensions</code></b> (top-level <code>Success</code> is unreliable for older weeks). <b>ODSP service success</b> = 1 &minus; Service-class failures &divide; calls (<code>ConsentPending</code> excluded); latency P50/P95 from the nested <code>Value</code> field. <b>Jul 5&ndash;11 ODSP service success 83.9% (&#9660; 2.1pp WoW vs Jun 28&ndash;Jul 4 86.0%)</b>; end-to-end fell to 65.4% because <b>Author-class 404s emerged this week (53% of failures), mostly <code>PatchItem</code> on non-existent items</b> — the ODSP backend itself stayed ~84% (the prior week had no Author faults, so service &equiv; e2e &asymp; 86%). Latency actually improved: P50 484 ms / P95 1,375 ms vs 830 / 2,693 ms. Platform turn-success 98.3%. Volumes (tool calls &middot; knowledge &middot; tasks) are additive; distinct users/tenants globally de-duplicated via HLL. <b>Corrected to the reporting methodology on 2026-07-24</b> (Sandeep's 301/401 notes): service-vs-end-to-end split, nested-field reads, <code>KnowledgeCategory</code> rule, P50/P95 latency, per-operation breakdown.</p>`;
snap = replaceOnce(snap,
  /<p class="note fullnote">Copilot Studio \(Dracarys\)[\s\S]*?<\/p>/,
  fullnote, 'CS fullnote');

SNAP['2026-07-11'] = snap;

// ---- write SNAP back ----
lines[idx] = 'window.SNAP=' + JSON.stringify(SNAP) + ';';
fs.writeFileSync(FILE, lines.join(EOL), 'utf8');
console.log('OK: rebuilt 2026-07-11 CS 301/401; SNAP re-embedded.');

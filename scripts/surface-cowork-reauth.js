'use strict';
// Auto-surface a CoWork hard re-auth: if scrape-cowork could not self-heal (needsInteractiveAuth in
// _scrape-meta.json), add a "What Needs You" item to the Command Center; resolve it once it self-heals.
const fs = require('fs');
const CC = 'C:/Repo/OneDrive-SharePoint-in-Agentic-Work/Data-Private/Data-Created/ODSP-AW-CC.html';
const META = 'C:/Repo/OneDrive-SharePoint-in-Agentic-Work/Data-Public/cowork/_scrape-meta.json';
const ID = 'nfy-cowork-reauth';
const NL = '\r\n';

let needs = false, since = '';
try {
  const m = JSON.parse(fs.readFileSync(META, 'utf8'));
  needs = !!m.needsInteractiveAuth;
  since = (m.scrapedAt || '').slice(0, 10);
} catch (e) { console.log('no _scrape-meta.json - skip'); process.exit(0); }

let c = fs.readFileSync(CC, 'utf8');
const start = c.indexOf('{id:"' + ID + '"');
const exists = start >= 0;

if (needs && !exists) {
  const item = '{id:"' + ID + '",pri:"P1",status:"open",since:"' + since + '",need:"CoWork needs a one-time manual re-auth - the scraper hit a hard corp re-auth it could not self-heal",detail:"Open the debug Edge (MSFTReportingEdge, CDP 9222) signed in to the CoWork dashboard once; the 7am refresh then self-heals again. Until then CoWork data is stale.",unblocks:"CoWork data refresh"}';
  const i = c.indexOf('const needFromYou=[');
  if (i < 0) { console.log('needFromYou not found - skip'); process.exit(0); }
  const at = c.indexOf('[', i) + 1;
  c = c.slice(0, at) + NL + '      ' + item + ',' + c.slice(at);
  fs.writeFileSync(CC, c, 'utf8');
  console.log('ADDED ' + ID + ' (CoWork re-auth needed)');
} else if (!needs && exists) {
  const end = c.indexOf('}', start);
  const obj = c.slice(start, end).replace('status:"open"', 'status:"resolved"');
  c = c.slice(0, start) + obj + c.slice(end);
  fs.writeFileSync(CC, c, 'utf8');
  console.log('RESOLVED ' + ID + ' (CoWork self-healed)');
} else {
  console.log('no change (needs=' + needs + ', exists=' + exists + ')');
}

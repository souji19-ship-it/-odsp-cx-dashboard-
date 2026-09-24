'use strict';
// Surface/resolve the run-watchdog "What Needs You" item based on the miss summary from run-watchdog.ps1.
const fs = require('fs');
const CC = 'C:/Repo/OneDrive-SharePoint-in-Agentic-Work/Data-Private/Data-Created/ODSP-AW-CC.html';
const ID = 'nfy-watchdog';
const NL = '\r\n';
const summary = (process.argv[2] || '').trim();
let c = fs.readFileSync(CC, 'utf8');
const start = c.indexOf('{id:"' + ID + '"');
const exists = start >= 0;

if (summary && !exists) {
  const since = new Date().toISOString().slice(0, 10);
  const detail = ('A scheduled cadence has not run in over a day or failed: ' + summary + '. Verify the machine was on + the task is enabled (scripts/register-agent-tasks.ps1 restores them).').replace(/[{}"]/g, '');
  const item = '{id:"' + ID + '",pri:"P1",status:"open",since:"' + since + '",need:"A daily agent cadence may have been missed - verify the morning memo / EOD / 7am refresh ran",detail:"' + detail + '",unblocks:"Reliable daily cadences"}';
  const i = c.indexOf('const needFromYou=[');
  if (i < 0) { console.log('needFromYou not found - skip'); process.exit(0); }
  const at = c.indexOf('[', i) + 1;
  c = c.slice(0, at) + NL + '      ' + item + ',' + c.slice(at);
  fs.writeFileSync(CC, c, 'utf8');
  console.log('watchdog: SURFACED miss (' + summary + ')');
} else if (!summary && exists) {
  const end = c.indexOf('}', start);
  const obj = c.slice(start, end).replace('status:"open"', 'status:"resolved"');
  c = c.slice(0, start) + obj + c.slice(end);
  fs.writeFileSync(CC, c, 'utf8');
  console.log('watchdog: RESOLVED (all cadences ran)');
} else {
  console.log('watchdog: no change (miss=' + (summary ? 'yes' : 'none') + ', exists=' + exists + ')');
}

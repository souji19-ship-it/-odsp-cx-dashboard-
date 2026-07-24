// merge-cs-weeks.js — like merge-cs-live but for ALL retained weeks, written to
// cs-weeks-merged.json. Used to rebuild the archive CS 301/401 snapshots.
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, 'cs-pull');

const WEEKS = { 'Jun 21-27': 'Jun_21_27', 'Jun 28-Jul 4': 'Jun_28_Jul_4', 'Jul 5-11': 'Jul_5_11', 'Jul 12-18': 'Jul_12_18' };

function loadWeek(tag) {
  const files = fs.readdirSync(OUT).filter(f => f.endsWith(`__${tag}.json`) && !f.includes('ERROR'));
  return files.map(f => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8')));
}

function agg401(cells) {
  const tot = { Calls: 0, Ok: 0, SvcF: 0, AuthF: 0, UsrF: 0, c4xx: 0, c5xx: 0, throttle: 0, timeout: 0 };
  const byOp = {};
  const byTier = { C1: { Calls: 0, SvcF: 0, Ok: 0 }, C2: { Calls: 0, SvcF: 0, Ok: 0 } };
  const byConn = {};
  let p50wSum = 0, p95wSum = 0, pW = 0;
  for (const c of cells) for (const r of (c.r401 || [])) {
    const calls = Number(r.Calls) || 0;
    tot.Calls += calls; tot.Ok += Number(r.Ok) || 0;
    tot.SvcF += Number(r.SvcF) || 0; tot.AuthF += Number(r.AuthF) || 0; tot.UsrF += Number(r.UsrF) || 0;
    tot.c4xx += Number(r.c4xx) || 0; tot.c5xx += Number(r.c5xx) || 0;
    tot.throttle += Number(r.throttle) || 0; tot.timeout += Number(r.timeout) || 0;
    const op = r.Op || '(none)';
    byOp[op] = byOp[op] || { Calls: 0, Ok: 0, SvcF: 0, AuthF: 0, UsrF: 0 };
    byOp[op].Calls += calls; byOp[op].Ok += Number(r.Ok) || 0;
    byOp[op].SvcF += Number(r.SvcF) || 0; byOp[op].AuthF += Number(r.AuthF) || 0; byOp[op].UsrF += Number(r.UsrF) || 0;
    const t = r.Tier === 'C1' ? 'C1' : 'C2';
    byTier[t].Calls += calls; byTier[t].SvcF += Number(r.SvcF) || 0; byTier[t].Ok += Number(r.Ok) || 0;
    const p50 = Number(r.p50), p95 = Number(r.p95), cv = Number(r.cntV) || 0;
    if (cv > 0 && isFinite(p50)) { p50wSum += p50 * cv; p95wSum += p95 * cv; pW += cv; }
    const cn = r.Conn || '(none)';
    byConn[cn] = byConn[cn] || { Calls: 0, Ok: 0, SvcF: 0, C1: { Calls: 0, SvcF: 0, Ok: 0 }, C2: { Calls: 0, SvcF: 0, Ok: 0 } };
    byConn[cn].Calls += calls; byConn[cn].Ok += Number(r.Ok) || 0; byConn[cn].SvcF += Number(r.SvcF) || 0;
    byConn[cn][t].Calls += calls; byConn[cn][t].SvcF += Number(r.SvcF) || 0; byConn[cn][t].Ok += Number(r.Ok) || 0;
  }
  const conns = Object.entries(byConn).map(([conn, v]) => ({
    conn, calls: v.Calls,
    svcSucc: v.Calls ? (v.Calls - v.SvcF) / v.Calls : 0,
    e2eSucc: v.Calls ? v.Ok / v.Calls : 0,
    c1svc: v.C1.Calls ? (v.C1.Calls - v.C1.SvcF) / v.C1.Calls : 0,
    c2svc: v.C2.Calls ? (v.C2.Calls - v.C2.SvcF) / v.C2.Calls : 0,
  })).sort((a, b) => b.calls - a.calls);
  const ops = Object.entries(byOp).map(([op, v]) => ({
    op, calls: v.Calls,
    svcSucc: v.Calls ? (v.Calls - v.SvcF) / v.Calls : 0,
    e2eSucc: v.Calls ? v.Ok / v.Calls : 0,
    authF: v.AuthF, svcF: v.SvcF, usrF: v.UsrF,
  })).sort((a, b) => b.calls - a.calls);
  return {
    calls: tot.Calls,
    svcSucc: tot.Calls ? (tot.Calls - tot.SvcF) / tot.Calls : 0,
    e2eSucc: tot.Calls ? tot.Ok / tot.Calls : 0,
    svcF: tot.SvcF, authF: tot.AuthF, usrF: tot.UsrF,
    c4xx: tot.c4xx, c5xx: tot.c5xx, throttle: tot.throttle, timeout: tot.timeout,
    p50: pW ? p50wSum / pW : null, p95: pW ? p95wSum / pW : null,
    byTier, ops, conns,
  };
}

function agg301(cells) {
  const z = () => ({ ODSP_ToolCalls: 0, ODSP_Know: 0, ODSP_Tasks: 0, CS_ToolCalls: 0, CS_Tasks: 0 });
  const byTier = { C1: z(), C2: z() };
  for (const c of cells) for (const r of (c.r301 || [])) {
    const t = r.Tier === 'C1' ? 'C1' : 'C2';
    for (const k of Object.keys(byTier[t])) byTier[t][k] += Number(r[k]) || 0;
  }
  const total = z();
  for (const t of ['C1', 'C2']) for (const k of Object.keys(total)) total[k] += byTier[t][k];
  return { C1: byTier.C1, C2: byTier.C2, Total: total };
}

const result = {};
for (const [wk, tag] of Object.entries(WEEKS)) {
  const cells = loadWeek(tag);
  result[wk] = { clusters: cells.length, m401: agg401(cells), m301: agg301(cells) };
}
fs.writeFileSync(path.join(__dirname, 'cs-weeks-merged.json'), JSON.stringify(result, null, 2));
console.log('wrote cs-weeks-merged.json');
for (const wk of Object.keys(result)) {
  const w = result[wk];
  console.log(wk.padEnd(13), 'calls', w.m401.calls, 'svc', (w.m401.svcSucc * 100).toFixed(1), 'e2e', (w.m401.e2eSucc * 100).toFixed(1),
    'p50', Math.round(w.m401.p50), 'p95', Math.round(w.m401.p95), '| 301 tool', w.m301.Total.ODSP_ToolCalls, 'know', w.m301.Total.ODSP_Know, 'tasks', w.m301.Total.ODSP_Tasks, 'CStool', w.m301.Total.CS_ToolCalls, 'CStasks', w.m301.Total.CS_Tasks);
}

// ============================================================================
// merge-cs-live.js — Merge per-cluster-week JSON (cs-pull/) into per-week
// aggregates for the LIVE dashboard weeks: Jul 5-11 (Last) and Jul 12-18 (This).
// 301: ODSP tool calls, knowledge, users/tenants/tasks (C1/C2/Total), CS totals.
// 401: service success %, end-to-end %, failure split, status split, latency
//      P50/P95 (call-weighted), per-OperationId success. Run: node merge-cs-live.js
// ============================================================================
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, 'cs-pull');

const WEEKS = ['Jul 5-11', 'Jul 12-18'];

function loadWeek(label) {
  const tag = label.replace(/[^\w]+/g, '_');
  const files = fs.readdirSync(OUT).filter(f => f.endsWith(`__${tag}.json`) && !f.includes('ERROR'));
  return files.map(f => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8')));
}

function agg401(cells) {
  // r401 rows: {Conn, Op, Tier, Calls, Ok, SvcF, AuthF, UsrF, c4xx, c5xx, throttle, timeout, sumV, cntV, p50, p95}
  const tot = { Calls: 0, Ok: 0, SvcF: 0, AuthF: 0, UsrF: 0, c4xx: 0, c5xx: 0, throttle: 0, timeout: 0 };
  const byOp = {}; // Op -> {Calls, Ok, SvcF, AuthF, UsrF}
  const byTier = { C1: { Calls: 0, SvcF: 0, Ok: 0 }, C2: { Calls: 0, SvcF: 0, Ok: 0 } };
  const byConn = {}; // Conn -> {Calls, Ok, SvcF, C1:{Calls,SvcF,Ok}, C2:{...}, p50wSum,p95wSum,pW}
  // call-weighted percentile approximation
  let p50wSum = 0, p95wSum = 0, pW = 0;
  for (const c of cells) {
    for (const r of (c.r401 || [])) {
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
      byConn[cn] = byConn[cn] || { Calls: 0, Ok: 0, SvcF: 0, C1: { Calls: 0, SvcF: 0, Ok: 0 }, C2: { Calls: 0, SvcF: 0, Ok: 0 }, p50wSum: 0, p95wSum: 0, pW: 0 };
      byConn[cn].Calls += calls; byConn[cn].Ok += Number(r.Ok) || 0; byConn[cn].SvcF += Number(r.SvcF) || 0;
      byConn[cn][t].Calls += calls; byConn[cn][t].SvcF += Number(r.SvcF) || 0; byConn[cn][t].Ok += Number(r.Ok) || 0;
      if (cv > 0 && isFinite(p50)) { byConn[cn].p50wSum += p50 * cv; byConn[cn].p95wSum += p95 * cv; byConn[cn].pW += cv; }
    }
  }
  const conns = Object.entries(byConn).map(([conn, v]) => ({
    conn, calls: v.Calls,
    svcSucc: v.Calls ? (v.Calls - v.SvcF) / v.Calls : 0,
    e2eSucc: v.Calls ? v.Ok / v.Calls : 0,
    c1svc: v.C1.Calls ? (v.C1.Calls - v.C1.SvcF) / v.C1.Calls : 0,
    c2svc: v.C2.Calls ? (v.C2.Calls - v.C2.SvcF) / v.C2.Calls : 0,
    c1e2e: v.C1.Calls ? v.C1.Ok / v.C1.Calls : 0,
    c2e2e: v.C2.Calls ? v.C2.Ok / v.C2.Calls : 0,
    p50: v.pW ? v.p50wSum / v.pW : null, p95: v.pW ? v.p95wSum / v.pW : null,
  })).sort((a, b) => b.calls - a.calls);
  const svcSucc = tot.Calls ? (tot.Calls - tot.SvcF) / tot.Calls : 0;
  const e2eSucc = tot.Calls ? tot.Ok / tot.Calls : 0;
  const ops = Object.entries(byOp).map(([op, v]) => ({
    op, calls: v.Calls,
    svcSucc: v.Calls ? (v.Calls - v.SvcF) / v.Calls : 0,
    e2eSucc: v.Calls ? v.Ok / v.Calls : 0,
    authF: v.AuthF, svcF: v.SvcF, usrF: v.UsrF,
  })).sort((a, b) => b.calls - a.calls);
  return {
    calls: tot.Calls, svcSucc, e2eSucc,
    svcF: tot.SvcF, authF: tot.AuthF, usrF: tot.UsrF,
    c4xx: tot.c4xx, c5xx: tot.c5xx, throttle: tot.throttle, timeout: tot.timeout,
    p50: pW ? p50wSum / pW : null, p95: pW ? p95wSum / pW : null,
    byTier, ops, conns,
  };
}

function agg301(cells) {
  // r301 rows by Tier: {ODSP_ToolCalls, ODSP_Know, ODSP_Users, ODSP_Tenants, ODSP_Tasks,
  //   CS_Users, CS_Tenants, CS_Tasks, CS_ToolCalls}
  const z = () => ({ ODSP_ToolCalls: 0, ODSP_Know: 0, ODSP_Users: 0, ODSP_Tenants: 0, ODSP_Tasks: 0, CS_Users: 0, CS_Tenants: 0, CS_Tasks: 0, CS_ToolCalls: 0 });
  const byTier = { C1: z(), C2: z() };
  for (const c of cells) {
    for (const r of (c.r301 || [])) {
      const t = r.Tier === 'C1' ? 'C1' : 'C2';
      for (const k of Object.keys(byTier[t])) byTier[t][k] += Number(r[k]) || 0;
    }
  }
  const total = z();
  for (const t of ['C1', 'C2']) for (const k of Object.keys(total)) total[k] += byTier[t][k];
  return { C1: byTier.C1, C2: byTier.C2, Total: total };
}

const result = {};
for (const wk of WEEKS) {
  const cells = loadWeek(wk);
  result[wk] = { clusters: cells.length, m401: agg401(cells), m301: agg301(cells) };
}
fs.writeFileSync(path.join(__dirname, 'cs-live-merged.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));

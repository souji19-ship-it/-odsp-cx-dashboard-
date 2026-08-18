// Merge Aug 2-8 401 aggregate from cs-pull/*__Aug_2_8.json using the SAME agg401
// logic as merge-cs-live.js. Also prints 301 cross-check.
const fs = require('fs'); const path = require('path');
const OUT = path.join(__dirname, 'cs-pull');
const TAG = 'Aug_2_8';
const files = fs.readdirSync(OUT).filter(f => f.endsWith(`__${TAG}.json`) && !f.includes('ERROR'));
const cells = files.map(f => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8')));
function agg401(cells){
  const tot={Calls:0,Ok:0,SvcF:0,AuthF:0,UsrF:0,c4xx:0,c5xx:0,throttle:0,timeout:0};
  const byOp={},byTier={C1:{Calls:0,SvcF:0,Ok:0},C2:{Calls:0,SvcF:0,Ok:0}},byConn={};
  let p50wSum=0,p95wSum=0,pW=0;
  for(const c of cells){for(const r of (c.r401||[])){
    const calls=Number(r.Calls)||0;
    tot.Calls+=calls;tot.Ok+=Number(r.Ok)||0;tot.SvcF+=Number(r.SvcF)||0;tot.AuthF+=Number(r.AuthF)||0;tot.UsrF+=Number(r.UsrF)||0;
    tot.c4xx+=Number(r.c4xx)||0;tot.c5xx+=Number(r.c5xx)||0;tot.throttle+=Number(r.throttle)||0;tot.timeout+=Number(r.timeout)||0;
    const op=r.Op||'(none)';byOp[op]=byOp[op]||{Calls:0,Ok:0,SvcF:0,AuthF:0,UsrF:0};
    byOp[op].Calls+=calls;byOp[op].Ok+=Number(r.Ok)||0;byOp[op].SvcF+=Number(r.SvcF)||0;byOp[op].AuthF+=Number(r.AuthF)||0;byOp[op].UsrF+=Number(r.UsrF)||0;
    const t=r.Tier==='C1'?'C1':'C2';byTier[t].Calls+=calls;byTier[t].SvcF+=Number(r.SvcF)||0;byTier[t].Ok+=Number(r.Ok)||0;
    const p50=Number(r.p50),p95=Number(r.p95),cv=Number(r.cntV)||0;
    if(cv>0&&isFinite(p50)){p50wSum+=p50*cv;p95wSum+=p95*cv;pW+=cv;}
    const cn=r.Conn||'(none)';byConn[cn]=byConn[cn]||{Calls:0,Ok:0,SvcF:0,C1:{Calls:0,SvcF:0,Ok:0},C2:{Calls:0,SvcF:0,Ok:0},p50wSum:0,p95wSum:0,pW:0};
    byConn[cn].Calls+=calls;byConn[cn].Ok+=Number(r.Ok)||0;byConn[cn].SvcF+=Number(r.SvcF)||0;
    byConn[cn][t].Calls+=calls;byConn[cn][t].SvcF+=Number(r.SvcF)||0;byConn[cn][t].Ok+=Number(r.Ok)||0;
    if(cv>0&&isFinite(p50)){byConn[cn].p50wSum+=p50*cv;byConn[cn].p95wSum+=p95*cv;byConn[cn].pW+=cv;}
  }}
  const conns=Object.entries(byConn).map(([conn,v])=>({conn,calls:v.Calls,
    svcSucc:v.Calls?(v.Calls-v.SvcF)/v.Calls:0,e2eSucc:v.Calls?v.Ok/v.Calls:0,
    p50:v.pW?v.p50wSum/v.pW:null,p95:v.pW?v.p95wSum/v.pW:null})).sort((a,b)=>b.calls-a.calls);
  const svcSucc=tot.Calls?(tot.Calls-tot.SvcF)/tot.Calls:0,e2eSucc=tot.Calls?tot.Ok/tot.Calls:0;
  const ops=Object.entries(byOp).map(([op,v])=>({op,calls:v.Calls,
    svcSucc:v.Calls?(v.Calls-v.SvcF)/v.Calls:0,e2eSucc:v.Calls?v.Ok/v.Calls:0,
    authF:v.AuthF,svcF:v.SvcF,usrF:v.UsrF})).sort((a,b)=>b.calls-a.calls);
  return{calls:tot.Calls,svcSucc,e2eSucc,svcF:tot.SvcF,authF:tot.AuthF,usrF:tot.UsrF,
    c4xx:tot.c4xx,c5xx:tot.c5xx,throttle:tot.throttle,timeout:tot.timeout,
    p50:pW?p50wSum/pW:null,p95:pW?p95wSum/pW:null,byTier,ops,conns};
}
const m=agg401(cells);
const pct=x=>(100*x).toFixed(1)+'%';
console.log('clusters',cells.length,'  ODSP tool Calls',m.calls);
console.log('Service success',pct(m.svcSucc),' E2E success',pct(m.e2eSucc));
console.log('Failure mix: Service',m.svcF,'('+pct(m.svcF/m.calls)+')  Author',m.authF,'('+pct(m.authF/m.calls)+')  User',m.usrF);
console.log('Latency call-weighted  P50',Math.round(m.p50),'ms  P95',Math.round(m.p95),'ms');
console.log('\nConnectors:');
for(const c of m.conns) console.log('  '+c.conn+'  calls '+c.calls+'  svc '+pct(c.svcSucc)+'  e2e '+pct(c.e2eSucc)+'  P50 '+Math.round(c.p50)+'  P95 '+Math.round(c.p95));
console.log('\nTop operations by calls:');
for(const o of m.ops.slice(0,12)) console.log('  '+(o.op||'(none)').padEnd(28)+' calls '+String(o.calls).padStart(8)+'  svc '+pct(o.svcSucc)+'  e2e '+pct(o.e2eSucc)+'  (svcF '+o.svcF+' authF '+o.authF+' usrF '+o.usrF+')');
fs.writeFileSync(path.join(__dirname,'cs-aug2-401.json'),JSON.stringify(m,null,2));
// 301 cross-check
const z=()=>({ODSP_ToolCalls:0,ODSP_Know:0,ODSP_Users:0,ODSP_Tenants:0,ODSP_Tasks:0,CS_Users:0,CS_Tenants:0,CS_Tasks:0,CS_ToolCalls:0});
const T=z();for(const c of cells)for(const r of (c.r301||[]))for(const k of Object.keys(T))T[k]+=Number(r[k])||0;
console.log('\n301 (dcountif-summed cross-check):',JSON.stringify(T));

const fs=require('fs'),path=require('path');
const DIR=path.join(__dirname,process.env.CS_VALIDATE_OUT||'cs-validate-tier');
const files=fs.readdirSync(DIR).filter(f=>f.endsWith('.json')&&!f.includes('ERROR'));
// wk -> tier -> sets/counts ; plus 'Total' tier = union across tiers
const wk={};
function ensure(L,t){if(!wk[L])wk[L]={};if(!wk[L][t])wk[L][t]={U:new Set(),T:new Set(),A:new Set(),Tasks:0,Tools:0,Knows:0,SvcFail:0,Patch:0};return wk[L][t];}
for(const f of files){
  const j=JSON.parse(fs.readFileSync(path.join(DIR,f),'utf8'));
  for(const r of j.rows){
    const L=r.WeekLabel, t=r.Tier;
    for(const tier of [t,'Total']){
      const o=ensure(L,tier);
      (r.Users||[]).forEach(x=>o.U.add(x));
      (r.Tenants||[]).forEach(x=>o.T.add(x));
      (r.Agents||[]).forEach(x=>o.A.add(x));
      o.Tasks+=r.Tasks||0;o.Tools+=r.Tools||0;o.Knows+=r.Knows||0;o.SvcFail+=r.SvcFail||0;o.Patch+=r.Patch||0;
    }
  }
}
const out={};
for(const L of Object.keys(wk).sort()){
  out[L]={};
  for(const tier of ['C1','C2','Total']){
    const o=wk[L][tier]; if(!o)continue;
    out[L][tier]={Users:o.U.size,Tenants:o.T.size,Agents:o.A.size,Tasks:o.Tasks,Tools:o.Tools,
      SuccPct:o.Tools?Math.round(1000*(1-o.SvcFail/o.Tools))/10:null,Patch:o.Patch,Knows:o.Knows};
  }
}
const outFile=process.env.CS_VALIDATE_AGG_OUT||'cs-validate-tier-agg.json';
fs.writeFileSync(outFile,JSON.stringify(out,null,2));
for(const L of Object.keys(out).sort()){
  console.log('\n=== '+L+' ===');
  console.table(out[L]);
}

const fs=require('fs'),path=require('path');
const DIR=path.join(__dirname,'cs-validate');
const files=fs.readdirSync(DIR).filter(f=>f.endsWith('.json')&&!f.includes('ERROR'));
const wk={}; // label -> {U:Set,T:Set,A:Set,Tasks,Tools,Knows,SvcFail,Patch}
for(const f of files){
  const j=JSON.parse(fs.readFileSync(path.join(DIR,f),'utf8'));
  for(const r of j.rows){
    const L=r.WeekLabel;
    if(!wk[L])wk[L]={U:new Set(),T:new Set(),A:new Set(),Tasks:0,Tools:0,Knows:0,SvcFail:0,Patch:0};
    const o=wk[L];
    (r.Users||[]).forEach(x=>o.U.add(x));
    (r.Tenants||[]).forEach(x=>o.T.add(x));
    (r.Agents||[]).forEach(x=>o.A.add(x));
    o.Tasks+=r.Tasks||0; o.Tools+=r.Tools||0; o.Knows+=r.Knows||0;
    o.SvcFail+=r.SvcFail||0; o.Patch+=r.Patch||0;
  }
}
const out=[];
for(const L of Object.keys(wk).sort()){
  const o=wk[L];
  out.push({Week:L,ActiveUsers:o.U.size,ActiveTenants:o.T.size,ActiveAgents:o.A.size,
    Tasks:o.Tasks,ToolCalls:o.Tools,
    ToolSuccessPct:o.Tools?Math.round((100*(1-o.SvcFail/o.Tools))*10)/10:null,
    PatchItem:o.Patch,SharePointKnowledge:o.Knows});
}
fs.writeFileSync('cs-validate-agg.json',JSON.stringify(out,null,2));
console.table(out);

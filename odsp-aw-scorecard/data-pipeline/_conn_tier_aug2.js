const fs=require('fs'),path=require('path');
const OUT=path.join(__dirname,'cs-pull');
const files=fs.readdirSync(OUT).filter(f=>f.endsWith('__Aug_2_8.json'));
const agg={}; // conn -> tier -> {calls,svcF}
let clusters=0;
for(const f of files){
  const j=JSON.parse(fs.readFileSync(path.join(OUT,f),'utf8'));
  if(!j.r401) continue; clusters++;
  for(const r of j.r401){
    const conn=r.Conn, tier=r.Tier;
    agg[conn]=agg[conn]||{}; agg[conn][tier]=agg[conn][tier]||{calls:0,svcF:0,ok:0};
    agg[conn][tier].calls+=r.Calls; agg[conn][tier].svcF+=r.SvcF; agg[conn][tier].ok+=r.Ok;
  }
}
console.log('clusters',clusters,'files',files.length);
for(const conn of Object.keys(agg)){
  let tc=0,tf=0;
  for(const tier of Object.keys(agg[conn])){
    const a=agg[conn][tier]; const svc=(1-a.svcF/a.calls)*100;
    tc+=a.calls; tf+=a.svcF;
    console.log(conn, tier, 'calls',a.calls,'svc%',svc.toFixed(1));
  }
  console.log(conn,'ALL calls',tc,'svc%',((1-tf/tc)*100).toFixed(1));
}

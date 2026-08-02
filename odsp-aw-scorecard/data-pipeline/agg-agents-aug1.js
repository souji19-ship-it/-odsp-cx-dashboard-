const fs=require('fs');const path=require('path');
const DIR=path.join(__dirname,'cs-odsp-agents');
const label='Jul_26_Aug_1';
const files=fs.readdirSync(DIR).filter(f=>f.includes(label)&&f.endsWith('.json')&&!f.includes('ERROR'));
const c1=new Set(),c2=new Set(),all=new Set();
let n=0;
for(const f of files){
  const j=JSON.parse(fs.readFileSync(path.join(DIR,f),'utf8'));
  if(!j.rows)continue;n++;
  for(const r of j.rows){
    const set=(r.agents||[]);
    for(const b of set){all.add(b);if(r.Tier==='C1')c1.add(b);else if(r.Tier==='C2')c2.add(b);}
  }
}
console.log('files aggregated:',n,'of',files.length);
console.log(JSON.stringify({week:'Jul 26-Aug 1',C1:c1.size,C2:c2.size,Total:all.size},null,2));
// prior week for WoW
const base=14368;const t=all.size;
console.log('WoW vs 14,368:',(((t-base)/base)*100).toFixed(1)+'%');

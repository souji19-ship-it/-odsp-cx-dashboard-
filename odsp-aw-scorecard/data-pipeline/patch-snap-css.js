// One-off: patch the .sig .sv clip fix into the 2026-07-11 snapshot's embedded CSS only.
const fs=require('fs');
const path='../dashboard/ODSP-in-Agentic-Work-Scorecard.html';
const raw=fs.readFileSync(path,'utf8');
const eol=raw.includes('\r\n')?'\r\n':'\n';
const lines=raw.split(/\r?\n/);
const idx=lines.findIndex(l=>l.startsWith('window.SNAP='));
if(idx<0){console.error('no SNAP');process.exit(1);}
const SNAP=JSON.parse(lines[idx].replace(/^window\.SNAP=/,'').replace(/;\s*$/,''));
let s=SNAP['2026-07-11'];

function replaceOnce(str,find,rep,label){
  if(!str.includes(find)){throw new Error('CSS patch miss: '+label);}
  const first=str.indexOf(find);
  if(str.indexOf(find,first+1)!==-1){throw new Error('CSS patch not unique: '+label);}
  return str.slice(0,first)+rep+str.slice(first+find.length);
}

s=replaceOnce(s,
  '.sig .sv{font-weight:800;font-size:12.5px;text-align:right;white-space:nowrap}',
  '.sig .sv{font-weight:800;font-size:12.5px;text-align:right;white-space:nowrap;min-width:0}',
  '.sig .sv');
s=replaceOnce(s,
  '.sig .sv small{display:block;font-weight:600;color:var(--faint);font-size:10.5px;margin-top:1px}',
  '.sig .sv small{display:block;font-weight:600;color:var(--faint);font-size:10.5px;margin-top:1px;white-space:normal}',
  '.sig .sv small');

SNAP['2026-07-11']=s;
lines[idx]='window.SNAP='+JSON.stringify(SNAP)+';';
fs.writeFileSync(path,lines.join(eol));
console.log('OK: patched 2026-07-11 snapshot CSS clip fix.');

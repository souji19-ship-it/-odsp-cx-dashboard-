import json, glob, os
outdir="cs-aug9-15-dist"
U=set(); T=set(); K=set()
calls=ok=svcf=0; nfiles=0; errs=[]
for f in glob.glob(os.path.join(outdir,"*.json")):
    if "ERROR" in f: errs.append(os.path.basename(f)); continue
    j=json.load(open(f)); nfiles+=1
    s=j["sets"][0] if j["sets"] else {}
    for u in (s.get("users") or []): U.add(u)
    for t in (s.get("tenants") or []): T.add(t)
    for c in (s.get("tasks") or []): K.add(c)
    for r in j["r401"]:
        calls+=r["Calls"]; ok+=r["Ok"]; svcf+=r["SvcF"]
sr_svc=(calls-svcf)/calls*100 if calls else 0
sr_ok=ok/calls*100 if calls else 0
print(f"===== Aug 9-15 GLOBAL DISTINCT ({nfiles} clusters{', ERR:'+','.join(errs) if errs else ''}) =====")
print(f"  users (global union)  : {len(U):,}")
print(f"  tenants (global union): {len(T):,}")
print(f"  tasks (global union)  : {len(K):,}")
print(f"  success (Calls-SvcF)/C: {sr_svc:.1f}%   (calls {calls:,}, svcFail {svcf:,})")
print(f"  success Ok/Calls      : {sr_ok:.1f}%   (ok {ok:,})")

import json, glob, sys, os

def agg(outdir, label):
    users=tenants=tasks=tool=know=0
    calls=ok=svcf=0
    c1_tool=c2_tool=c1_know=c2_know=0
    agents=set()
    nfiles=0; errs=[]
    for f in glob.glob(os.path.join(outdir,"*.json")):
        if "ERROR" in f: errs.append(os.path.basename(f)); continue
        j=json.load(open(f)); nfiles+=1
        for r in j["r301"]:
            tool+=r["ODSP_ToolCalls"]; know+=r["ODSP_Know"]
            users+=r["ODSP_Users"]; tenants+=r["ODSP_Tenants"]; tasks+=r["ODSP_Tasks"]
            for b in (r.get("agents") or []): agents.add(b)
            if r["Tier"]=="C1": c1_tool+=r["ODSP_ToolCalls"]; c1_know+=r["ODSP_Know"]
            else: c2_tool+=r["ODSP_ToolCalls"]; c2_know+=r["ODSP_Know"]
        for r in j["r401"]:
            calls+=r["Calls"]; ok+=r["Ok"]; svcf+=r["SvcF"]
    sr=(calls-svcf)/calls*100 if calls else 0
    print(f"\n===== {label}  ({nfiles} clusters{', ERR:'+','.join(errs) if errs else ''}) =====")
    print(f"  ODSP-active users     : {users:>10,}   (sum-of-region dcount)")
    print(f"  ODSP-active tenants   : {tenants:>10,}   (sum-of-region dcount)")
    print(f"  ODSP-active agents    : {len(agents):>10,}   (exact global union)")
    print(f"  ODSP-backed tasks     : {tasks:>10,}   (sum-of-region dcount ConvId)")
    print(f"  ODSP tool calls       : {tool:>10,}   (C1 {c1_tool:,} / C2 {c2_tool:,})")
    print(f"  ODSP knowledge search : {know:>10,}   (C1 {c1_know:,} / C2 {c2_know:,})")
    print(f"  ODSP tool success rate: {sr:>9.1f}%   (calls {calls:,}, svcFail {svcf:,})")

agg("cs-aug-mtd","AUGUST MTD  (Aug 1 - Aug 22)")
agg("cs-aug16-22","WEEK  Aug 16 - Aug 22 (Sun-Sat)")

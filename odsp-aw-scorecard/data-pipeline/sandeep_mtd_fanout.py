"""Faithful per-cluster reproduction of Sandeep's odsp_weekly_refresh_cap.py for Aug MTD.
Runs his EXACT q_odsp / q_den / q_know filter logic per cluster (returning hll sketches +
scalar sums), then hll_merge on the driver. Math is identical to his federated union query,
but executes reliably for a 3-week window. Auth: az login first."""
import datetime as dt, json, os, sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from azure.kusto.data import KustoClient, KustoConnectionStringBuilder, ClientRequestProperties
from azure.identity import AzureCliCredential

W0, W1 = os.environ.get("MW0","2026-08-01"), os.environ.get("MW1","2026-08-23")   # Aug MTD (end-exclusive)
DRIVER = "https://fdislandsus.centralus.kusto.windows.net"
CLUSTERS = [
 "fdislandsus.centralus","fdislandsas.southeastasia","fdislandsau.australiaeast","fdislandsbr.brazilsouth",
 "fdislandsca.canadacentral","fdislandsch.switzerlandnorth","fdislandsde.germanywestcentral","fdislandseu.westeurope",
 "fdislandsfr.francecentral","fdislandsin.centralindia","fdislandsjp.japaneast","fdislandskr.koreasouth",
 "fdislandsno.norwayeast","fdislandsse.swedencentral","fdislandssg.southeastasia","fdislandsuk.uksouth",
 "fdislandsza.southafricanorth"]

_cred = AzureCliCredential(process_timeout=60)
def _client(url):
    kcsb = KustoConnectionStringBuilder.with_token_provider(url, lambda: _cred.get_token(url.rstrip('/')+"/.default").token)
    return KustoClient(kcsb)

def run(url, kql, mins=8, tries=6):
    last=None
    for i in range(tries):
        try:
            c=_client(url)
            p=ClientRequestProperties(); p.set_option(ClientRequestProperties.request_timeout_option_name, dt.timedelta(minutes=mins))
            return list(c.execute("CAPAnalytics", kql, p).primary_results[0])
        except Exception as e:
            last=e; print(f"    {url.split('//')[1].split('.')[0]} retry {i+1}/{tries}: {str(e)[:70]}", flush=True); 
    raise last

HDR = f"""set best_effort=true;
let W0=datetime({W0}); let W1=datetime({W1});
let apps=dynamic(['fabric:/CopilotStudio.AgenticRuntime','fabric:/CopilotStudio.AgenticLoopApp']);
let ODSPconn=dynamic(['shared_sharepointonline','shared_onedriveforbusiness']);
let ODSPks=dynamic(['SharePoint','SharePointList']);"""

def q_odsp(c):
    return HDR + f"""
cluster('{c}.kusto.windows.net').database('CAPAnalytics').TraceEvents
| where env_time>=W0 and env_time<W1 | where applicationName in (apps)
| where eventName in ('AgenticLoopToolCallLatency','KnowledgeSourceLatency')
| where (eventName=='AgenticLoopToolCallLatency' and (customDimensions contains 'shared_sharepointonline' or customDimensions contains 'shared_onedriveforbusiness')) or (eventName=='KnowledgeSourceLatency' and customDimensions contains 'SharePoint')
| extend cd=parse_json(customDimensions) | extend inner=parse_json(tostring(cd.CustomDimensions))
| extend conn=tostring(inner.ConnectorId), ks=tostring(inner.KnowledgeSource)
| where (eventName=='AgenticLoopToolCallLatency' and conn in (ODSPconn)) or (eventName=='KnowledgeSourceLatency' and ks in (ODSPks))
| extend isToolEvent=(eventName=='AgenticLoopToolCallLatency'), svcFail=(tostring(inner.FailureClass)=='Service')
| summarize hU=hll(tostring(principalObjectId)), hT=hll(tostring(principalTenantId)), hA=hll(tostring(cd.CdsBotId)), hC=hll(tostring(cd.ConversationId)), ToolCalls=countif(isToolEvent), SvcFail=countif(isToolEvent and svcFail)"""

def q_den(c):
    return HDR + f"""
cluster('{c}.kusto.windows.net').database('CAPAnalytics').TraceEvents
| where env_time>=W0 and env_time<W1 | where applicationName in (apps)
| where eventName in ('AgenticLoopTurnLatency','AgenticLoopToolCallLatency')
| extend isTurn=(eventName=='AgenticLoopTurnLatency')
| extend cd=iff(isTurn,parse_json(customDimensions),dynamic(null))
| summarize hU=hll(tostring(principalObjectId)), hT=hll(tostring(principalTenantId)), hA=hll(tostring(cd.CdsBotId)), hC=hll(tostring(cd.ConversationId)), n=count() by isTurn"""

def q_know(c):
    return HDR + f"""
cluster('{c}.kusto.windows.net').database('CAPAnalytics').TraceEvents
| where env_time>=W0 and env_time<W1 | where applicationName in (apps) | where eventName=='KnowledgeSourceLatency'
| extend maybeSP=(customDimensions contains 'SharePoint' or customDimensions contains 'OneDrive')
| extend cd=iff(maybeSP,parse_json(customDimensions),dynamic(null)) | extend inner=iff(maybeSP,parse_json(tostring(cd.CustomDimensions)),dynamic(null))
| extend kc=tostring(inner.KnowledgeCategory), ksrc=tostring(inner.KnowledgeSource)
| summarize AllKnowledge=count(), OdspKnowledge=countif(kc=='SharePoint'), OdspKnowledgeSrc=countif(ksrc in (ODSPks))"""

CACHE = os.path.join(os.path.dirname(__file__), "sandeep-mtd-cache-"+W0)
os.makedirs(CACHE, exist_ok=True)

def pull_cluster(c):
    cf = os.path.join(CACHE, c.replace('.','_')+".json")
    if os.path.exists(cf):
        return c, json.load(open(cf))
    url = f"https://{c}.kusto.windows.net"
    odsp = run(url, q_odsp(c))[0]
    den  = run(url, q_den(c))
    know = run(url, q_know(c))[0]
    def sk(v): return json.dumps(v)  # serialize hll sketch object
    rec = {
      "odsp": {"hU":sk(odsp["hU"]),"hT":sk(odsp["hT"]),"hA":sk(odsp["hA"]),"hC":sk(odsp["hC"]),
               "ToolCalls":odsp["ToolCalls"],"SvcFail":odsp["SvcFail"]},
      "den": [{"isTurn":r["isTurn"],"hU":sk(r["hU"]),"hT":sk(r["hT"]),"hA":sk(r["hA"]),"hC":sk(r["hC"]),"n":r["n"]} for r in den],
      "know": {"AllKnowledge":know["AllKnowledge"],"OdspKnowledge":know["OdspKnowledge"],"OdspKnowledgeSrc":know["OdspKnowledgeSrc"]},
    }
    json.dump(rec, open(cf,"w"))
    print(f"  [{c}] odsp tools={odsp['ToolCalls']:,} know={know['OdspKnowledge']:,}", flush=True)
    return c, rec

print(f"=== Sandeep CAP methodology (per-cluster faithful) — Aug MTD {W0}..{W1} ===", flush=True)
recs={}
with ThreadPoolExecutor(max_workers=8) as ex:
    futs={ex.submit(pull_cluster,c):c for c in CLUSTERS}
    for f in as_completed(futs):
        try: c,rec=f.result(); recs[c]=rec
        except Exception as e: print(f"  FAILED {futs[f]}: {str(e)[:100]}", flush=True); sys.exit(1)

# ---- merge on driver ----
def merge_reach(kind):
    # kind: 'odsp' -> ODSP reach sketches; 'den' -> all-up turn-row sketches
    rows=[]
    for c,rec in recs.items():
        if kind=='odsp':
            o=rec["odsp"]; rows.append((o["hU"],o["hT"],o["hA"],o["hC"]))
        else:
            for r in rec["den"]:
                if r["isTurn"]: rows.append((r["hU"],r["hT"],r["hA"],r["hC"]))
    vals=",\n".join(f"dynamic({u}),dynamic({t}),dynamic({a}),dynamic({cc})" for (u,t,a,cc) in rows)
    kql=f"""datatable(hU:dynamic,hT:dynamic,hA:dynamic,hC:dynamic)[
{vals}
]
| summarize hU=hll_merge(hU),hT=hll_merge(hT),hA=hll_merge(hA),hC=hll_merge(hC)
| project Users=dcount_hll(hU),Tenants=dcount_hll(hT),Agents=dcount_hll(hA),Tasks=dcount_hll(hC)"""
    return run(DRIVER,kql,mins=5)[0]

odsp_reach = merge_reach('odsp')
allup_reach = merge_reach('den')
odsp_tools = sum(rec["odsp"]["ToolCalls"] for rec in recs.values())
odsp_svcfail = sum(rec["odsp"]["SvcFail"] for rec in recs.values())
allup_tools = sum(r["n"] for rec in recs.values() for r in rec["den"] if not r["isTurn"])
odsp_know = sum(rec["know"]["OdspKnowledge"] for rec in recs.values())
odsp_know_src = sum(rec["know"]["OdspKnowledgeSrc"] for rec in recs.values())
all_know = sum(rec["know"]["AllKnowledge"] for rec in recs.values())
succ = round(100.0*(1.0-odsp_svcfail/odsp_tools),1) if odsp_tools else None

def sh(a,b): return round(100.0*a/b,1) if b else None
out = {
 "window":{"W0":W0,"W1":W1},
 "ODSP":{"Users":odsp_reach["Users"],"Tenants":odsp_reach["Tenants"],"Agents":odsp_reach["Agents"],
         "Tasks":odsp_reach["Tasks"],"ToolCalls":odsp_tools,"KnowledgeSources":odsp_know,
         "KnowledgeSources_SrcDef":odsp_know_src,
         "ServiceFailures":odsp_svcfail,"SuccessPct":succ},
 "Allup":{"Users":allup_reach["Users"],"Tenants":allup_reach["Tenants"],"Agents":allup_reach["Agents"],
          "Tasks":allup_reach["Tasks"],"ToolCalls":allup_tools,"KnowledgeSources":all_know},
 "Shares":{"Users":sh(odsp_reach["Users"],allup_reach["Users"]),"Tenants":sh(odsp_reach["Tenants"],allup_reach["Tenants"]),
           "Agents":sh(odsp_reach["Agents"],allup_reach["Agents"]),"Tasks":sh(odsp_reach["Tasks"],allup_reach["Tasks"]),
           "ToolCalls":sh(odsp_tools,allup_tools),"Knowledge":sh(odsp_know,all_know)},
}
out["Combined"]={"ODSP_TK":odsp_tools+odsp_know,"Allup_TK":allup_tools+all_know,
                 "WeightedComposition":sh(odsp_tools+odsp_know,allup_tools+all_know)}
json.dump(out, open(os.path.join(os.path.dirname(__file__),"sandeep-mtd-result-"+W0+".json"),"w"), indent=2)
print("\n"+json.dumps(out,indent=2))

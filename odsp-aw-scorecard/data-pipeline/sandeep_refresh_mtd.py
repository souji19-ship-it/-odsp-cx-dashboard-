# /// script
# requires-python = ">=3.10"
# dependencies = ["azure-kusto-data>=4.5"]
# ///
"""ODSP weekly snapshot — ALL metrics from CAP (no Silver). 3 CAP fan-out queries with retries.
Edit W0/W1 to the target Sun..next-Sun week. Auth: az login first.
See ../ODSP-Weekly-Refresh-Validation.md."""
import datetime as dt, time
from azure.kusto.data import KustoClient, KustoConnectionStringBuilder, ClientRequestProperties

W0, W1 = "2026-08-01", "2026-08-23"   # Aug MTD   # <-- week (Sun..next Sun)
CAP = "https://fdislandsus.centralus.kusto.windows.net"
CLUSTERS = [
 "fdislandsus.centralus","fdislandsas.southeastasia","fdislandsau.australiaeast","fdislandsbr.brazilsouth",
 "fdislandsca.canadacentral","fdislandsch.switzerlandnorth","fdislandsde.germanywestcentral","fdislandseu.westeurope",
 "fdislandsfr.francecentral","fdislandsin.centralindia","fdislandsjp.japaneast","fdislandskr.koreasouth",
 "fdislandsno.norwayeast","fdislandsse.swedencentral","fdislandssg.southeastasia","fdislandsuk.uksouth",
 "fdislandsza.southafricanorth"]
UNION = ",\n  ".join(f"D(cluster('{c}.kusto.windows.net').database('CAPAnalytics').TraceEvents)" for c in CLUSTERS)

def run(kql, mins=8, tries=8):
    last=None
    for i in range(tries):
        try:
            from azure.identity import AzureCliCredential
            _cred=AzureCliCredential(process_timeout=60)
            _kcsb=KustoConnectionStringBuilder.with_token_provider(CAP, lambda: _cred.get_token(CAP.rstrip('/')+"/.default").token)
            c=KustoClient(_kcsb)
            p=ClientRequestProperties(); p.set_option(ClientRequestProperties.request_timeout_option_name, dt.timedelta(minutes=mins))
            return list(c.execute("CAPAnalytics", kql, p).primary_results[0])
        except Exception as e:
            last=e; print(f"    retry {i+1}/{tries}: {str(e)[:80]}"); time.sleep(5)
    raise last

# 1) ALL ODSP metrics from CAP: reach (Users/Tenants/Agents/Tasks) + Tool Calls + Success%
q_odsp = f"""set best_effort=true;
let W0=datetime({W0}); let W1=datetime({W1});
let apps=dynamic(['fabric:/CopilotStudio.AgenticRuntime','fabric:/CopilotStudio.AgenticLoopApp']);
let ODSPconn=dynamic(['shared_sharepointonline','shared_onedriveforbusiness']);
let ODSPks=dynamic(['SharePoint','SharePointList']);
let D=(T:(env_time:datetime,applicationName:string,eventName:string,principalObjectId:string,principalTenantId:string,customDimensions:string)){{
 T | where env_time>=W0 and env_time<W1 | where applicationName in (apps)
 | where eventName in ('AgenticLoopToolCallLatency','KnowledgeSourceLatency')
 | where (eventName=='AgenticLoopToolCallLatency' and (customDimensions contains 'shared_sharepointonline' or customDimensions contains 'shared_onedriveforbusiness')) or (eventName=='KnowledgeSourceLatency' and customDimensions contains 'SharePoint')
 | extend cd=parse_json(customDimensions) | extend inner=parse_json(tostring(cd.CustomDimensions))
 | extend conn=tostring(inner.ConnectorId), ks=tostring(inner.KnowledgeSource)
 | where (eventName=='AgenticLoopToolCallLatency' and conn in (ODSPconn)) or (eventName=='KnowledgeSourceLatency' and ks in (ODSPks))
 | extend isToolEvent=(eventName=='AgenticLoopToolCallLatency'), svcFail=(tostring(inner.FailureClass)=='Service')
 | summarize hU=hll(tostring(principalObjectId)), hT=hll(tostring(principalTenantId)), hA=hll(tostring(cd.CdsBotId)),
             hC=hll(tostring(cd.ConversationId)), ToolCalls=countif(isToolEvent), SvcFail=countif(isToolEvent and svcFail) }};
union isfuzzy=true
  {UNION}
| summarize hU=hll_merge(hU),hT=hll_merge(hT),hA=hll_merge(hA),hC=hll_merge(hC),ToolCalls=sum(ToolCalls),SvcFail=sum(SvcFail)
| project Users=dcount_hll(hU), Tenants=dcount_hll(hT), Agents=dcount_hll(hA), Tasks=dcount_hll(hC),
          ToolCalls, SuccPct=iff(ToolCalls>0, round(100.0*(1.0-todouble(SvcFail)/ToolCalls),1), real(null))"""

# 2) all-up denominators (CAP)
q_den = f"""set best_effort=true;
let W0=datetime({W0}); let W1=datetime({W1});
let apps=dynamic(['fabric:/CopilotStudio.AgenticRuntime','fabric:/CopilotStudio.AgenticLoopApp']);
let D=(T:(env_time:datetime,applicationName:string,eventName:string,principalObjectId:string,principalTenantId:string,customDimensions:string)){{
 T | where env_time>=W0 and env_time<W1 | where applicationName in (apps)
 | where eventName in ('AgenticLoopTurnLatency','AgenticLoopToolCallLatency')
 | extend isTurn=(eventName=='AgenticLoopTurnLatency')
 | extend cd=iff(isTurn,parse_json(customDimensions),dynamic(null))
 | summarize hU=hll(tostring(principalObjectId)), hT=hll(tostring(principalTenantId)), hA=hll(tostring(cd.CdsBotId)), hC=hll(tostring(cd.ConversationId)), n=count() by isTurn }};
union isfuzzy=true
  {UNION}
| summarize hU=hll_merge(hU),hT=hll_merge(hT),hA=hll_merge(hA),hC=hll_merge(hC),n=sum(n) by isTurn
| project isTurn, Users=iff(isTurn,dcount_hll(hU),long(null)), Tenants=iff(isTurn,dcount_hll(hT),long(null)),
          Agents=iff(isTurn,dcount_hll(hA),long(null)), Tasks=iff(isTurn,dcount_hll(hC),long(null)), ToolCalls=iff(isTurn,long(null),n)"""

# 3) knowledge (ODSP + All) (CAP)
q_know = f"""set best_effort=true;
let W0=datetime({W0}); let W1=datetime({W1});
let apps=dynamic(['fabric:/CopilotStudio.AgenticRuntime','fabric:/CopilotStudio.AgenticLoopApp']);
let D=(T:(env_time:datetime,applicationName:string,eventName:string,customDimensions:string)){{
 T | where env_time>=W0 and env_time<W1 | where applicationName in (apps) | where eventName=='KnowledgeSourceLatency'
 | extend maybeSP=(customDimensions contains 'SharePoint' or customDimensions contains 'OneDrive')
 | extend cd=iff(maybeSP,parse_json(customDimensions),dynamic(null)) | extend inner=iff(maybeSP,parse_json(tostring(cd.CustomDimensions)),dynamic(null))
 | extend kc=tostring(inner.KnowledgeCategory)
 | summarize AllKnowledge=count(), OdspKnowledge=countif(kc=='SharePoint') }};
union isfuzzy=true
  {UNION}
| summarize AllKnowledge=sum(AllKnowledge), OdspKnowledge=sum(OdspKnowledge)"""

print(f"=== ODSP Pulse (CAP-only) — week {W0} .. {W1} ===")
print("[1/3] CAP ODSP metrics…"); o = run(q_odsp)[0]
print("[2/3] CAP all-up denominators…"); den = {r["isTurn"]: r for r in run(q_den)}
print("[3/3] CAP knowledge (ODSP + All)…"); kn = run(q_know)[0]

odsp_tk = o["ToolCalls"] + kn["OdspKnowledge"]; all_tk = den[False]["ToolCalls"] + kn["AllKnowledge"]
def sh(a,b): return f"{100.0*a/b:.1f}%" if b else "-"
def row(n,a,b): print(f"  {n:<26} ODSP={a:>12,}  CS/All={b:>14,}  share={sh(a,b)}")
print("\n--- column ---")
row("Active Users", o["Users"], den[True]["Users"]); row("Active Tenants", o["Tenants"], den[True]["Tenants"])
row("Active Agents", o["Agents"], den[True]["Agents"]); row("Tasks", o["Tasks"], den[True]["Tasks"])
row("Tool Calls", o["ToolCalls"], den[False]["ToolCalls"]); row("Knowledge Sources", kn["OdspKnowledge"], kn["AllKnowledge"])
row("Tool Calls + Knowledge", odsp_tk, all_tk)
print(f"  {'Tool Success Rate':<26} ODSP service success = {o['SuccPct']}%")


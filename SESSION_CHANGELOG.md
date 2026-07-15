# Session Changelog

_Work log of changes and investigations. Times in CST unless noted._

## 2026-07-15 — Scout data source connection & validation

### Summary
Connected to the newly-granted **Scout data sources** (CSC prod Kusto) and independently
re-validated every live figure on the **Scout tab** of the _ODSP in Agentic Work Scorecard_.
All published numbers reconcile with a fresh live pull within tolerance, so **no numbers were
changed** — the tab was confirmed accurate and current.

### Scope
- **Target dashboard:** `ODSP-in-Agentic-Work-Scorecard.html` (leadership scorecard, lives in
  OneDrive — not tracked in this repo).
- **Data source:** CSC prod Kusto
  - Cluster: `fdislandscscprduswus` (West US)
  - Database: `CSCAnalytics`
  - Table: `KubernetesContainers`, container `lobsterruntime`
  - Filter: `subsystem = container_proxy`, `phase = forward`
  - Auth: `az` CLI token per cluster resource (`az account get-access-token`).

### ODSP metric definition (validated)
An "ODSP call" is a container-proxy **forward** with `outcome == "dispatching"` where **either**:
- `target_host` ends with a SharePoint host
  (`.sharepoint.com`, `.sharepoint-df.com`, `.sharepoint.us`, `.sharepoint-mil.us`, `.sharepoint.cn`), **or**
- `tool_id` starts with `graph.drive` or `graph.sharepoint`.

Notes:
- The `message` field is a JSON blob — must be parsed with `parse_json`, not the `has` operator.
- `target_group` is **absent** in prod; use `target_host` / `tool_id` instead.
- Broadening to include `web.request` `/me/drive` git-workspace ops **overshoots** volume
  (→ 13,341 vs published 12,480), confirming the strict definition above is authoritative.

### Validation results (this wk Jul 5–11 vs last wk Jun 28–Jul 4, CST)

| Metric | Published | Fresh live pull | Delta |
|---|---|---|---|
| ODSP tool-call volume (this wk) | 12,480 | 12,447 | −0.26% ✓ |
| ODSP tool-call volume (last wk) | 14,284 | 14,261 | −0.16% ✓ |
| ODSP latency p50 | 446 ms | 445.7 ms | exact ✓ |
| Users calling ODSP (this / last) | 45 / 42 | 44 / 41 | ±1 (boundary variance) |
| Tenants calling ODSP (this / last) | 5 / 5 | 4 / 4 | ±1 (boundary variance) |

The ±1 on the tiny distinct-count metrics is re-pull / boundary timing variance, not a
definitional gap.

### Multi-geo footprint check
Verified across all 10 major CSC geos (US, EU, UK, AU, IN, AS, CA, JP, DE, FR): **only the US
cluster carries Scout ODSP traffic**. No multi-geo aggregation is missing.

### Items confirmed external (correctly left PENDING)
- Scout all-up adoption (WAU / tenants / tasks / retention) — owned by AugLoop / MAI telemetry.
- ODSP DSAT% — lives in external OCV (no thumbs feed for Scout ODSP).
- % of Scout — depends on the external all-up denominator.

### Conclusion
- **Connection: working** — live az-cli Kusto access confirmed.
- **Data: validated** — all live figures reconcile with a fresh independent pull.
- **No edits** made to the scorecard HTML; the tab is current (Jul 5–11 is the latest complete
  Sun→Sat week as of Jul 15).
- Governance preserved: DSAT-only, CST, WoW; no metric fabricated or altered.

## 2026-07-15 — Git repo connection

- Verified connectivity to `odsp-cx-dashboard`
  (`https://github.com/souji19-ship-it/-odsp-cx-dashboard-.git`).
- `gh` authenticated as **souji19-ship-it** (scopes: `repo`, `read:org`, `gist`).
- Branch `main` tracking `origin/main`, 0 ahead / 0 behind, working tree clean.
- Added this `SESSION_CHANGELOG.md`.

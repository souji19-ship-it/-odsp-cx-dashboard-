# CP in SP scorecard dashboard scaffold

This is a first-pass SharePoint Agentic Health scorecard based on SG & AB
Sync notes, cross-checked against Luca's canvas/tool/root-cause framework.

## Files

- `dashboard-cp-in-sp-scorecard.html` — source dashboard with sidebar pages.
- `dashboard-cp-in-sp-scorecard-standalone.html` — one-file shareable version.
- `cp-in-sp-scorecard-data.json` — seed data used by the dashboard.

## Current scope

The scaffold implements the meeting hierarchy:

- **Executive Scorecard**: the weekly landing page for leadership.
- **Integration Inventory**: where SharePoint is integrated and who owns it.
- **Workloads View**: CoWork, Scout, MCS, Deepwork, Spark, ClawPilot, and
  Copilot in SharePoint.
- **Cross-Surface Comparison**: ranks surfaces by DSAT, tool success, growth,
  and WAU readiness.
- **Main Dimensions View**: customer satisfaction, reliability, adoption,
  performance, and business impact.
- **Tool Family View**: Search, File Retrieval, List Retrieval, Page Search,
  Knowledge Search, Save Content, and Create Content.
- **Benchmarking View**: same SharePoint capability across surfaces to
  diagnose tool vs canvas vs tool+canvas interaction.
- **Individual Surface Tabs**: CoWork, Scout, MCS, Spark, Deepwork, ClawPilot,
  and Copilot in SharePoint.
- **Action Center**: PM/EM next actions, owners, impact, and due date.

## Known gaps

- MCS and Scout require source-table/access confirmation.
- Tool usage, tool success rate, latency, and workflow completion require
  Augloop or canvas telemetry streams beyond OCV thumbs.
- CoWork-to-SharePoint attribution needs confirmation from Luca and/or the
  sentiment dashboard team.
- This is still a requirements/gaps dashboard until MCS, Scout, latency,
  workflow completion, and canvas telemetry sources are confirmed.

## Next build step

Replace the seed JSON with an automated Kusto/Augloop refresh script once the
canvas telemetry sources and access paths are confirmed.

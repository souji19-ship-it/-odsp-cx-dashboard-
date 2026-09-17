# SPARK Telemetry

- **SPARK Geneva:** `https://portal.microsoftgeneva.com/s/7609F13C` - canonical dashboard for DataSources, Perf, Usage, and related SPARK views

- **SPARK AugLoop Kusto:** `https://odxaugloop.eastus.kusto.windows.net` - database `ODX AugLoop Service`, table `WorkflowOperationEvent`, for production tool-call volume and latency analysis

- **SPARK Nezha KAv2:** dashboard `a82f4c8e-6f29-4402-8fa1-c0af49a5132d` - supplemental adoption, usage, tenant, retention, and entry-point telemetry

- **SPARK Customer Voice:** `https://ocvkustov2.westcentralus.kusto.windows.net` - database `OneCustomerVoice`, for DSAT and customer-feedback telemetry

## Source precedence

The Geneva dashboard is the current authoritative SPARK entry point, as confirmed by Aftab Hassan on September 16, 2026. Use AugLoop for custom raw-event analysis and retain Nezha KAv2 only for supplemental or historical adoption series.

The current AugLoop extraction filters:

- `workflow == "SharepointKnowledgeAgent"`
- `clientReleaseAudienceGroup == "Production"`
- `operationName == "ODSPAgentRuntime_tool_invoke"`
- tool name from `dimension0`
- latency from `durationMs`

The existing `AvgOutputKB > 0` result is an output-based success proxy, not a verified tool-success rate. Do not publish it as official success without an owner-confirmed outcome definition.

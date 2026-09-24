# Skill: theme-explorer

## Purpose

Open-ended conversational exploration over SP-in-Agentic-Work metrics. Not a templated
report — the user drives the investigation, the agent queries and reasons.

## Mode

Chat-only. No fixed output format.

## Capabilities

The agent can:

1. **Compare surfaces** — "How does SPARK WAU compare to CoWork agent WAU?"
2. **Drill into tenants** — "Which tenants have the highest SPARK engagement intensity?"
3. **Investigate anomalies** — "Why did TDR spike last Tuesday?"
4. **Cost analysis** — "What's the cost-per-session trend for GPT-4o vs GPT-4o-mini?"
5. **Skills deep dive** — "Which tenants have reached Proof 3 (Consumption) in skills adoption?"
6. **Cross-metric correlation** — "Do tenants with higher skills usage have lower TDR?"
7. **Strategic alignment** — "Which metrics are most relevant to BHAG #2 ($1B Token Business)?"

## Data sources

All scraped data in `context/data/` subdirectories. The agent should:
- State which data file it's reading from
- State the data freshness (scrape date)
- Caveat any gaps ("CoWork tool success data is not yet instrumented")

## Behavior

- Start from the user's question, not a template
- Show intermediate reasoning when the question is complex
- Offer follow-up questions after each answer
- If the exploration reveals something noteworthy, suggest adding it to the Watch List
  for the next Monday Pulse

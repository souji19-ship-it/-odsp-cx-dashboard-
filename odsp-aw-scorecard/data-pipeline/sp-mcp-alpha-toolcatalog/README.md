# SP MCP Alpha ToolCatalog

Frozen snapshot of the **SharePoint MCP (alpha)** tool catalog for ODSP-AW reporting.

| Field | Value |
| --- | --- |
| Source endpoint | `POST /_api/mcp/alpha/sharepoint` &middot; `tools/list` |
| Fetched on | 2026-08-14 |
| Total tools | 69 |
| Buckets | BotDoc: 6 &middot; SPARK: 61 &middot; Other: 2 |
| Bucket source of truth | SharePoint MCP Alpha tool list Loop, **8/12/2026 revision** |

## Buckets

- **BotDoc** (6) — document-content reading tools (`get_structured_text`, `get_document_pages`, `get_table_of_contents`, `semantic_search`, `get_document_images`, `getFileOrFolderMetadataByUrl`).
- **SPARK** (61) — the SharePoint agentic tool surface: lists/libraries CRUD, views/forms/formatting, approvals, rules/quicksteps, sharing/permissions, recycle bin/versions, taxonomy, OneDrive signals, file up/download, etc.
- **Other** (2) — DocGen form schema/submit (`get_sharepoint_form_schema`, `submit_sharepoint_form`).

> The **bucket** is reporting metadata only. It is **not visible to the agent** at runtime.

## Files

- `sp-mcp-alpha-toolcatalog.json` — machine-readable catalog: every tool with `name`, `bucket`, and full `description`.

## Provenance / update rule

This is a point-in-time capture. When a newer MCP `tools/list` or a newer Loop bucket revision is available, add a new dated snapshot rather than overwriting this one, and update the counts above.

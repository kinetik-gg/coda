# Coda reference for language models

Coda is a self-hosted workspace for Fountain-native screenplay writing and structured source breakdowns. Screenplays retain Fountain as their canonical source. Breakdowns organize source material into a configurable one-to-three-level hierarchy with typed custom fields, page-range references, comments, activity, roles, and recoverable deletion.

## Integration choices

- Use the versioned REST API for application integrations and automation.
- Use the stdio MCP server when an MCP client needs bounded tools for one breakdown.
- Do not connect an integration directly to Coda's Postgres database or object store.

Breakdown integrations use user-owned, breakdown-scoped bearer credentials. API keys use the default `api` audience. MCP tokens additionally send `X-Coda-Token-Audience: mcp`. A credential can access only its bound breakdown and permission subset. The v1 REST paths and payloads retain `projects` as a compatibility name; user-facing product language calls these records breakdowns.

## Canonical sources

- [External API guide](external-api.md)
- [OpenAPI 3.1 contract](openapi.json)
- [MCP setup and tools](mcp.md)
- [Architecture](architecture.md)
- [Security model](security.md)
- [Deployment and operations](operations.md)

## Important behaviors

- UUID strings are identity. Display codes, labels, prefixes, and names are editable presentation data.
- Timestamps are ISO 8601 UTC; date field values use `YYYY-MM-DD`.
- Item lists use cursor pagination. Treat cursors and fractional ranks as opaque.
- Mutations use integer record versions. Resolve `409 Conflict` by fetching current state before retrying.
- Custom field values are typed; do not send JSON blobs in place of a typed value.
- A breakdown can have one active PDF source document. Item references use inclusive page ranges validated against the stored page count.
- Binary upload and download use short-lived signed URLs. Do not log those URLs.
- Error responses use RFC 9457 problem details.

Do not infer domain-specific names such as scene, shot, issue, or panel. Read the breakdown's entity types and custom fields first.

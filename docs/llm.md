# Coda reference for language models

Coda is a self-hosted source breakdown workspace. It turns a PDF source document into structured project data organized by a configurable one-to-three-level hierarchy. Projects also contain typed custom fields, items, page-range source references, flat comments, activity, roles, and recoverable deletion.

## Integration choices

- Use the versioned REST API for application integrations and automation.
- Use the stdio MCP server when an MCP client needs bounded tools for one project.
- Do not connect an integration directly to Coda's Postgres database or object store.

Both external interfaces use user-owned, project-scoped bearer credentials. API keys use the default `api` audience. MCP tokens additionally send `X-Coda-Token-Audience: mcp`. A credential can access only its bound project and permission subset.

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
- A project can have one active PDF source document. Item references use inclusive page ranges validated against the stored page count.
- Binary upload and download use short-lived signed URLs. Do not log those URLs.
- Error responses use RFC 9457 problem details.

Do not infer domain-specific names such as scene, shot, issue, or panel. Read the project's entity types and custom fields first.

# Coda documentation

Coda is a self-hosted workspace for breaking source documents into structured, configurable project data. A project combines a one-to-three-level hierarchy, typed custom fields, source-page references, comments, activity, and recoverable deletion.

## Start here

- [External REST API](external-api.md) — authenticate and work with project data.
- [MCP server](mcp.md) — connect an MCP client to one Coda project.
- [Architecture](architecture.md) — understand the runtime and repository boundaries.
- [Security model](security.md) — credential, authorization, storage, and deployment controls.
- [Deployment and operations](operations.md) — deploy, back up, restore, and upgrade an instance.

The [OpenAPI 3.1 document](openapi.json) is generated from Coda's shared request contracts where possible. Run `pnpm openapi:check` to verify that it is current.

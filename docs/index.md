# Coda documentation

Coda is a self-hosted workspace for Fountain-native screenplay writing and structured source breakdowns. A breakdown combines a one-to-three-level hierarchy, typed custom fields, source-page references, comments, activity, and recoverable deletion.

## Start here

- [External REST API](external-api.md) — authenticate and work with breakdown data.
- [MCP server](mcp.md) — connect an MCP client to one Coda breakdown.
- [Architecture](architecture.md) — understand the runtime and repository boundaries.
- [Security model](security.md) — credential, authorization, storage, and deployment controls.
- [Deployment and operations](operations.md) — deploy, back up, restore, and upgrade an instance.
- [Deploy with Coolify](coolify.md) — a one-pass Coolify quickstart plus the full-stack and app-only reference.

The [OpenAPI 3.1 document](openapi.json) is generated from Coda's shared request contracts where possible. Run `pnpm openapi:check` to verify that it is current.

# Coda documentation

Coda is a self-hosted workspace for Fountain-native screenplay writing and structured source breakdowns. A breakdown combines a one-to-three-level hierarchy, typed custom fields, source-page references, comments, activity, and recoverable deletion.

## Deploy and operate

- [Deploy with Coolify](coolify.md) — start here for the one-click service templates, the canonical app-only topology, the standalone object-storage stack, and the all-in-one full-stack quickstart.
- [Deployment and operations](operations.md) — the full topology, environment contract, in-app backups, storage migration, the update checker and upgrade ceremony, the doctor page, and metrics.
- [Data compatibility](data-compatibility.md) — the standing policy for backup-format versions, database migrations, and config blobs.
- [Security model](security.md) — credential, authorization, storage, and deployment controls.
- [Architecture](architecture.md) — understand the runtime and repository boundaries.

## Build against Coda

- [External REST API](external-api.md) — authenticate and work with breakdown data.
- [MCP server](mcp.md) — connect an MCP client to one Coda breakdown.

The [OpenAPI 3.1 document](openapi.json) is generated from Coda's shared request contracts where possible. Run `pnpm openapi:check` to verify that it is current.

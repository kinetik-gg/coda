# Architecture

Coda is a TypeScript monorepo with a browser client, an application API, an MCP adapter, and shared validation contracts.

## Repository boundaries

| Package              | Responsibility                                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`           | React/Vite interface, workspace panels, local interaction state, and API queries.                                           |
| `apps/api`           | NestJS HTTP API, authorization, domain behavior, Prisma persistence, signed storage operations, and realtime invalidations. |
| `apps/mcp`           | Stdio MCP server that calls the public project-scoped REST API.                                                             |
| `packages/contracts` | Shared Zod request validation and TypeScript contract types.                                                                |
| `packages/fountain`  | Lossless Fountain parsing, contextual element classification, and source-preserving serialization.                          |

The production build compiles the web client into static assets served by the NestJS process. A standard deployment therefore runs one Coda application container alongside Postgres and an S3-compatible object store.

## Runtime data flow

1. The browser or an external client sends a request to `/api/v1`.
2. Middleware authenticates either an opaque database session or a project-scoped bearer credential.
3. Guards enforce route scope, CSRF rules for browser sessions, throttling, and project permissions.
4. A feature service applies domain invariants and writes through Prisma to Postgres.
5. File bytes travel directly between the client and private S3-compatible storage using short-lived signed URLs.
6. Successful mutations publish authorization-checked Socket.IO invalidations; clients refetch authoritative data.

Postgres is authoritative for identity, hierarchy, fields, values, ordering, permissions, metadata, activity, and deletion state. Object storage is authoritative only for binary bytes referenced by storage-object rows.

## Screenplay model

Screenplays are owner-scoped documents whose canonical content is Fountain source text in Postgres. The parser returns contextual screenplay elements and source ranges without normalizing the original text, so opening and exporting a document is lossless. Screenplay versions support optimistic autosave and return a conflict when another session has written a newer revision. Lists use bounded opaque cursor pagination ordered by update time and UUID, and owner document/source-byte quotas are checked in serializable transactions. Screenplay HTTP responses are private, non-cacheable, and vary on the session cookie.

Screenplays and breakdowns are separate product domains. The existing internal `Project` model continues to back breakdown configuration and permissions; it is no longer the umbrella user-facing name for all work in Coda.

## Project model

Each project has one to three ordered entity types. Every item belongs to one type and can point to a parent item in the immediately higher level. User-facing names, codes, and prefixes are presentation data; UUIDs are durable identity.

Manual item and field order is stored as fractional ranks scoped to the relevant sibling or entity-type collection. Items and mutable schema records carry integer versions for optimistic concurrency. Clients must refresh and reconcile after a `409 Conflict`.

Custom-field definitions specify a type and optional configuration. Values are stored in type-appropriate columns and relations rather than an unvalidated JSON value. Enum choices and file-backed values reference their own records.

## Source documents

A project may have one active PDF source document. Storage creation, byte upload, verification, and document attachment are separate steps. The API records the verified page count and validates item source references against it. Multiple ordered page ranges can reference the same item.

## Deletion and activity

Projects and project resources use recoverable deletion where supported. Permanent deletion is permission-gated and must not remove a storage object while another live reference exists. Project activity is append-only application data and stores bounded, public-safe metadata.

## API contracts

Controllers parse incoming bodies with Zod schemas from `packages/contracts`. The external OpenAPI generator converts those input schemas to OpenAPI 3.1-compatible JSON Schema and explicitly documents response records. This makes request drift detectable with `pnpm openapi:check` without claiming response generation that does not exist.

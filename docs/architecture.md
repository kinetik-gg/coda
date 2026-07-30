# Architecture

Coda is a TypeScript monorepo with a browser client, an application API, an MCP adapter, and shared
validation contracts. This document describes the system as it is built. Where a decision has a
recorded rationale, the ADR is linked rather than summarised twice.

## Repository boundaries

| Package                  | Responsibility                                                                                                             |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`               | React/Vite interface, workspace panels, local interaction state, the CodeMirror screenplay editor, and API queries.        |
| `apps/api`               | NestJS HTTP API, authorization, domain behavior, Prisma persistence, signed storage operations, and the Socket.IO gateway. |
| `apps/mcp`               | Stdio MCP server that calls the public project-scoped REST API.                                                            |
| `packages/contracts`     | Shared Zod request validation, TypeScript contract types, the permission vocabularies, and the resource-type registry.     |
| `packages/fountain`      | Lossless Fountain parsing, contextual element classification, and source-preserving serialization.                         |
| `packages/design-tokens` | Shared spacing, typography, and chrome tokens consumed by `apps/web`.                                                      |

The production build compiles the web client into static assets served by the NestJS process. A
standard deployment therefore runs one Coda application container alongside Postgres and an
S3-compatible object store.

## Runtime data flow

1. The browser or an external client sends a request to `/api/v1`.
2. Middleware authenticates either an opaque database session or a project-scoped bearer credential.
3. Guards enforce route scope, CSRF rules for browser sessions, throttling, and project permissions.
4. A feature service applies domain invariants and writes through Prisma to Postgres.
5. File bytes travel directly between the client and private S3-compatible storage using short-lived
   signed URLs.
6. Successful mutations publish authorization-checked Socket.IO invalidations; clients refetch
   authoritative data.

Postgres is authoritative for identity, hierarchy, fields, values, ordering, permissions, metadata,
activity, and deletion state. Object storage is authoritative only for binary bytes referenced by
storage-object rows.

The Socket.IO gateway (`apps/api/src/realtime/realtime.gateway.ts`) carries two independent
channels on one connection: `project:<id>` rooms for cache-invalidation fan-out, and
`screenplay:<id>` rooms for live collaborative editing. Both authenticate from the session cookie
during the connection handshake; the handshake promise is stashed on `socket.data` so message
handlers can await a settled authentication result rather than racing the lifecycle hook.

## Spaces: containment and the resource-type registry

Spaces are the user-visible containers above breakdown projects and screenplays. A resource is
placed in a Space by a row in `space_resources` keyed on `(resourceType, resourceId)`, not by a
column on the resource's own table (`apps/api/prisma/schema.prisma`, migration
`20260728000000_spaces`). The uniqueness constraint on that pair means a resource lives in exactly
one Space.

`resolveSpaceId` in `apps/api/src/spaces/space-resources.service.ts` falls back to the fixed
Default Space id when no mapping row exists, so a resource that has not yet been mapped is never
unreachable. `SpaceResourceReconciler` (`apps/api/src/boot/space-resource-reconciler.ts`) runs at
boot and repairs the mapping table in both directions: unmapped breakdowns and screenplays are
assigned to Default, and mapping rows whose core resource no longer exists are deleted. It only
touches the resource types it knows about, so an unknown future `resourceType` value is left alone.

The resource-type registry is the extension point. `packages/contracts/src/resource-types.ts`
declares the closed set (`breakdown`, `screenplay`) and, per type, what each Space tier grants.
`apps/api/src/spaces/space-resource-registry.ts` binds each type to the behaviour the Space layer
needs: how to list what a user can already reach directly, how to list every active resource, who
owns one, what its read permission is called, whether a given user may move it, and how to compute
the access delta of a move. Adding a resource type means adding one entry to each of those two
tables — it is not a core-table migration and not a `switch` spread across services.

Two invariants are enforced in code rather than by convention:

- `NEVER_GRANTED_BY_TIER` in `resource-types.ts` asserts at module load that no Space tier grants
  `delete_project`, `invite_members`, `manage_roles`, or `manage_member_roles`. A Space tier grants
  working access to a resource's contents; it never grants authority to destroy the resource,
  re-share it, or reassign its membership roles. Adding one of those to the tier table throws at
  import time instead of silently widening what a Space role can do.
- Tiers are cumulative increments (`viewer` ⊂ `contributor` ⊂ `manager`), so a tier's total grant is
  never hand-duplicated.

Spaces REST surface lives at `/api/v1/spaces` (`apps/api/src/spaces/spaces.controller.ts`) and
covers Space CRUD, roles, memberships, invitations, ownership transfer, and resource moves.

## The two access graphs and the additive rule

Coda carries **two coexisting access graphs** and joins them additively:

- **Per-resource** — `project_memberships` / `project_roles` for breakdowns, and the mirrored
  `screenplay_memberships` / `screenplay_roles` for screenplays. Each role carries an explicit
  permission set.
- **Per-Space** — `space_memberships` / `space_roles`. A Space role carries Space-level permissions
  (`read_space`, `manage_space_settings`, `invite_members`, `manage_member_roles`, `manage_roles`,
  `create_resources`, `move_resources`, `delete_space`) **and** a single `resource_tier` value.

The join rule is `resourceMember OR spaceMember`, implemented at exactly two choke points:
`PermissionService.membership` (`apps/api/src/projects/permission.service.ts`) and
`ScreenplayPermissionService.membership`
(`apps/api/src/screenplays/screenplay-permission.service.ts`). Both are structurally identical:

1. Look for a direct, non-archived resource membership. If found, that membership — and its
   explicit permission set — is authoritative and the Space is never consulted.
2. Otherwise resolve the resource's Space and the caller's active membership in it, then project
   the membership's `resource_tier` through the registry into a concrete permission list for that
   resource type. The synthesised membership is always returned with `isOwner: false`.
3. If neither path resolves, throw `404` — never `403`, which would confirm the resource exists.

The per-resource graph was deliberately **not** collapsed into Space roles. Doing so would be the
contract phase of an expand → migrate → contract change, and it cannot happen while the backup
import window still has to read the old representation ([ADR: Spaces](adr-spaces.md), "Deferred
contract step"). Keeping both graphs is compatibility work, not accidental duplication. The
practical benefit is that a resource can keep more specific collaborators while its Space supplies
a group-level baseline.

Listing follows the same additive shape. `SpaceResourcesService.listAccessibleResourceIds` unions
the ids the caller reaches directly with every resource mapped into a Space whose tier includes the
resource type's read permission, and — because Default is the fallback container — also folds in
active resources that have no mapping row yet when the caller can read Default.

Three things about the Spaces access model are load-bearing and must survive future changes:

- **The Spaces migration inserts zero `space_memberships` rows.** Installing Spaces grants nobody
  new access. This is a security invariant, not an unfinished backfill.
- **`spaces.owner_user_id` is settings authority, not an access grant.** It permits rename and
  ownership transfer; it does not put the owner in the access graph.
- **Membership in the Default Space is instance-wide access,** because every pre-Spaces resource is
  mapped there. It is a compatibility fallback, not a shared workspace. Moving resources into a
  purpose-built Space is the intended sharing path. Note that nothing in the product enforces or
  even flags this: the Members panel carries only the generic line "Every member receives their
  role's access to every resource in this Space"
  (`apps/web/src/spaces/SpaceSettingsSections.tsx`), and the `isDefault` guards exist only on
  deletion and ownership transfer — not on membership creation, role creation, or invitation.

API credentials are project-scoped and cannot yet be scoped to a Space or a screenplay. Every
Space and screenplay path therefore treats a request arriving on a credential as a non-member
(`SpacePermissionService.assertSession`, and the credential check at the top of
`ScreenplayPermissionService.membership`), so no credential can silently widen its reach.

## Moving resources between Spaces

A move (`apps/api/src/spaces/space-resource-moves.service.ts`) requires `move_resources` in both the
source and target Space **and** resource-level authority over the resource itself (owner role, or
`manage_project_settings` / `manage_screenplay_settings`). The Default Space is exempt from the
Space-permission half of that check, because it has no members by construction.

Because a move changes who can reach the resource through the Space graph, every move is preceded
by a preflight that reports `gainsAccess` and `losesAccess` — the users whose reach actually changes
once direct resource members (who are unaffected either way) are excluded. The same preflight is
recomputed inside the move transaction, so the reported delta is the delta that was committed. The
move itself is a single `updateMany` guarded on the source Space id; a resource sitting in Default
with no mapping row is materialised first and then moved.

Screenplay sharing, roles, invitations, and ownership transfer are described in
[ADR: Screenplay access control](adr-screenplay-access-control.md).

## Screenplay model

Screenplays are owner-scoped documents whose canonical content is Fountain source text in Postgres
(`Screenplay.sourceText`). The parser returns contextual screenplay elements and source ranges
without normalizing the original text, so opening and exporting a document is lossless.
`Screenplay.version` is an optimistic-concurrency counter: REST autosave returns a conflict when
another session has written a newer revision.

Two durable snapshot mechanisms sit beside the live document:

- **Revisions** (`screenplay_revisions`) capture the exact source, filename, and paper size for one
  `screenplayVersion`, unique per `(screenplayId, screenplayVersion)`. They are immutable and remain
  stable after later edits.
- **Export checkpoints** are explicit, serializable writes rather than autosave history, and export
  from a checkpoint is read-only and owner-isolated.

Lists use bounded opaque cursor pagination ordered by update time and UUID, and owner document and
source-byte quotas are checked in serializable transactions. Screenplay HTTP responses are private,
non-cacheable, and vary on the session cookie.

Screenplays and breakdowns are separate product domains. The internal `Project` model backs
breakdown configuration and permissions; it is no longer the umbrella user-facing name for all work
in Coda.

## Live collaboration: engine, transport, and projection

Live collaborative screenplay editing is implemented. The full rationale — including the measured
reason compaction re-encodes rather than merges — is in
[ADR: Collaboration engine and transport](adr-collaboration-engine-and-transport.md).

**Engine.** Yjs. Every writer binds `doc.getText('source')`
(`SCREENPLAY_COLLAB_TEXT_KEY` in `apps/api/src/screenplays/collab/screenplay-collab.constants.ts`).
The browser session (`apps/web/src/screenplays/screenplay-collaboration-session.ts`) owns one
`Y.Doc` per screenplay, shared by every mounted editor pane, plus a `Y.UndoManager` scoped to the
local document so undo is per-user, and an `IndexeddbPersistence` store so the document survives a
reload or an offline period. Reconnect replays whatever the server's state vector says it is
missing.

**Transport.** Socket.IO, not a bespoke WebSocket protocol
(`packages/contracts/src/screenplay-collab.ts` defines the wire envelope; Yjs bytes ride as opaque
binary attachments):

- `join-screenplay` — authorizes `read_screenplay`, joins the `screenplay:<id>` room, and returns
  the delta the client's state vector is missing plus the server state vector. A non-member and a
  trashed screenplay are both `404`.
- `screenplay-update` — publishes one coalesced update. Authorization reads the permission set
  cached on `socket.data` at join time rather than re-querying per keystroke; a read-only member
  gets `403` on the publish but keeps its subscription.
- `screenplay-awareness` — relays y-protocols awareness (cursors, selections, identity colour) to
  the rest of the room. Never persisted, never acknowledged.
- `screenplay-presence-drop` — on disconnect, tells the room which Yjs `clientId` went away, so
  another tab belonging to the same user is not evicted from the presence list.
- `flush-screenplay-collaboration` / `screenplay-collaboration-projected` — force and announce the
  projection described below.
- `screenplay-access-changed` — the eviction signal. `ScreenplayAccessService` and the screenplay
  trash service call `evictScreenplayMember` / `evictScreenplay`, which drop the socket's cached
  permission set, remove it from the room, and tell it to re-join. This is what makes the cached
  join-time grant safe.

**Storage.** Two appended tables. `screenplay_collab_updates` is an append-only log with a unique
`(screenplayId, seq)`; sequence numbers are allocated by reading the current tail inside a
serializable transaction and retrying on conflict, rather than a row lock (a row lock would trip
`pnpm quality:db-portability`). `screenplay_collab_checkpoints` holds at most one compacted Yjs
state per screenplay, valid `through_seq`, plus a `document_digest`.
`ScreenplayCollabLogService` is the only reader/writer of both tables, so the gateway and the
compaction job share one replay path.

**Bootstrap.** The first join for a screenplay seeds the Yjs document from its existing
`sourceText`, so a document authored before collaboration shipped is not blank to its first
collaborator. The seed is written under a synthetic `server-bootstrap` client id and is guarded by
the unique `(screenplayId, seq)` constraint, so concurrent first joins resolve to one seed.

**Projection.** The CRDT log is not the canonical read model. `ScreenplayCollabProjectionService`
debounces (700 ms) a replay of checkpoint + log back into `Screenplay.sourceText` and
`sourceByteLength` under a serializable transaction, enforcing the owner's source-byte quota and
bumping `version` **only when the text actually changed** — so a forced flush is idempotent and
cannot manufacture conflicts. Everything downstream — exports, previews, revisions, checkpoints,
and the external adapters — continues to read `sourceText`. A Save, navigation, or export that
needs an immediate canonical snapshot calls the flush event instead of waiting for the debounce.

**Compaction.** `ScreenplayCollabCompactionService` runs on the scheduler
(`screenplay-collab.job.ts`, key `collab.compaction`) under the same advisory lock as every other
job, so exactly one replica compacts. A screenplay is a candidate once its log crosses the
configured row or byte threshold. The fold replays checkpoint + log into a fresh `Y.Doc`, then
`Y.encodeStateAsUpdate` — never `Y.mergeUpdates` over the raw log, which preserves per-update item
boundaries and is orders of magnitude slower and larger. Before writing, the materialised text's
sha256 must equal the sha256 of `Screenplay.sourceText`; on a mismatch the fold is abandoned and
retried next tick, so a checkpoint can never disagree with the canonical projection. The checkpoint
write and the deletion of folded log rows share one transaction.

**Comments.** Screenplay comment threads are anchored to Yjs relative positions, not character
offsets: `apps/web/src/screenplays/screenplay-comment-anchors.ts` encodes a start and end
`Y.RelativePosition`, which the server stores as opaque `BYTEA` alongside up to 512 characters of
quoted text. An anchor that no longer resolves is reported as detached rather than silently
re-pointed. Threads are `OPEN` or `RESOLVED`; comment bodies are soft-deleted (the row survives with
a null body so thread shape is preserved), and a deleted author renders as "Former member" because
these tables carry no foreign key onto `users`.

Breakdown comments and the project activity feed are a separate, older subsystem
(`apps/api/src/collaboration/`) built on plain rows and realtime invalidation. Do not confuse the
two: nothing in `apps/api/src/collaboration/` participates in the CRDT path.

## The appended-table convention

**Every table added after a release carries no foreign key onto `users`, `projects`, or
`screenplays`, uses no shared enum type and no `citext`, and its migration is idempotent on
replay.** This is the single most important constraint on a new table, and it exists for one
concrete reason.

The in-app restore runs `pg_restore --clean --if-exists` (`apps/api/src/backup/backup-pg.ts`)
against a dump that may be an N-1 backup. `--clean` emits `DROP` statements only for objects
present in _that_ dump. An N-1 dump knows `screenplays`, `projects`, and `users`; it does not know
your new table. If your table holds a foreign key onto `screenplays`, then dropping
`screenplays_pkey` during the restore fails, because a constraint outside the dump still depends on
it — and the whole restore fails with it. The same argument applies to a shared enum type or the
`citext` type used by a core column: a dependent column in a table the dump has never heard of
blocks dropping the type.

The consequences a contributor must plan for:

- **Plain scalar columns instead of relations.** `screenplayId`, `userId`, `ownerUserId`,
  `resourceId`, `inviterId` are `@db.Uuid` columns with no Prisma `@relation`. Fetching the related
  core row is a second query, and rendering a deleted user is an application concern
  (`'Former member'`), not an FK cascade.
- **No referential integrity from the database.** `space_resources` cannot constrain
  `(resourceType, resourceId)` to a real row; that is why the boot reconciler exists.
- **Base types for status-like fields.** Space and screenplay invitation `status` is
  `VARCHAR(20)` with a `CHECK`, not the core `InvitationStatus` enum. Invitation `email` is `TEXT`,
  with lowercase normalisation moved into request validation because `citext` is unavailable.
- **Foreign keys _among_ the appended tables are fine and are kept.** The six Spaces tables
  reference each other via `space_id` / `role_id`; `screenplay_comments` cascades from
  `screenplay_comment_threads`. Only edges pointing at core tables are forbidden.
- **Migrations must be replay-safe.** `_prisma_migrations` is itself restored from the N-1 dump
  while your appended tables survive the restore, so the next boot replays your migration against
  populated tables. Use `CREATE TABLE IF NOT EXISTS`, `CREATE UNIQUE INDEX IF NOT EXISTS`, and
  `INSERT … ON CONFLICT DO NOTHING`, and use fixed UUIDs for seeded rows so replay is a no-op
  instead of a duplicate (the Default Space is `00000000-0000-4000-8000-000000000001`).
- **Additive only.** No change to a core table's shape can be relied upon, because an N-1 restore
  drops and recreates that table from the older dump. Breaking changes go through expand → migrate →
  contract, and the contract step waits until the import window no longer needs the old shape.

Nothing in `pnpm quality` currently rejects a foreign key onto a core table; the convention is
enforced by review, by the comments on each appended model in
`apps/api/prisma/schema.prisma`, and by the backup round-trip suites. Treat it as binding anyway —
a violation is not caught until an operator's restore fails.

The full policy for backup format versions, migration style, and config blobs is
[Data compatibility](data-compatibility.md).

## API contracts

Controllers parse incoming bodies with Zod schemas from `packages/contracts`. The external OpenAPI
generator converts those input schemas to OpenAPI 3.1-compatible JSON Schema and explicitly
documents response records. This makes request drift detectable with `pnpm openapi:check` without
claiming response generation that does not exist.

## Project model

Each project has one to three ordered entity types. Every item belongs to one type and can point to
a parent item in the immediately higher level. User-facing names, codes, and prefixes are
presentation data; UUIDs are durable identity.

Manual item and field order is stored as fractional ranks scoped to the relevant sibling or
entity-type collection. Items and mutable schema records carry integer versions for optimistic
concurrency. Clients must refresh and reconcile after a `409 Conflict`.

Custom-field definitions specify a type and optional configuration. Values are stored in
type-appropriate columns and relations rather than an unvalidated JSON value. Enum choices and
file-backed values reference their own records.

## Source documents

A project may have one active PDF source document. Storage creation, byte upload, verification, and
document attachment are separate steps. The API records the verified page count and validates item
source references against it. Multiple ordered page ranges can reference the same item.

## Deletion and activity

Projects and project resources use recoverable deletion where supported. Permanent deletion is
permission-gated and must not remove a storage object while another live reference exists. Project
activity is append-only application data and stores bounded, public-safe metadata.

## Architecture decision records

- [Spaces containers and additive access](adr-spaces.md)
- [Screenplay access control](adr-screenplay-access-control.md)
- [Collaboration engine and transport](adr-collaboration-engine-and-transport.md)
- [Data compatibility](data-compatibility.md)

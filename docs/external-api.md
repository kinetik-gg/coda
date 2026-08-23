# External REST API

Everything Coda ships lives under `/api/v1`. Only part of that surface is a supported integration
contract, and the supported part is split across two credentials that reach different things:

- A **project-scoped bearer credential** (an API key or an MCP token) reaches breakdown data inside
  exactly one project. Create one from **Profile → Developer**, choose only the required
  permissions, and copy the secret when it is shown. Coda stores only a hash and cannot display the
  secret again.
- A **signed-in browser session** reaches Spaces, screenplays, trackers, and screenplay
  collaboration. There is no bearer equivalent for those routes today; see [Credential scoping is
  project-only](#credential-scoping-is-project-only).

The machine-readable contract is in the repository at [`openapi.json`](openapi.json) and is served
by a running instance at `GET /api/v1/openapi.json` (unauthenticated). Every path in that document
is documented below. Routes that exist in the application but are deliberately outside the external
contract are listed in [Not part of the external
API](#not-part-of-the-external-api) — there is no third category.

## Authentication

### Bearer credentials

Send the API key as a bearer credential:

```sh
curl --fail-with-body \
  -H "Authorization: Bearer $CODA_API_KEY" \
  -H "Accept: application/json" \
  "$CODA_URL/api/v1/token/context"
```

`GET /api/v1/token/context` returns the single bound `projectId`, the credential `kind`
(`API_KEY` or `MCP_TOKEN`), and the granted `permissions`. An MCP token uses the same bearer scheme
and must additionally send `X-Coda-Token-Audience: mcp`; an API key uses the default `api`
audience. A bearer token presented with the wrong audience is rejected as invalid.

Bearer requests never require CSRF headers.

### Session requests

Space, screenplay, and screenplay-collaboration routes authenticate with the `coda_session` cookie.
Mutating session requests (anything other than `GET`, `HEAD`, `OPTIONS`) must also send the
`coda_csrf` cookie and an `X-Coda-CSRF` header with exactly the same value, or the request fails
with `403`.

### Rate limiting

The instance applies a default throttle of 120 requests per 60 seconds. Exceeding it returns `429`.

## What a bearer credential can reach

Bearer access is enforced by an explicit route allowlist, not by permissions alone. A bearer
credential may call only:

| Method   | Path                                                                     |
| -------- | ------------------------------------------------------------------------ |
| `GET`    | `/api/v1/token/context`                                                  |
| `GET`    | `/api/v1/openapi.json`                                                   |
| `POST`   | `/api/v1/uploads`                                                        |
| `GET`    | `/api/v1/projects/{projectId}`                                           |
| `PATCH`  | `/api/v1/projects/{projectId}`                                           |
| `POST`   | `/api/v1/projects/{projectId}/entity-types`                              |
| `PATCH`  | `/api/v1/projects/{projectId}/entity-types/{entityTypeId}`               |
| `DELETE` | `/api/v1/projects/{projectId}/entity-types/{entityTypeId}`               |
| `GET`    | `/api/v1/projects/{projectId}/entity-types/{entityTypeId}/fields`        |
| `GET`    | `/api/v1/projects/{projectId}/items`                                     |
| `POST`   | `/api/v1/projects/{projectId}/items`                                     |
| `PATCH`  | `/api/v1/projects/{projectId}/items/{itemId}`                            |
| `PATCH`  | `/api/v1/projects/{projectId}/items/{itemId}/reorder`                    |
| `POST`   | `/api/v1/projects/{projectId}/fields`                                    |
| `GET`    | `/api/v1/projects/{projectId}/fields/{fieldId}`                          |
| `PATCH`  | `/api/v1/projects/{projectId}/fields/{fieldId}`                          |
| `PATCH`  | `/api/v1/projects/{projectId}/fields/{fieldId}/reorder`                  |
| `PUT`    | `/api/v1/projects/{projectId}/items/{itemId}/fields/{fieldId}`           |
| `POST`   | `/api/v1/projects/{projectId}/uploads/{storageObjectId}/complete`        |
| `GET`    | `/api/v1/projects/{projectId}/storage-objects/{storageObjectId}/content` |
| `POST`   | `/api/v1/projects/{projectId}/source-documents`                          |
| `POST`   | `/api/v1/projects/{projectId}/items/{itemId}/source-references`          |
| `GET`    | `/api/v1/projects/{projectId}/items/{itemId}/comments`                   |
| `POST`   | `/api/v1/projects/{projectId}/items/{itemId}/comments`                   |
| `PATCH`  | `/api/v1/projects/{projectId}/comments/{commentId}`                      |
| `GET`    | `/api/v1/projects/{projectId}/activity`                                  |
| `GET`    | `/api/v1/projects/{projectId}/exports/levels/{entityTypeId}.csv`         |
| `GET`    | `/api/v1/projects/{projectId}/exports/project.json`                      |

`{projectId}` must be the credential's bound project. Supplying a different project ID returns
`404`. Calling any other `/api/v1` route with a bearer credential returns `403` even when the
credential holds a matching permission — including `GET /api/v1/projects`, every `/api/v1/spaces`
route, and every `/api/v1/screenplays` route.

Within the allowlist, each operation additionally requires the corresponding permission on the
credential; a missing permission returns `403`.

The project-detail response for a bearer credential uses an explicit external projection. It omits
project membership and role lists as well as internal object-store keys and deletion metadata, even
though the browser session view of the same project contains more.

## Credential scoping is project-only

**API keys and MCP tokens are scoped to one project and are treated as a non-member of every
Space.** This is a real, current limitation, not an oversight you can work around with permissions:

- The Space permission check short-circuits for any bearer credential. `GET /api/v1/spaces`,
  `GET /api/v1/spaces/{spaceId}`, and every other Space route are blocked before authorization
  runs, so a Space is never observable to a token.
- The additive Space route to a resource is skipped for bearer credentials. A credential reaches
  its project only through a **direct project membership** held by the credential's owning user. If
  that user can see the project solely because they are a member of the project's Space, the
  credential still gets `404`.
- Space-derived visibility is likewise excluded from list results computed for a bearer credential.

The reasoning is in [`adr-spaces.md`](adr-spaces.md): until a credential can be explicitly scoped
to a Space, treating one as a Space member would silently widen it beyond the single project it
represents. If an integration needs to reach a resource, give the credential's user a direct
membership on that resource.

## Access model: `resourceMember OR spaceMember`

For **session** callers, access to a breakdown project, a screenplay, or a tracker is granted when
the caller is a member of that resource **or** a member of the Space the resource sits in. The two
routes are additive; the Space route never removes a grant the resource-level membership already
gave.

A Space membership carries a **resource tier**, and the tier projects onto concrete resource
permissions. Tiers are cumulative:

| Tier          | Breakdown permissions added                                         | Screenplay permissions added | Tracker permissions added                          |
| ------------- | ------------------------------------------------------------------- | ---------------------------- | -------------------------------------------------- |
| `viewer`      | `read_project`, `comment`                                           | `read_screenplay`            | `read_tracker`, `comment_tracker`                  |
| `contributor` | `manage_items`, `manage_source_documents`, `manage_storage_objects` | `edit_screenplay`            | `edit_tracker_records`                             |
| `manager`     | `manage_entity_types`, `manage_fields`, `manage_project_settings`   | `manage_screenplay_settings` | `manage_tracker_fields`, `manage_tracker_settings` |

A Space tier never grants `delete_project`, `invite_members`, `manage_roles`, or
`manage_member_roles`. Deleting a resource, re-sharing it, and reassigning its own membership roles
stay resource-level, and a Space-derived membership is never treated as the resource owner.
`comment_tracker` exists only in this tier table — a tracker role can never hold it as a standalone
permission.

Every resource lives in exactly one Space. A resource with no explicit placement — including one
restored from an older backup before the startup reconciler runs — resolves to its owner's personal
**Default Space**. Every account owns one Default through an ordinary owner membership. Upgrading
re-homes resources from the retired global Default by `owner_user_id`, so the new owner memberships
do not grant access to another user's resources.

## Spaces

All Space routes require a browser session. Mutations also require CSRF. Bearer credentials receive
`404` (Space lookups) or `403` (route not on the bearer allowlist).

A non-member receives `404` for a Space so its existence is never observable; a member missing the
required permission receives `403`. Personal Defaults follow the same rule. Their owner has an
ordinary owner membership with a non-null `currentMembership.id`; there is no instance-administrator
exception or fixed runtime Default id. Bearer credentials receive `404` for every Space.

The Space permission vocabulary is `read_space`,
`manage_space_settings`, `invite_members`, `manage_member_roles`, `manage_roles`,
`create_resources`, `move_resources`, and `delete_space`. Creating a Space provisions four roles —
`owner`, `manager`, `contributor`, `viewer` — and makes the creator the owner.

| Method   | Path                                                                            | Required Space permission | Notes                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------- | ------------------------------------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/v1/spaces`                                                                | —                         | Spaces the caller is a member of, plus Spaces holding a resource the caller can read. Each entry carries `currentMembership` and `resourceCounts`. Every account's personal Default is present through its owner membership even before it holds a resource. A `currentMembership: null` entry is a container label only — `id`, `name`, `isDefault` — and withholds `description`, `ownerUserId`, and audit fields. |
| `POST`   | `/api/v1/spaces`                                                                | —                         | Body `{ name, description? }`. Creator becomes owner.                                                                                                                                                                                                                                                                                                                                                                |
| `GET`    | `/api/v1/spaces/{spaceId}`                                                      | `read_space`              | Adds `currentMembership` and `resourceCounts`.                                                                                                                                                                                                                                                                                                                                                                       |
| `PATCH`  | `/api/v1/spaces/{spaceId}`                                                      | `manage_space_settings`   | Body `{ name?, description?, version }`; at least one of `name`/`description`. Stale `version` → `409`.                                                                                                                                                                                                                                                                                                              |
| `DELETE` | `/api/v1/spaces/{spaceId}`                                                      | `delete_space`            | Soft delete. `409` if the Space is the Default Space or still holds any resource.                                                                                                                                                                                                                                                                                                                                    |
| `GET`    | `/api/v1/spaces/{spaceId}/management`                                           | `manage_space_settings`   | Roles, memberships with user details, pending invitations, resource count.                                                                                                                                                                                                                                                                                                                                           |
| `GET`    | `/api/v1/spaces/{spaceId}/available-users`                                      | `invite_members`          | Active users who are not already members.                                                                                                                                                                                                                                                                                                                                                                            |
| `POST`   | `/api/v1/spaces/{spaceId}/roles`                                                | `manage_roles`            | Body `{ name, description?, permissions[], resourceTier }`. `409` if it would grant a permission the caller does not hold.                                                                                                                                                                                                                                                                                           |
| `PATCH`  | `/api/v1/spaces/{spaceId}/roles/{roleId}`                                       | `manage_roles`            | Partial body plus `version`. `409` for the owner role or a stale version.                                                                                                                                                                                                                                                                                                                                            |
| `DELETE` | `/api/v1/spaces/{spaceId}/roles/{roleId}`                                       | `manage_roles`            | Archives the role. Body `{ version }`. `409` for the owner role or while members or pending invitations still reference it.                                                                                                                                                                                                                                                                                          |
| `POST`   | `/api/v1/spaces/{spaceId}/memberships`                                          | `invite_members`          | Body `{ userId, roleId }`. `409` if the user is already a member or the role grants more than the caller holds.                                                                                                                                                                                                                                                                                                      |
| `PATCH`  | `/api/v1/spaces/{spaceId}/memberships/{membershipId}`                           | `manage_member_roles`     | Body `{ roleId, version }`. `409` for the owner membership or a stale version.                                                                                                                                                                                                                                                                                                                                       |
| `DELETE` | `/api/v1/spaces/{spaceId}/memberships/{membershipId}`                           | `manage_member_roles`     | Body `{ version }`. `409` for the owner membership or your own membership.                                                                                                                                                                                                                                                                                                                                           |
| `POST`   | `/api/v1/spaces/{spaceId}/invitations`                                          | `invite_members`          | Body `{ email, roleId }`. Returns `{ id, expiresAt, invitationUrl }`; the URL embeds the single-use token.                                                                                                                                                                                                                                                                                                           |
| `DELETE` | `/api/v1/spaces/{spaceId}/invitations/{invitationId}`                           | `invite_members`          | Revokes a pending invitation; `404` if it is not pending.                                                                                                                                                                                                                                                                                                                                                            |
| `GET`    | `/api/v1/spaces/{spaceId}/resources/{resourceType}/{resourceId}/move-preflight` | `move_resources`          | `targetSpaceId` query parameter. Returns `{ gainsAccess, losesAccess }` user-ID lists.                                                                                                                                                                                                                                                                                                                               |
| `POST`   | `/api/v1/spaces/{spaceId}/resources/move`                                       | `move_resources`          | Body `{ resourceType, resourceId, targetSpaceId }`.                                                                                                                                                                                                                                                                                                                                                                  |
| `POST`   | `/api/v1/spaces/{spaceId}/transfer-ownership`                                   | owner only                | Body `{ newOwnerMembershipId, version }`. `409` for the Default Space or a non-owner caller.                                                                                                                                                                                                                                                                                                                         |

`resourceType` is `breakdown`, `screenplay`, or `tracker`.

Space, breakdown, and screenplay `invitationUrl` values all use the public invitation acceptance
flow. A new email can create an account; an existing account must sign in as the invited email.
After reading the link, the web client removes the token from browser history but retains it for
the tab session so reloads and account switching do not turn a valid link into an empty-token
lookup.

Only `/api/v1/spaces` and `/api/v1/spaces/{spaceId}` appear in `openapi.json`. The role, membership,
invitation, move, and ownership-transfer routes are documented here but are intentionally excluded
from the published OpenAPI document, which covers the credentialed and session-read integration
surface rather than the full Space administration console.

### Moving a resource between Spaces

A move requires `move_resources` on **both** the source and target Space, including personal
Defaults. The caller must also hold `manage_project_settings` (breakdown) or
`manage_screenplay_settings` (screenplay) on the resource itself, or own it. A move to the same
Space returns `409`.

Call `move-preflight` first. It returns the users who would gain and lose access, excluding direct
resource members, who are unaffected either way. `POST .../resources/move` returns that same
preflight result plus the moved `resourceType` and `resourceId`.

### Creating a resource in a Space

Five routes accept an optional `spaceId` in the request body to choose the Space a new breakdown,
screenplay, or tracker is created in: `POST /api/v1/projects`,
`POST /api/v1/projects/from-template`, `POST /api/v1/screenplays`,
`POST /api/v1/screenplays/import`, and `POST /api/v1/trackers`. Archive-shaped creation —
`POST /api/v1/projects/import` and a backup restore — takes no target and lands in the resource
owner's personal Default Space.

**Omitting `spaceId` targets the caller's personal Default.** The Default owner role includes
`create_resources`, and the request passes through the same permission check as an explicitly named
Space. A bearer credential is never a Space member and therefore cannot select a Space target.

Naming a Space requires `create_resources` on that Space. A non-member receives `404` and a member
whose role withholds the permission receives `403`, matching every other Space route. On success the
resource is created and placed in that Space in one transaction, so it appears immediately under
`?spaceId=<uuid>` rather than under the Default Space. A bearer credential that names a Space
receives `404`, because a credential is scoped to one project rather than to a Space.

## Filtering lists by Space

Three list endpoints accept an optional `spaceId` query parameter:

- `GET /api/v1/projects?spaceId=<uuid>` — breakdown projects.
- `GET /api/v1/screenplays?spaceId=<uuid>` — screenplays (also `cursor` and `limit`, 1–100,
  default 50).
- `GET /api/v1/trackers?spaceId=<uuid>` — trackers.

All three are session-authenticated; none is reachable with a bearer credential.

**Omitting `spaceId` preserves the additive list.** Without the parameter the endpoint returns every
resource the caller can reach by either route — direct membership or Space membership. With
`spaceId`, the same accessible set is then filtered to the resources placed in that Space; during
reconciliation, a resource with no explicit placement counts as being in its owner's personal
Default.

`spaceId` filters an already-computed accessible set. It never widens access, and it is not a way to
enumerate a Space you cannot otherwise read.

## Response format

JSON resources use a data envelope:

```json
{
  "data": {
    "id": "00000000-0000-4000-8000-000000000001"
  }
}
```

Cursor-paginated item and screenplay responses add `meta.nextCursor`. Pass a non-null cursor to the
next request without inspecting or modifying it.

Errors use `application/problem+json` and RFC 9457 problem-details fields:

```json
{
  "type": "https://coda.local/problems/409",
  "status": 409,
  "title": "CONFLICT",
  "detail": "The record changed; refresh and retry.",
  "instance": "/api/v1/projects/00000000-0000-4000-8000-000000000001/items/…",
  "requestId": "00000000-0000-4000-8000-000000000002"
}
```

`instance` is the request target with query values stripped. Request-validation failures use
`title: "Validation failed"` and add an `errors` object keyed by field path. Include the returned
`requestId` when reporting an operational problem.

Status codes used across the surface:

| Status | Meaning                                                                                                |
| ------ | ------------------------------------------------------------------------------------------------------ |
| `400`  | Invalid request, including schema validation failures.                                                 |
| `401`  | Missing or invalid session or bearer credential, including revoked, expired, or wrong-audience tokens. |
| `403`  | The credential lacks the permission, the route is off the bearer allowlist, or CSRF validation failed. |
| `404`  | The resource does not exist or is not visible to the caller — including any Space seen by a token.     |
| `409`  | Stale `version`, or a domain invariant would be violated.                                              |
| `413`  | Request body exceeds the configured transport limit.                                                   |
| `429`  | Rate limit exceeded.                                                                                   |
| `500`  | Unexpected server error.                                                                               |
| `503`  | Request parsing or a required dependency is temporarily unavailable.                                   |
| `507`  | The owner screenplay quota is exhausted.                                                               |

## Read the project schema

First read the project to discover its configured hierarchy levels and source document. Then list
the fields for each level.

```sh
curl --fail-with-body \
  -H "Authorization: Bearer $CODA_API_KEY" \
  "$CODA_URL/api/v1/projects/$PROJECT_ID"

curl --fail-with-body \
  -H "Authorization: Bearer $CODA_API_KEY" \
  "$CODA_URL/api/v1/projects/$PROJECT_ID/entity-types/$ENTITY_TYPE_ID/fields"
```

Do not infer meaning from a level number or field name. Projects define their own level labels and
typed fields.

## List and edit items

Item listing is cursor-paginated and requires an entity type:

```sh
curl --fail-with-body --get \
  -H "Authorization: Bearer $CODA_API_KEY" \
  --data-urlencode "entityTypeId=$ENTITY_TYPE_ID" \
  --data-urlencode "limit=100" \
  --data-urlencode "sort=manual" \
  "$CODA_URL/api/v1/projects/$PROJECT_ID/items"
```

`limit` is 1–250 (default 100), `sort` is one of `manual`, `title`, `code`, `created_at`,
`updated_at` (default `manual`), and `direction` is `asc` or `desc`. `parentId` filters by parent —
pass an empty value for root items and omit it to include all parents. `search` accepts up to 200
characters, and `filters` takes a URL-encoded JSON array of at most 20 typed field filters.

Create an item using identifiers returned by the project API:

```sh
curl --fail-with-body \
  -X POST \
  -H "Authorization: Bearer $CODA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"entityTypeId":"00000000-0000-4000-8000-000000000010","title":"Opening"}' \
  "$CODA_URL/api/v1/projects/$PROJECT_ID/items"
```

Updates, reordering, and field-value writes require the latest item or field `version`. On
`409 Conflict`, fetch the current record, reconcile the intended change, and retry with its new
version.

Typed field values use a discriminated `value` object. Clearing a value uses `null`:

```json
{
  "value": {
    "type": "boolean",
    "value": true
  },
  "itemVersion": 3
}
```

The OpenAPI document defines the accepted shapes for text, long text, integer, float, boolean,
date, enum, multi-enum, file, image, and video fields.

## Upload a source PDF

Uploads are direct to the instance's private S3-compatible store:

1. `POST /api/v1/uploads` with the project, filename, MIME type, byte size, and kind.
2. Upload the exact bytes to the returned short-lived `uploadUrl` with HTTP `PUT` and the declared
   content type.
3. `POST /api/v1/projects/{projectId}/uploads/{storageObjectId}/complete` using the returned object
   version.
4. For a source PDF, `POST /api/v1/projects/{projectId}/source-documents` to attach the ready
   object.

Source documents must be PDFs. A project has at most one active source document. Page-range
references are added to an item with
`POST /api/v1/projects/{projectId}/items/{itemId}/source-references` and are validated against the
source page count. `GET /api/v1/projects/{projectId}/storage-objects/{storageObjectId}/content`
returns a short-lived signed download URL.

When a source reference is pinned to a screenplay revision (see the session-only revision-pin
route below), `GET /api/v1/projects/{projectId}/items` and the single-item read carry three extra
fields on each `SourceReference`: `resolution` (`pinned`, `unavailable`, or `unpinned`), `pin` (the
pin's revision, range, and hash, or `null`), and `staleness` (`current` or `stale`, `null` unless
`resolution` is `pinned`). `staleness` is `stale` once the linked screenplay's mutable version has
advanced past the version the pin was cut from; it never changes the reference's resolved
`sourceDocumentId`, `startPage`, or `endPage`.

Signed upload and download URLs are temporary credentials. Do not log, persist, or share them.

## Breakdown comments, activity, and exports

- `GET /api/v1/projects/{projectId}/activity` returns up to 100 newest events. Use the last event
  ID as the `cursor` for the next page when the page is full.
- `GET`/`POST /api/v1/projects/{projectId}/items/{itemId}/comments` list and create item comments;
  `PATCH /api/v1/projects/{projectId}/comments/{commentId}` edits a comment authored by the
  credential's user.
- `GET /api/v1/projects/{projectId}/exports/levels/{entityTypeId}.csv` downloads one hierarchy
  level as CSV; `GET /api/v1/projects/{projectId}/exports/project.json` downloads the active
  project model. Binary files are not included in either export.

## Screenplays

Screenplay routes require a browser session and reject bearer credentials with `403`.

| Method  | Path                                                                            | Notes                                                                                                                                                  |
| ------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET`   | `/api/v1/screenplays`                                                           | Cursor-paginated. `cursor`, `limit` (1–100, default 50), `spaceId`. `meta.nextCursor`.                                                                 |
| `POST`  | `/api/v1/screenplays`                                                           | Creates a Fountain screenplay. Optional `spaceId` targets a Space and requires `create_resources` there. `507` when the owner quota is exhausted.      |
| `POST`  | `/api/v1/screenplays/import`                                                    | Imports `.fountain`, `.spmd`, or `.txt` source. The source text is preserved exactly. Optional `spaceId` behaves as on `POST /api/v1/screenplays`.     |
| `GET`   | `/api/v1/screenplays/{screenplayId}`                                            | Includes the canonical source text and `version`.                                                                                                      |
| `PATCH` | `/api/v1/screenplays/{screenplayId}`                                            | Optimistic concurrency on `version`.                                                                                                                   |
| `GET`   | `/api/v1/screenplays/{screenplayId}/export.fountain`                            | Exact current UTF-8 Fountain source as an attachment. Creates no checkpoint.                                                                           |
| `POST`  | `/api/v1/screenplays/{screenplayId}/checkpoints`                                | Snapshots the current source and paper size when the supplied version matches. Repeating the same screenplay/version pair returns the same checkpoint. |
| `GET`   | `/api/v1/screenplays/{screenplayId}/checkpoints/{checkpointId}/export.fountain` | Immutable snapshotted source as an attachment.                                                                                                         |

Screenplay sharing (`/management`, `/invitations`, `/available-users`, `/memberships`,
`/transfer-ownership`) mirrors the Space administration routes above but is scoped to a single
screenplay. It is session-only and outside the published OpenAPI document; see
[`adr-screenplay-access-control.md`](adr-screenplay-access-control.md).

## Trackers

A tracker is a flat record grid inside a Space: user-defined fields, records holding one value per
field, comments, and an activity feed. This release ships the tracker CRUD core — creation with
Space placement, listing, reading, renaming, and soft deletion — plus its field-definition and
record surfaces: typed fields with enum option collections, records with cursor pagination,
server-side search, typed filters, manual rank ordering, optimistic-version updates, bulk cell
writes, and bulk soft deletion. Restore belongs to the later trash surface.

Tracker routes require a browser session and reject bearer credentials: API keys and MCP tokens are
project-scoped, are never Space members, and cannot reach a tracker at all. A non-member receives
`404` so an inaccessible tracker is never observable; a member whose role or Space tier lacks the
required permission receives `403`. Reads need `read_tracker`; record and bulk writes need
`edit_tracker_records`; field-definition and option writes need `manage_tracker_fields`. Commenting
mirrors the breakdown comment rules: direct members holding `edit_tracker_records` (owner, admin,
editor) may comment while a direct viewer stays read-only, and Space-tier reach grants commenting
from the viewer tier up through the tier-table `comment_tracker` entry. Edits and deletions of a
comment are restricted to its author; deletion is a soft `deletedAt` stamp.

| Method  | Path                           | Notes                                                                                                                                                                                                                                                                                                                                |
| ------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET`   | `/api/v1/trackers`             | Trackers the caller can reach by direct membership or Space tier. Optional `spaceId` narrows to one Space. Ordered by `updatedAt`, newest first.                                                                                                                                                                                     |
| `POST`  | `/api/v1/trackers`             | Body `{ name, description?, spaceId? }`. Creates the tracker, provisions its `owner`/`admin`/`editor`/`viewer` role graph with an owner membership for the caller, and places it in the target Space (the caller's personal Default when `spaceId` is omitted) in one transaction. Naming a Space requires `create_resources` there. |
| `GET`   | `/api/v1/trackers/{trackerId}` | Adds `access.permissions`: the caller's effective permission set from their direct role or projected Space tier.                                                                                                                                                                                                                     |
| `PATCH` | `/api/v1/trackers/{trackerId}` | Body `{ name?, description?, version }`; requires `manage_tracker_settings`. Optimistic concurrency on `version`; stale `version` → `409`.                                                                                                                                                                                           |

### Tracker fields

Field definitions are ordered by opaque rank strings; `beforeId`/`afterId` name one adjacent gap on
create-less reorder routes. A field's `key` is unique per tracker and stays reserved while a
previous field with that key sits in trash (`409`). Updates carry an optimistic `version`; a stale
one answers `409` while a missing or trashed field answers `404`. Archiving soft-deletes the field.

| Method   | Path                                                               | Notes                                                                                                                                                                                                             |
| -------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/v1/trackers/{trackerId}/fields`                              | Active fields in manual order; each carries its active options in option order.                                                                                                                                   |
| `POST`   | `/api/v1/trackers/{trackerId}/fields`                              | Body `{ name, key, type, required?, configuration?, options? }`. Options are only valid on `enum`/`multi_enum` fields, with case-insensitively unique labels.                                                     |
| `GET`    | `/api/v1/trackers/{trackerId}/fields/{fieldId}`                    | One field with its active options.                                                                                                                                                                                |
| `PATCH`  | `/api/v1/trackers/{trackerId}/fields/{fieldId}`                    | Body `{ name?, key?, required?, configuration?, options?, version }`. Supplying `options` restates the whole collection: absent active ids are archived, known ids are updated in order, unknown ids are created. |
| `PATCH`  | `/api/v1/trackers/{trackerId}/fields/{fieldId}/reorder`            | Body `{ beforeId?, afterId?, version }`; exactly one adjacent gap may be named.                                                                                                                                   |
| `DELETE` | `/api/v1/trackers/{trackerId}/fields/{fieldId}`                    | Body `{ version }`. Soft-deletes the field into trash; requires `manage_tracker_fields` through a direct membership or Space tier.                                                                                |
| `POST`   | `/api/v1/trackers/{trackerId}/fields/{fieldId}/options`            | Appends one option to an `enum`/`multi_enum` field; duplicate labels (case-insensitive) → `409`.                                                                                                                  |
| `PATCH`  | `/api/v1/trackers/{trackerId}/fields/{fieldId}/options/{optionId}` | Relabels or recolors an active option. Archived options are invisible here (`404`).                                                                                                                               |
| `DELETE` | `/api/v1/trackers/{trackerId}/fields/{fieldId}/options/{optionId}` | Archives the option. Existing values keep referencing it; hard purges belong to the trash surface.                                                                                                                |

### Tracker records

Records are listed with keyset pagination (`meta.nextCursor`), searched with a case-insensitive
`contains` over `title`, filtered with up to 20 typed field filters delivered as a URL-encoded JSON
`filters` array over the shared operator set, and sorted by `manual` (rank), `title`, `created_at`,
or `updated_at` in either direction. Value writes are typed against the field definition:
single-select through a validated `optionId`, multi-select through a full-replace `optionIds`
array, scalar columns per type, and file/image/video through a `storageObjectId` that must already
reference a READY storage object owned by this tracker. Clearing a required field is refused.
Every mutating route guards the record's `version` (or `recordVersion`); stale versions answer
`409`, gone or trashed records answer `404`.

| Method  | Path                                                               | Notes                                                                                                                                                          |
| ------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`   | `/api/v1/trackers/{trackerId}/records`                             | Cursor-paginated with `cursor`, `limit` (1–250, default 100), `sort`, `direction`, `search`, `filters`. Each record carries its value cells.                   |
| `POST`  | `/api/v1/trackers/{trackerId}/records`                             | Body `{ title, beforeId?, afterId? }`; appends into manual order unless a gap is named.                                                                        |
| `GET`   | `/api/v1/trackers/{trackerId}/records/{recordId}`                  | One record with its value cells.                                                                                                                               |
| `PATCH` | `/api/v1/trackers/{trackerId}/records/{recordId}`                  | Body `{ title?, beforeId?, afterId?, version }`; renaming and moving share one optimistic guard.                                                               |
| `PATCH` | `/api/v1/trackers/{trackerId}/records/{recordId}/reorder`          | Body `{ beforeId?, afterId?, version }`; the dedicated move endpoint for manual sort.                                                                          |
| `PUT`   | `/api/v1/trackers/{trackerId}/records/{recordId}/fields/{fieldId}` | Body `{ value, recordVersion }` with `value: null` clearing the cell. Setting multi-enum replaces the whole selection; the record's version bumps once.        |
| `POST`  | `/api/v1/trackers/{trackerId}/records/bulk-set`                    | Body `{ updates: [{ recordId, fieldId, value }] }` (≤500, each pair once). Atomic; returns the updated records. Unknown record → `404`, foreign field → `400`. |
| `POST`  | `/api/v1/trackers/{trackerId}/records/bulk-delete`                 | Body `{ ids }` (1–250 unique). Soft-deletes live records into trash and reports `deletedIds` plus the shared `deletionBatchId`.                                |

### Tracker record comments

Comments are flat, history-free, and ordered oldest first, mirroring the breakdown item comments.
Listing is cursor-paginated (`meta.nextCursor`). A comment payload carries a plain `authorId` (no
embedded author object) plus an `editedAt` stamp that is set on the first edit. Commenting on a
missing or trashed record answers `404`; editing or deleting someone else's comment answers `403`,
and a stale edit `version` answers `409`.

| Method   | Path                                                                   | Notes                                                                                                                   |
| -------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/v1/trackers/{trackerId}/records/{recordId}/comments`             | Cursor-paginated with `cursor`, `limit` (1–250, default 100). Oldest first.                                             |
| `POST`   | `/api/v1/trackers/{trackerId}/records/{recordId}/comments`             | Body `{ body }` (1–10000 characters). Rejected with `404` when the record is missing or already in trash.               |
| `PATCH`  | `/api/v1/trackers/{trackerId}/records/{recordId}/comments/{commentId}` | Body `{ body, version }`; author-only. Optimistic concurrency on `version`; stale `version` → `409`. Stamps `editedAt`. |
| `DELETE` | `/api/v1/trackers/{trackerId}/records/{recordId}/comments/{commentId}` | Author-only soft delete; reports `{ id, deletedAt }`. There is no comment trash surface.                                |

### Tracker sharing

Tracker sharing mirrors the screenplay sharing surface, with one addition: custom roles are fully
editable. Every route is session-only and outside the published OpenAPI document; bearer
credentials cannot reach a tracker at all. The management payload requires `manage_tracker_settings`
and aggregates the tracker, its active custom roles (with member counts), memberships with user
details, pending email invitations, and the caller's own `currentMembership` permission set.
Invitations and member additions require `invite_members`, membership reassignment and removal
require `manage_member_roles`, and custom role CRUD requires `manage_roles` — the same authority
split as screenplays and Spaces. A member can never grant, by role assignment or invitation, a
permission they do not hold themselves; Space tiers never grant any of these sharing authorities.

| Method   | Path                                                      | Required tracker permission | Notes                                                                                                                                                                                                                                                                                      |
| -------- | --------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET`    | `/api/v1/trackers/{trackerId}/management`                 | `manage_tracker_settings`   | Roles, memberships with user details, pending invitations, and `currentMembership`.                                                                                                                                                                                                        |
| `GET`    | `/api/v1/trackers/{trackerId}/available-users`            | `invite_members`            | Active users who are not already members.                                                                                                                                                                                                                                                  |
| `POST`   | `/api/v1/trackers/{trackerId}/memberships`                | `invite_members`            | Body `{ userId, roleId }`. `409` if the user is already a member, the role grants more than the caller holds, or the role is the owner role.                                                                                                                                               |
| `PATCH`  | `/api/v1/trackers/{trackerId}/memberships/{membershipId}` | `manage_member_roles`       | Body `{ roleId, version }`. `409` for the owner membership or a stale version. Forces the member's sockets out of the tracker room.                                                                                                                                                        |
| `DELETE` | `/api/v1/trackers/{trackerId}/memberships/{membershipId}` | `manage_member_roles`       | Body `{ version }`. `409` for the owner membership or your own membership. Forces the member's sockets out of the tracker room.                                                                                                                                                            |
| `POST`   | `/api/v1/trackers/{trackerId}/roles`                      | `manage_roles`              | Body `{ name, description?, permissions[] }` over the tracker vocabulary. `409` if it would grant a permission the caller does not hold.                                                                                                                                                   |
| `PATCH`  | `/api/v1/trackers/{trackerId}/roles/{roleId}`             | `manage_roles`              | Partial body plus `version`. `409` for the owner role or a stale version; restating `permissions` replaces the whole set under the same subset rule and re-authorizes every holder's open sockets.                                                                                         |
| `DELETE` | `/api/v1/trackers/{trackerId}/roles/{roleId}`             | `manage_roles`              | Archives the role. Body `{ version }`. `409` for the owner role or while members or pending invitations still reference it.                                                                                                                                                                |
| `POST`   | `/api/v1/trackers/{trackerId}/invitations`                | `invite_members`            | Body `{ email, roleId }`. Returns `{ id, expiresAt, invitationUrl }`; the URL embeds the single-use token. Invitation links use the public acceptance flow (`POST /api/v1/auth/invitations/accept`).                                                                                       |
| `DELETE` | `/api/v1/trackers/{trackerId}/invitations/{invitationId}` | `invite_members`            | Revokes a pending invitation; `404` if it is not pending.                                                                                                                                                                                                                                  |
| `POST`   | `/api/v1/trackers/{trackerId}/transfer-ownership`         | owner only                  | Body `{ newOwnerMembershipId, version }`. Swaps the owner-role membership atomically — the previous owner is demoted to the lowest active role — guarded by the tracker `version`; both parties' sockets are forced to rejoin. The tracker's creator column never moves, like screenplays. |

The instance administrator console can also mint instance invitations that embed a tracker role;
redemption grants that tracker membership alongside the account. See the instance administration
routes in [Not part of the external API](#not-part-of-the-external-api).

### Tracker activity

- `GET /api/v1/trackers/{trackerId}/activity` returns up to 100 newest tracker events. Use the
  last event ID as the `cursor` for the next page when the page is full; the envelope mirrors the
  project activity feed (`data`, no `meta`). Reads need `read_tracker`. Each event names its
  `trackerId` and carries a null `projectId`; invitation events are redacted of email addresses
  exactly like the project feed.

Tracker deletion stays session-only and outside the external contract; see [Not part of the
external API](#not-part-of-the-external-api).

## Collaboration surface

**Externally reachable, in this document:** breakdown item comments and the breakdown activity
feed, both of which accept bearer credentials.

**Session-only REST, not in `openapi.json`:** range-anchored screenplay comment threads —
`GET`/`POST /api/v1/screenplays/{screenplayId}/comment-threads`,
`POST /api/v1/screenplays/{screenplayId}/comment-threads/{threadId}/comments`,
`PATCH /api/v1/screenplays/{screenplayId}/comment-threads/{threadId}/resolution`, and
`PATCH`/`DELETE /api/v1/screenplays/{screenplayId}/comments/{commentId}`.

**Not externally reachable at all:** live screenplay collaboration. Presence, CRDT updates, flush,
and cache invalidation run over a Socket.IO gateway that authenticates from the `coda_session`
cookie, rejects cross-origin connections, and has no bearer path. There is no supported way to
drive live collaboration from an API key or an MCP token, and the socket protocol is an internal
contract between the Coda web client and its own API — it is not versioned for third parties. Use
`PATCH /api/v1/screenplays/{screenplayId}` for programmatic edits. See
[`adr-collaboration-engine-and-transport.md`](adr-collaboration-engine-and-transport.md).

## Not part of the external API

These routes exist on a running instance and are deliberately excluded from both `openapi.json` and
the integration contract above. They are internal to the Coda web client and operator tooling, may
change without notice, and are unreachable with a bearer credential.

- **Setup and authentication** — `/api/v1/setup/*`, `/api/v1/auth/*`, `/api/v1/invitations/*`,
  `/api/v1/users/{userId}/reset-links`.
- **Account self-service** — `/api/v1/account`, `/api/v1/account/profile`,
  `/api/v1/account/preferences`, `/api/v1/account/password`, `/api/v1/account/sessions/*`,
  `/api/v1/account/2fa/*`, and `/api/v1/account/credentials/*` (the routes that mint the API keys
  and MCP tokens themselves).
- **Instance administration** — `/api/v1/instance/*`, covering access and management consoles,
  backups and scheduled backups, storage configuration and migration, and the doctor page.
- **Update and upgrade ceremony** — `/api/v1/updates/*`.
- **Health probes** — `/api/v1/health/live`, `/api/v1/health/ready`.
- **Signed blob proxy** — `/api/v1/blob/upload/{token}`, `/api/v1/blob/download/{token}`. These are
  reached only through the short-lived URLs returned by the upload and download routes.
- **Project lifecycle and sharing** — `POST /api/v1/projects`, `/api/v1/projects/from-template`,
  `/api/v1/projects/creation-options`, `/api/v1/projects/import`, and the project
  `/management`, `/roles`, `/memberships`, `/available-users`, `/invitations`, and
  `/transfer-ownership` routes.
- **Trash, restore, and purge** — `/api/v1/projects/trash`, every `/api/v1/projects/{projectId}`
  trash, restore, and purge route, `/api/v1/screenplays/trash`, and
  `DELETE`/`POST /api/v1/screenplays/{screenplayId}` trash, restore, and purge.
  For trackers, `DELETE /api/v1/trackers/{trackerId}` soft-deletes in place today (requires
  `manage_tracker_settings` held through a direct membership); the full trash, restore, and purge
  surface ships with the trackers trash work.
- **Saved layouts** — `/api/v1/projects/{projectId}/workspace-layout*` and
  `/api/v1/screenplays/{screenplayId}/panel-layout`.
- **Breakdown screenplay link** — `/api/v1/projects/{projectId}/screenplay-link`. Reading, setting,
  or clearing the one screenplay a breakdown follows requires access to the screenplay as well as
  the breakdown, and a project-scoped bearer credential can never reach a screenplay, so this route
  is signed-in-session only. It does not affect any PDF source reference.
- **Source-reference revision pin** —
  `/api/v1/projects/{projectId}/items/{itemId}/source-references/{referenceId}/revision-pin`.
  Reading, setting, or clearing the immutable `ScreenplayRevision` and UTF-16 source range one
  source reference is pinned to. Pinning requires `manage_items` on the breakdown plus
  `read_screenplay` on the screenplay the breakdown follows, so — like the link itself — it is
  unreachable with a project-scoped bearer credential and is signed-in-session only. A pin never
  changes the reference's `sourceDocumentId`, `startPage`, or `endPage`: clearing it, or losing its
  revision to a screenplay purge, returns the reference to plain PDF resolution.
- **Screenplay rebase preview** — `/api/v1/projects/{projectId}/screenplay-rebase-preview`. Reads
  back a reviewable plan describing how each pinned source range would re-anchor onto the
  screenplay's current text: the old and new excerpts, the compare engine's classification and its
  stated reason, and every candidate anchor where more than one is plausible. It is a `GET` and it
  performs no writes at all — no pin moves, no `ScreenplayRevision` is cut, no activity is recorded
  — so opening and closing a preview leaves the breakdown byte-identical. Producing a plan requires
  `manage_items` on the breakdown plus `read_screenplay` on the linked screenplay, which no
  project-scoped bearer credential can hold, so this route is signed-in-session only. Applying a
  plan is a separate, mutating route.
- **Screenplay rebase apply** — `/api/v1/projects/{projectId}/screenplay-rebase`. The mutating half
  of the flow above: it moves the breakdown's pins onto the screenplay's current text. The request
  names the reviewed plan by its `fingerprint` and carries one decision per reference that needs
  one; the plan itself is never sent back. The server rebuilds the plan from live rows inside a
  serializable transaction, refuses with `409` when the rebuilt fingerprint differs, cuts the target
  `ScreenplayRevision`, and moves every approved pin in that same transaction — so a concurrent
  screenplay, link, or pin change aborts the whole apply with no partial updates. Only ranges the
  compare engine marked auto-applicable — unchanged, or uniquely shifted with byte-identical text —
  move without a recorded decision; a materially changed, deleted, or ambiguous range needs an
  explicit target or an explicit "keep the current pin". Same permissions as the preview, so this
  route is signed-in-session only too.
- **Screenplay import artifacts** — `/api/v1/screenplays/{screenplayId}/import-artifacts*`, the
  reservation, conversion, completion, and original-blob read routes that let a conversion adapter
  retain the uploaded original alongside its immutable Fountain snapshot and per-element conversion
  report. They are an internal step of the web client's import pipeline, not a durable integration
  surface. The conversion route runs the retained original through the bounded adapter worker
  runtime on the server and completes the artifact from its output, so the Fountain snapshot and
  report are produced under the instance's own time, memory, and output ceilings rather than
  supplied by a caller. All of these routes are session-only: `credentialRouteAllowed` in
  `apps/api/src/auth/session.guard.ts` is a strict allowlist rooted at `/api/v1/projects/{projectId}`,
  so a project-scoped bearer credential cannot reach a screenplay-scoped path at all.
- **Tracker media uploads** — `POST /api/v1/trackers/{trackerId}/uploads`,
  `POST /api/v1/trackers/{trackerId}/uploads/{uploadId}/complete`, and
  `GET /api/v1/trackers/{trackerId}/storage-objects/{uploadId}/content`. The tracker-side mirror of
  the project upload flow: reserve an upload, PUT the bytes to the returned target (presigned or
  app-proxied per blob driver), then complete. Media kinds are file, image, and video; source
  documents remain a breakdown-project concept and are rejected for trackers. Session-only today:
  no API credential can reach a tracker until credential scoping ships.
- **Tracker sharing** — the tracker `/management`, `/memberships`, `/roles`,
  `/available-users`, `/invitations`, and `/transfer-ownership` routes, documented above in the
  Trackers section but session-only and excluded from `openapi.json` for the same reason as every
  other tracker route: no project-scoped bearer credential can reach a tracker path.
- **Space administration beyond CRUD**, **screenplay sharing and comment threads**, and
  **tracker sharing** — documented above, but excluded from `openapi.json`.

## Contract maintenance

Request-body schemas in `openapi.json` are generated from `packages/contracts`. Response schemas
document stable public fields and are maintained explicitly because runtime response serializers
are not yet shared contracts. The generated document records that distinction in
`x-coda-contract-generation`.

After changing an external controller or shared request contract, run:

```sh
pnpm openapi:generate
pnpm openapi:check
pnpm --filter @coda/api test
```

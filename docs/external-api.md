# External REST API

Everything Coda ships lives under `/api/v1`. Only part of that surface is a supported integration
contract, and the supported part is split across two credentials that reach different things:

- A **project-scoped bearer credential** (an API key or an MCP token) reaches breakdown data inside
  exactly one project. Create one from **Profile → Developer**, choose only the required
  permissions, and copy the secret when it is shown. Coda stores only a hash and cannot display the
  secret again.
- A **signed-in browser session** reaches Spaces, screenplays, and screenplay collaboration. There
  is no bearer equivalent for those routes today; see [Credential scoping is
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

For **session** callers, access to a breakdown project or a screenplay is granted when the caller
is a member of that resource **or** a member of the Space the resource sits in. The two routes are
additive; the Space route never removes a grant the resource-level membership already gave.

A Space membership carries a **resource tier**, and the tier projects onto concrete resource
permissions. Tiers are cumulative:

| Tier          | Breakdown permissions added                                         | Screenplay permissions added |
| ------------- | ------------------------------------------------------------------- | ---------------------------- |
| `viewer`      | `read_project`, `comment`                                           | `read_screenplay`            |
| `contributor` | `manage_items`, `manage_source_documents`, `manage_storage_objects` | `edit_screenplay`            |
| `manager`     | `manage_entity_types`, `manage_fields`, `manage_project_settings`   | `manage_screenplay_settings` |

A Space tier never grants `delete_project`, `invite_members`, `manage_roles`, or
`manage_member_roles`. Deleting a resource, re-sharing it, and reassigning its own membership roles
stay resource-level, and a Space-derived membership is never treated as the resource owner.

Every resource lives in exactly one Space. A resource with no explicit placement — including one
restored from an older backup before the startup reconciler runs — resolves to the instance-wide
**Default Space** (`00000000-0000-4000-8000-000000000001`). Adding a member to the Default Space
grants that person access to every resource on the instance at once. The upgrade that introduced
Spaces created the Default Space and its resource mappings but inserted **zero Space memberships**,
so an upgraded instance's access posture is unchanged until someone is added to a Space.

## Spaces

All Space routes require a browser session. Mutations also require CSRF. Bearer credentials receive
`404` (Space lookups) or `403` (route not on the bearer allowlist).

A non-member receives `404` for a Space so its existence is never observable; a member missing the
required permission receives `403`. The Space permission vocabulary is `read_space`,
`manage_space_settings`, `invite_members`, `manage_member_roles`, `manage_roles`,
`create_resources`, `move_resources`, and `delete_space`. Creating a Space provisions four roles —
`owner`, `manager`, `contributor`, `viewer` — and makes the creator the owner.

| Method   | Path                                                                            | Required Space permission | Notes                                                                                                                                                                                                        |
| -------- | ------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET`    | `/api/v1/spaces`                                                                | —                         | Spaces the caller is a member of, plus Spaces holding a resource the caller can read. Each entry carries `currentMembership` (null when the caller only reaches it through a resource) and `resourceCounts`. |
| `POST`   | `/api/v1/spaces`                                                                | —                         | Body `{ name, description? }`. Creator becomes owner.                                                                                                                                                        |
| `GET`    | `/api/v1/spaces/{spaceId}`                                                      | `read_space`              | Adds `currentMembership` and `resourceCounts`.                                                                                                                                                               |
| `PATCH`  | `/api/v1/spaces/{spaceId}`                                                      | `manage_space_settings`   | Body `{ name?, description?, version }`; at least one of `name`/`description`. Stale `version` → `409`.                                                                                                      |
| `DELETE` | `/api/v1/spaces/{spaceId}`                                                      | `delete_space`            | Soft delete. `409` if the Space is the Default Space or still holds any resource.                                                                                                                            |
| `GET`    | `/api/v1/spaces/{spaceId}/management`                                           | `manage_space_settings`   | Roles, memberships with user details, pending invitations, resource count.                                                                                                                                   |
| `GET`    | `/api/v1/spaces/{spaceId}/available-users`                                      | `invite_members`          | Active users who are not already members.                                                                                                                                                                    |
| `POST`   | `/api/v1/spaces/{spaceId}/roles`                                                | `manage_roles`            | Body `{ name, description?, permissions[], resourceTier }`. `409` if it would grant a permission the caller does not hold.                                                                                   |
| `PATCH`  | `/api/v1/spaces/{spaceId}/roles/{roleId}`                                       | `manage_roles`            | Partial body plus `version`. `409` for the owner role or a stale version.                                                                                                                                    |
| `DELETE` | `/api/v1/spaces/{spaceId}/roles/{roleId}`                                       | `manage_roles`            | Archives the role. Body `{ version }`. `409` for the owner role or while members or pending invitations still reference it.                                                                                  |
| `POST`   | `/api/v1/spaces/{spaceId}/memberships`                                          | `invite_members`          | Body `{ userId, roleId }`. `409` if the user is already a member or the role grants more than the caller holds.                                                                                              |
| `PATCH`  | `/api/v1/spaces/{spaceId}/memberships/{membershipId}`                           | `manage_member_roles`     | Body `{ roleId, version }`. `409` for the owner membership or a stale version.                                                                                                                               |
| `DELETE` | `/api/v1/spaces/{spaceId}/memberships/{membershipId}`                           | `manage_member_roles`     | Body `{ version }`. `409` for the owner membership or your own membership.                                                                                                                                   |
| `POST`   | `/api/v1/spaces/{spaceId}/invitations`                                          | `invite_members`          | Body `{ email, roleId }`. Returns `{ id, expiresAt, invitationUrl }`; the URL embeds the single-use token.                                                                                                   |
| `DELETE` | `/api/v1/spaces/{spaceId}/invitations/{invitationId}`                           | `invite_members`          | Revokes a pending invitation; `404` if it is not pending.                                                                                                                                                    |
| `GET`    | `/api/v1/spaces/{spaceId}/resources/{resourceType}/{resourceId}/move-preflight` | `move_resources`          | `targetSpaceId` query parameter. Returns `{ gainsAccess, losesAccess }` user-ID lists.                                                                                                                       |
| `POST`   | `/api/v1/spaces/{spaceId}/resources/move`                                       | `move_resources`          | Body `{ resourceType, resourceId, targetSpaceId }`.                                                                                                                                                          |
| `POST`   | `/api/v1/spaces/{spaceId}/transfer-ownership`                                   | owner only                | Body `{ newOwnerMembershipId, version }`. `409` for the Default Space or a non-owner caller.                                                                                                                 |

`resourceType` is `breakdown` or `screenplay`.

Only `/api/v1/spaces` and `/api/v1/spaces/{spaceId}` appear in `openapi.json`. The role, membership,
invitation, move, and ownership-transfer routes are documented here but are intentionally excluded
from the published OpenAPI document, which covers the credentialed and session-read integration
surface rather than the full Space administration console.

### Moving a resource between Spaces

A move requires `move_resources` on **both** the source and target Space — except for the Default
Space, which is exempt from that check because every resource starts there and it has no members by
default. The caller must also hold `manage_project_settings` (breakdown) or
`manage_screenplay_settings` (screenplay) on the resource itself, or own it. A move to the same
Space returns `409`.

Call `move-preflight` first. It returns the users who would gain and lose access, excluding direct
resource members, who are unaffected either way. `POST .../resources/move` returns that same
preflight result plus the moved `resourceType` and `resourceId`.

## Filtering lists by Space

Two list endpoints accept an optional `spaceId` query parameter:

- `GET /api/v1/projects?spaceId=<uuid>` — breakdown projects.
- `GET /api/v1/screenplays?spaceId=<uuid>` — screenplays (also `cursor` and `limit`, 1–100,
  default 50).

Both are session-authenticated; neither is reachable with a bearer credential.

**Omitting `spaceId` preserves prior behaviour.** Without the parameter the endpoint returns every
resource the caller can reach by either route — direct membership or Space membership. Because the
Spaces upgrade added no Space memberships, that set is identical to the pre-Spaces result until a
Space membership is created. With `spaceId`, the same accessible set is then filtered to the
resources placed in that Space; a resource with no explicit placement counts as being in the
Default Space.

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
| `POST`  | `/api/v1/screenplays`                                                           | Creates a Fountain screenplay. `507` when the owner quota is exhausted.                                                                                |
| `POST`  | `/api/v1/screenplays/import`                                                    | Imports `.fountain`, `.spmd`, or `.txt` source. The source text is preserved exactly.                                                                  |
| `GET`   | `/api/v1/screenplays/{screenplayId}`                                            | Includes the canonical source text and `version`.                                                                                                      |
| `PATCH` | `/api/v1/screenplays/{screenplayId}`                                            | Optimistic concurrency on `version`.                                                                                                                   |
| `GET`   | `/api/v1/screenplays/{screenplayId}/export.fountain`                            | Exact current UTF-8 Fountain source as an attachment. Creates no checkpoint.                                                                           |
| `POST`  | `/api/v1/screenplays/{screenplayId}/checkpoints`                                | Snapshots the current source and paper size when the supplied version matches. Repeating the same screenplay/version pair returns the same checkpoint. |
| `GET`   | `/api/v1/screenplays/{screenplayId}/checkpoints/{checkpointId}/export.fountain` | Immutable snapshotted source as an attachment.                                                                                                         |

Screenplay sharing (`/management`, `/invitations`, `/available-users`, `/memberships`,
`/transfer-ownership`) mirrors the Space administration routes above but is scoped to a single
screenplay. It is session-only and outside the published OpenAPI document; see
[`adr-screenplay-access-control.md`](adr-screenplay-access-control.md).

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
- **Saved layouts** — `/api/v1/projects/{projectId}/workspace-layout*` and
  `/api/v1/screenplays/{screenplayId}/panel-layout`.
- **Space administration beyond CRUD** and **screenplay sharing and comment threads** — documented
  above, but excluded from `openapi.json`.

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

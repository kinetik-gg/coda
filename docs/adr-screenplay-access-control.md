# ADR: Screenplay access control

Status: Accepted
Scope: `apps/api` — screenplay membership, roles, invitations, ownership transfer, and permission
enforcement.

## Context

Breakdown **projects** carry a complete project-scoped access-control graph:

- `Project.ownerUserId` names the owner of record.
- `ProjectRole` / `ProjectRolePermission` define named roles and the permission vocabulary they
  grant (`read_project`, `manage_items`, `invite_members`, `manage_roles`, …).
- `ProjectMembership` binds a user to a project through exactly one role.
- `ProjectInvitation` (and the reusable `InstanceInvitation`) carries an email + role to a not-yet
  member; acceptance materialises a membership.
- `PermissionService.assert(userId, projectId, permission)` is the single choke point. Non-members
  get `404` (tenant isolation — the resource must not be observable), members lacking a permission
  get `403`.
- Realtime invalidation is keyed on project membership (`join-project`, `project:<id>` rooms).
- API credentials are scoped to a single `projectId`.

**Screenplays** were shipped single-owner. Every `Screenplay` and `ScreenplayRevision` row carries
`ownerUserId`, and every read/write filters `where ownerUserId = <caller>`. There is no membership,
no role, no invitation, and no shared access of any kind. The product decision (epic: screenplay
parity) is that a screenplay ranks equal to a breakdown project: it can be shared with roles,
invited into, and transferred, with the same tenant-isolation semantics.

The collaboration epic (realtime co-editing) is the immediate downstream consumer: it needs a
membership set it can authorise a socket against, exactly as project realtime already does.

## Decision

Two options were on the table.

### Option A — generalise to a neutral resource scope

Introduce one polymorphic access graph (a `Resource`/`Workspace` row that both a project and a
screenplay point at, or a `(resourceType, resourceId)` discriminator on the membership/role/
invitation tables) so a single machinery serves every resource type. Projects migrate onto it via
expand–contract.

- **Upside.** One code path for permissions, invitations, realtime authorisation, and API-credential
  scoping. A third resource type later is nearly free. It is the "neutral internal workspace"
  direction the original platform epic sketched.
- **Downside.** It forces a live rewrite of the _existing, in-production_ project graph — the most
  heavily exercised authorization surface in the product — as a prerequisite for shipping
  screenplay parity. `PermissionService`, `projects.service`, the invitation-acceptance chain, the
  realtime gateway, and API-credential scoping would all change at once, and the project membership/
  role/invitation rows would have to be migrated under an expand–contract dance while the old and
  new shapes coexist. That is a large blast radius and a real regression risk for a keystone issue
  whose binding acceptance criterion is "sole-owner screenplays behave exactly as today" **and**
  whose implicit contract is "projects keep behaving exactly as today."

### Option B — parallel screenplay-scoped graph, shared vocabulary and mechanics (chosen)

Add screenplay-scoped tables that mirror the project ones — `ScreenplayRole`,
`ScreenplayRolePermission`, `ScreenplayMembership`, `ScreenplayInvitation` — and a
`ScreenplayPermissionService` that is the exact structural twin of `PermissionService`
(non-member → `404`, member-without-permission → `403`). The permission vocabulary and the
provisioning/transfer/invitation _mechanics_ are shared: the screenplay permission set is a
dedicated, deliberately small enum in `@coda/contracts`, and the service logic reuses the same
building blocks projects already use (`rankBetween`, the `DatabaseCapabilities` advisory-lock seam,
the optimistic-concurrency `version` idiom, the activity-free lean surface a document needs).

- **Upside.** Additive only. No migration of live project data. Sole-owner screenplays are provably
  untouched (owner keeps full authority via an owner-role membership that mirrors what projects
  already do at creation). Screenplay realtime co-editing builds on `ScreenplayMembership` exactly
  as project realtime builds on `ProjectMembership` — a proven, already-authorised pattern rather
  than a freshly generalised one. The change is reviewable resource-by-resource and each screenplay
  endpoint gains its guard independently.
- **Downside.** Two parallel table families and two permission services. The duplication is bounded
  (roles/permissions/memberships/invitations are small, stable shapes) and is the explicit cost we
  accept to keep the keystone low-risk.

**Chosen: Option B.** For the keystone of the parity epic, whose non-negotiable is that neither
sole-owner screenplays nor existing projects regress, the safe additive path wins. Option A is the
cleaner long-term architecture, but its value is amortised over _future_ resource types, whereas its
cost — a live rewrite of the product's busiest authorization surface — lands entirely on this issue.
Option B does not close the door on Option A: the shared permission vocabulary and the mirrored
service shape are precisely the seam that lets a future unification lift both graphs onto one
machinery as a deliberate refactor, not as a precondition for shipping screenplays.

## Screenplay permission vocabulary

A small, document-shaped set, named to stay consistent with the project vocabulary where the concept
is identical:

| Permission                   | Grants                                                        |
| ---------------------------- | ------------------------------------------------------------- |
| `read_screenplay`            | list / get / export the screenplay and its checkpoints        |
| `edit_screenplay`            | update source, title, paper size; create checkpoints          |
| `invite_members`             | issue invitations; add existing users as members              |
| `manage_member_roles`        | change or remove another member's role                        |
| `manage_roles`               | (reserved) customise roles — seeded roles ship; CRUD deferred |
| `manage_screenplay_settings` | open the management surface                                   |

Default seeded roles (mirroring the project owner/admin/editor/viewer shape):

- **owner** — `isOwner`, every permission. One per screenplay, enforced by a partial unique index.
- **admin** — every permission, not `isOwner`.
- **editor** — `read_screenplay`, `edit_screenplay`.
- **viewer** — `read_screenplay`.

Ownership has two facets that are the same user for a sole owner and only diverge after a transfer:

- **Storage-partition key** — `Screenplay.ownerUserId` (and `ScreenplayRevision.ownerUserId`). This
  is treated as **immutable**: the `screenplay_revisions` composite FK on `(screenplay_id,
owner_user_id)` cascades on update straight into a row-immutability trigger, so any attempt to move
  the column fails the moment a checkpoint exists. It stays with the creator and continues to drive
  the per-creator storage quota.
- **Access-ownership** — the user holding the `isOwner` screenplay-role membership. This is what the
  permission service resolves and what ownership transfer moves.

Ownership transfer therefore swaps the owner-role membership from the current owner to the target
and demotes the previous owner to the lowest active role (guarded by the screenplay's optimistic
`version`), without touching `ownerUserId`. For a sole owner both facets name the same account, so
nothing observable changes until the first transfer.

## Migration plan (expand–contract)

This change is **expand-only**; no project data moves and no screenplay column is dropped, so the
forward-only migration is safe to apply online.

1. **Expand (this change).**
   - Create `screenplay_roles`, `screenplay_role_permissions`, `screenplay_memberships`,
     `screenplay_invitations` (additive DDL, appended at the end of `schema.prisma` per house
     convention; back-relations added to `User` and `Screenplay`).
   - Backfill, for every existing screenplay, the four seeded roles + their permissions + an
     owner-role membership for `owner_user_id`. After the backfill every screenplay — including every
     pre-existing sole-owner one — is expressed uniformly through a membership, so the permission
     service has a single code path and sole owners retain exactly their prior authority.
   - New screenplays provision the same graph in the create/import transaction.
   - `Screenplay.ownerUserId` and `ScreenplayRevision.ownerUserId` are **retained** as the immutable
     storage-partition key (see above): a checkpoint written by a non-owner editor is attributed to
     the screenplay's `ownerUserId` so the existing `(screenplayId, ownerUserId)` composite FK, its
     row-immutability trigger, and the per-owner storage quota all continue to hold unchanged.
2. **Contract (not in this change, and not required).** Should a future ADR adopt Option A, the
   screenplay tables and the project tables both fold into the neutral graph; the `ownerUserId`
   columns can then be reduced to a derived owner membership. Nothing here blocks that.

## Deferred, with the path recorded

These are named in the parity proposal but are intentionally **not** implemented here, to keep the
keystone's blast radius contained. Each has a concrete path that this decision keeps open:

- **Realtime invalidation scoping.** Screenplays have no realtime surface today. The collaboration
  epic will add a `screenplay:<id>` room and a `join-screenplay` handshake authorised against
  `ScreenplayMembership` — the exact structure `RealtimeGateway` already uses for
  `ProjectMembership`. The membership set this change introduces is the prerequisite that unblocks
  it.
- **API credentials scoped to screenplays.** `ApiCredential` is currently non-null `projectId`.
  Scoping to screenplays means making it polymorphic (nullable `projectId` + nullable
  `screenplayId` under a one-of check) and teaching `authenticate()` / `RequestAuthContext` /
  `ScreenplayPermissionService` about the screenplay branch. Until then,
  `ScreenplayPermissionService` refuses any request that arrives on an API credential (treats it as
  a non-member → `404`), so no credential can silently reach a screenplay.
- **Custom role CRUD** for screenplays. The seeded roles cover the acceptance criteria; role
  creation/edit/archive can be added later reusing the extracted mechanics, exactly as projects do.

## Enforcement table

Every screenplay endpoint routes through `ScreenplayPermissionService` (non-member → `404`
tenant-isolation, member-without-permission → `403`):

| Endpoint                                                | Permission                   | Notes                                                                                                          |
| ------------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `GET /screenplays` (list)                               | membership                   | scoped to screenplays the caller is a member of                                                                |
| `GET /screenplays/:id`                                  | `read_screenplay`            |                                                                                                                |
| `GET /screenplays/:id/export.fountain`                  | `read_screenplay`            |                                                                                                                |
| `GET /screenplays/:id/checkpoints/:cid/export.fountain` | `read_screenplay`            |                                                                                                                |
| `PATCH /screenplays/:id`                                | `edit_screenplay`            |                                                                                                                |
| `POST /screenplays/:id/checkpoints`                     | `edit_screenplay`            | revision attributed to the storage-owner                                                                       |
| `GET /screenplays/:id/management`                       | `manage_screenplay_settings` |                                                                                                                |
| `POST /screenplays/:id/invitations`                     | `invite_members`             |                                                                                                                |
| `GET /screenplays/:id/available-users`                  | `invite_members`             |                                                                                                                |
| `POST /screenplays/:id/memberships`                     | `invite_members`             |                                                                                                                |
| `PATCH/DELETE /screenplays/:id/memberships/:mid`        | `manage_member_roles`        |                                                                                                                |
| `POST /screenplays/:id/transfer-ownership`              | owner-only                   | current owner-role membership                                                                                  |
| `GET/PUT /screenplays/:id/panel-layout` (#142)          | `read_screenplay`            | personal per-user UI state, keyed on the requesting user; any member who can read may read/write their OWN row |

**Trash lifecycle (#148).** Not present on `main` at time of writing (no screenplay soft-delete
column or `DELETE`/`restore`/`purge`/`trash` endpoints exist). When it lands it must route through
`ScreenplayPermissionService` at an owner/manage level so only the owner (or a
`manage_screenplay_settings` holder) may trash/restore/purge — non-member → `404`,
member-without-permission → `403` — without loosening the current owner-scoped semantics.

## Consequences

- Every screenplay endpoint is guarded by `ScreenplayPermissionService` (see the enforcement table).
  Tenant isolation is preserved: a non-member sees `404`, a member sees `403` when the role lacks the
  permission.
- A second user can be invited to a screenplay with a role and sees exactly what the role permits.
- Sole-owner screenplays behave exactly as before the change.
- The collaboration epic builds on `ScreenplayMembership` without any further schema change.

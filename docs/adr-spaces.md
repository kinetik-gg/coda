# ADR: Spaces containers and additive access

Status: Accepted
Scope: `apps/api` — Spaces, resource placement, memberships, and the Default Space upgrade path.

## Context

Spaces group breakdown projects and screenplays into user-visible containers. They need to work for
new resources while preserving both access and recoverability for every existing instance.

The backup importer is an important constraint. `PostgresDatabaseBackupEngine` restores a custom
Postgres dump with `pg_restore --clean --if-exists` (see `apps/api/src/backup/backup-pg.ts`). An
N-1 dump knows the core `projects` and `screenplays` tables, so that restore drops and recreates
those tables while the current application is still running. A new column on either core table is
therefore silently removed by an N-1 restore.

Spaces also sit alongside the existing resource-level sharing graphs. Existing project and
screenplay members must continue to have exactly the access they had before Spaces is installed.

## Decision

Spaces use an appended `space_resources` join table, additive access, and one personal Default
Space per user.

### Resource placement uses `space_resources`

`SpaceResource` stores `(resourceType, resourceId, spaceId, position)` rather than adding
`space_id` to `projects` or `screenplays`.

- An N-1 backup does not know the appended `space_resources` table, so its clean restore leaves
  that table standing. A resource restored without a mapping falls back to its owner's personal
  Default Space rather than failing because its newly added core-table column has disappeared.
- Adding a resource type later means registering another `resourceType` value; it does not require
  a migration that edits every resource table.
- The new Spaces tables have no foreign keys to `users`, `projects`, or `screenplays`. That avoids
  dependencies that would block an N-1 clean restore from replacing core tables. Foreign keys among
  the new Space tables remain safe.

This is deliberately not a free abstraction. `space_resources` cannot enforce referential
integrity to the polymorphic resource tables, and resolving a resource's Space is a two-step read
rather than a relation join. Those costs are accepted for backup compatibility and a registry-based
extension point.

### Access is additive

Access to a resource is granted when the caller is a member of that resource **or** a member of its
Space: `resourceMember OR spaceMember`. A Space role grants a bounded resource tier; it does not
replace the per-resource roles.

The correction migration creates one Default for every existing user, provisions the normal role
hierarchy and owner membership, and re-homes legacy global-Default mappings according to each
resource's `owner_user_id`. The owner membership does not widen upgrade access: it covers the same
resources the account already owns. New accounts receive that graph in the same transaction as the
account row.

### The Default Space is personal

A Default is tied to one account through `spaces.owner_user_id`. It behaves like an ordinary Space
for authorization, roles, invitations, resource creation, and moves. It differs in two lifecycle
rules: it cannot be deleted and its ownership cannot be transferred. Sharing a personal Default is
an explicit share of the resources currently placed there, not an instance-wide grant.

Every resource has an explicit `space_resources` mapping. During an N-1 restore window, a missing
mapping resolves from the resource owner to that owner's Default until the boot reconciler restores
the row. There is no global Default id in runtime authorization.

## Architecture and extension point

`@coda/contracts` owns the resource-type registry. Services use the registry to validate a
`resourceType`, resolve the corresponding resource, and apply the Space permission boundary. A new
resource type is therefore a registry and service integration, followed by a new
`SpaceResource.resourceType` value; it is not a core-table schema migration.

Resource-level authorization remains the authority for an existing share. The Space permission
check is an additional route to the same resource, and it supplies only the tier allowed by the
member's Space role. This lets a resource keep more specific collaborators while a Space provides
the group-level baseline.

## Deferred contract step

Spaces do not collapse project and screenplay role graphs into Space roles. Replacing those graphs
would be the **contract** phase of an expand → migrate → contract change: it cannot be considered
until the backup import window no longer needs the old representations. Keeping both graphs during
that window is deliberate compatibility work, not accidental duplication.

## Consequences

- Existing users receive personal Defaults and owner memberships without gaining access to another
  user's resources.
- Users can invite collaborators to a personal Default or create purpose-built Spaces for narrower
  sharing.
- New resource types have a stable placement extension point, at the cost of application-enforced
  polymorphic resource validity.
- A later authorization unification needs its own migration and ADR; it must not remove the
  per-resource graph opportunistically.

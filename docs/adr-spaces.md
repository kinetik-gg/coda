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

Spaces use an appended `space_resources` join table, additive access, and one instance-wide
Default Space.

### Resource placement uses `space_resources`

`SpaceResource` stores `(resourceType, resourceId, spaceId, position)` rather than adding
`space_id` to `projects` or `screenplays`.

- An N-1 backup does not know the appended `space_resources` table, so its clean restore leaves
  that table standing. A resource restored without a mapping falls back to the Default Space rather
  than failing because its newly added core-table column has disappeared.
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

The migration creates the Default Space, its roles, and mappings for pre-existing breakdowns and
screenplays, but it inserts **zero `space_memberships` rows**. This is a security invariant: an
upgrade changes neither who can see an existing resource nor what they can do with it. Removing
that zero-members backfill changes the access posture of every existing instance and must not be
treated as a data-cleanup opportunity.

`spaces.owner_user_id` is deliberately not an access grant. It is settings authority for actions
such as rename and ownership transfer, so creating the Default Space has no implicit member.

### The Default Space is instance-wide and high exposure

There is exactly one Default Space per instance. Every existing resource lands there, so adding a
member to it grants that person access to **every resource on the instance at once**. This is an
intentional compatibility fallback, not a general-purpose shared workspace.

The product mitigates that exposure in three complementary ways:

1. `spaces.owner_user_id` grants settings authority only, never access, so creating or transferring
   the Default Space owner cannot accidentally share the whole instance.
2. The Add Member flow displays the number of resources exposed and requires a typed confirmation
   above the configured threshold. The operator sees the blast radius before access changes.
3. Moving a resource to a Space is first-class. The intended shared workflow is to create a real
   Space and move selected resources into it, rather than adding members to Default.

Future contributors must preserve all three protections. The risk should be learned from this ADR,
not from an operator incident.

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

- Existing installations receive a Default Space and resource mappings without any new grants.
- Operators must treat membership in Default as instance-wide access and use dedicated Spaces for
  selective sharing.
- New resource types have a stable placement extension point, at the cost of application-enforced
  polymorphic resource validity.
- A later authorization unification needs its own migration and ADR; it must not remove the
  per-resource graph opportunistically.

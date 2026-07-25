-- Screenplay access control (ADR: docs/adr-screenplay-access-control.md).
-- Expand-only migration: a screenplay-scoped mirror of the project role/membership/invitation
-- graph, plus a backfill that gives every existing screenplay its seeded roles and an owner-role
-- membership. No project data moves and no screenplay column is dropped, so this applies online.
--
-- Backup/restore convention (matches user_two_factor, scheduled_job_status,
-- screenplay_panel_layouts, ...): these appended tables carry plain `screenplay_id`/`user_id`
-- columns with NO foreign keys onto the core `screenplays`/`users` tables. The in-app restore runs
-- `pg_restore --clean --if-exists`, whose DROP statements are scoped to objects present in the dump;
-- an N-1 backup predates these tables, so any FK from them onto a core table would block dropping a
-- core constraint (e.g. users_pkey / screenplays_pkey) during the round-trip. FKs strictly *among*
-- these four new tables are safe (an old dump lacks all of them together, so their constraints are
-- never dropped) and are kept for referential integrity + cascade cleanup.

CREATE TABLE "screenplay_roles" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "screenplay_id" UUID NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "description" VARCHAR(500),
  "is_owner" BOOLEAN NOT NULL DEFAULT false,
  "position" VARCHAR(64) NOT NULL,
  "archived_at" TIMESTAMPTZ(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  UNIQUE ("screenplay_id", "name")
);
CREATE UNIQUE INDEX "screenplay_roles_one_owner_idx" ON "screenplay_roles"("screenplay_id") WHERE "is_owner";
CREATE INDEX "screenplay_roles_screenplay_id_position_idx" ON "screenplay_roles"("screenplay_id", "position");

CREATE TABLE "screenplay_role_permissions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "role_id" UUID NOT NULL REFERENCES "screenplay_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "permission" VARCHAR(64) NOT NULL,
  UNIQUE ("role_id", "permission")
);

CREATE TABLE "screenplay_memberships" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "screenplay_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "role_id" UUID NOT NULL REFERENCES "screenplay_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("screenplay_id", "user_id")
);
CREATE INDEX "screenplay_memberships_user_id_idx" ON "screenplay_memberships"("user_id");

-- `email` and `status` use base types (TEXT / VARCHAR) rather than the shared `citext` extension
-- type or the `InvitationStatus` enum: those core types live in an N-1 dump, so a new table column
-- depending on them would block `pg_restore --clean` from dropping the type/extension during the
-- backup round-trip. Email is already normalised to lowercase by the request schema, so plain TEXT
-- preserves the case-insensitive match against the (citext) users.email column.
CREATE TABLE "screenplay_invitations" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "screenplay_id" UUID NOT NULL,
  "role_id" UUID NOT NULL REFERENCES "screenplay_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "email" TEXT NOT NULL,
  "token_hash" CHAR(64) NOT NULL UNIQUE,
  "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  "inviter_id" UUID NOT NULL,
  "accepted_by_id" UUID,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "accepted_at" TIMESTAMPTZ(3),
  "revoked_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "screenplay_invitations_screenplay_id_status_idx" ON "screenplay_invitations"("screenplay_id", "status");

-- Backfill the seeded roles for every existing screenplay. Positions match evenlySpacedRanks(4)
-- so app-side role creation appends after them (owner < admin < editor < viewer).
INSERT INTO "screenplay_roles" ("screenplay_id", "name", "is_owner", "position")
SELECT s."id", r."name", r."is_owner", r."position"
FROM "screenplays" s
CROSS JOIN (VALUES
  ('owner',  true,  '7777777777777777'),
  ('admin',  false, 'eeeeeeeeeeeeeeee'),
  ('editor', false, 'llllllllllllllll'),
  ('viewer', false, 'ssssssssssssssss')
) AS r("name", "is_owner", "position");

-- Backfill each seeded role's permissions.
INSERT INTO "screenplay_role_permissions" ("role_id", "permission")
SELECT sr."id", p."permission"
FROM "screenplay_roles" sr
CROSS JOIN LATERAL unnest(
  CASE
    WHEN sr."name" IN ('owner', 'admin') THEN ARRAY[
      'read_screenplay', 'edit_screenplay', 'invite_members',
      'manage_member_roles', 'manage_roles', 'manage_screenplay_settings'
    ]
    WHEN sr."name" = 'editor' THEN ARRAY['read_screenplay', 'edit_screenplay']
    ELSE ARRAY['read_screenplay']
  END
) AS p("permission");

-- Give every existing screenplay's owner an owner-role membership so the permission service has a
-- single membership-based code path and sole owners retain exactly their prior authority.
INSERT INTO "screenplay_memberships" ("screenplay_id", "user_id", "role_id")
SELECT s."id", s."owner_user_id", sr."id"
FROM "screenplays" s
JOIN "screenplay_roles" sr ON sr."screenplay_id" = s."id" AND sr."is_owner" = true;

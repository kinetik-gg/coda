-- Spaces foundation (issue #203).
-- Expand-only migration: the new graph sits above projects and screenplays without altering either
-- core table. The fixed Default Space receives every existing resource, including soft-deleted
-- rows, while deliberately receiving ZERO memberships so the upgrade grants no new access.
--
-- Backup/restore convention: these appended tables carry plain `owner_user_id`/`user_id`/
-- `resource_id`/`inviter_id` columns with NO foreign keys onto core `users`, `projects`, or
-- `screenplays`, and invitations use base TEXT/VARCHAR types rather than citext/shared enums. An
-- N-1 dump does not know these tables exist; keeping the graph self-contained lets
-- `pg_restore --clean --if-exists` drop every core constraint and type present in that older dump.
-- Foreign keys strictly among these six tables (via `space_id` and `role_id`) are safe and kept.
--
-- `_prisma_migrations` is restored from the N-1 dump while these new tables survive the restore.
-- The next boot therefore replays this file against populated tables: every create/index/insert is
-- explicitly conflict-safe, and the fixed identifiers make the replay a no-op.

CREATE TABLE IF NOT EXISTS "spaces" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" VARCHAR(160) NOT NULL,
  "description" TEXT,
  "owner_user_id" UUID,
  "is_default" BOOLEAN NOT NULL DEFAULT FALSE,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(3)
);
-- The owner-scoped shape is also safe before personal Defaults are backfilled: the legacy row is
-- the only Default at this point, and NULL owner ids do not collide. Using the final index shape
-- here keeps this expansion replayable after personal Defaults exist.
CREATE UNIQUE INDEX IF NOT EXISTS "spaces_one_default_per_owner"
  ON "spaces" ("owner_user_id") WHERE "is_default" AND "deleted_at" IS NULL;

CREATE TABLE IF NOT EXISTS "space_resources" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "space_id" UUID NOT NULL REFERENCES "spaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "resource_type" VARCHAR(32) NOT NULL,
  "resource_id" UUID NOT NULL,
  "position" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "space_resources_resource"
  ON "space_resources" ("resource_type", "resource_id");
CREATE INDEX IF NOT EXISTS "space_resources_space"
  ON "space_resources" ("space_id", "resource_type", "position");

CREATE TABLE IF NOT EXISTS "space_roles" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "space_id" UUID NOT NULL REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name" VARCHAR(80) NOT NULL,
  "description" VARCHAR(500),
  "is_owner" BOOLEAN NOT NULL DEFAULT FALSE,
  "position" VARCHAR(64) NOT NULL,
  "archived_at" TIMESTAMPTZ(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "resource_tier" VARCHAR(16) NOT NULL DEFAULT 'viewer'
);
CREATE UNIQUE INDEX IF NOT EXISTS "space_roles_space_name"
  ON "space_roles" ("space_id", "name");
CREATE UNIQUE INDEX IF NOT EXISTS "space_roles_one_owner"
  ON "space_roles" ("space_id") WHERE "is_owner";
CREATE INDEX IF NOT EXISTS "space_roles_space_position"
  ON "space_roles" ("space_id", "position");

CREATE TABLE IF NOT EXISTS "space_role_permissions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "role_id" UUID NOT NULL REFERENCES "space_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "permission" VARCHAR(64) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "space_role_permissions_role_permission"
  ON "space_role_permissions" ("role_id", "permission");

CREATE TABLE IF NOT EXISTS "space_memberships" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "space_id" UUID NOT NULL REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "user_id" UUID NOT NULL,
  "role_id" UUID NOT NULL REFERENCES "space_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "space_memberships_space_user"
  ON "space_memberships" ("space_id", "user_id");
CREATE INDEX IF NOT EXISTS "space_memberships_user"
  ON "space_memberships" ("user_id");

-- `email` and `status` use base types (TEXT / VARCHAR) rather than the shared `citext` extension
-- type or the `InvitationStatus` enum. Depending on either core type would prevent an N-1 restore
-- from dropping it. Request validation already normalises invitation email addresses to lowercase.
CREATE TABLE IF NOT EXISTS "space_invitations" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "space_id" UUID NOT NULL REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "role_id" UUID NOT NULL REFERENCES "space_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "email" TEXT NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  "inviter_id" UUID NOT NULL,
  "accepted_by_id" UUID,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "accepted_at" TIMESTAMPTZ(3),
  "revoked_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "space_invitations_token_hash"
  ON "space_invitations" ("token_hash");
CREATE INDEX IF NOT EXISTS "space_invitations_space_status"
  ON "space_invitations" ("space_id", "status");

-- Fixed id so replay after an N-1 restore cannot create a second Default Space.
INSERT INTO "spaces" ("id", "name", "description", "owner_user_id", "is_default")
SELECT
  '00000000-0000-4000-8000-000000000001'::uuid,
  'Default',
  'Everything that existed before Spaces.',
  (SELECT "owner_user_id" FROM "instance_settings" LIMIT 1),
  TRUE
ON CONFLICT DO NOTHING;

-- Stable ids and evenly-spaced positions keep role seeding deterministic. The owner and manager
-- project at manager tier, while contributor and viewer project at their corresponding tiers.
INSERT INTO "space_roles"
  ("id", "space_id", "name", "is_owner", "position", "resource_tier")
VALUES
  (
    '00000000-0000-4000-8000-000000000002'::uuid,
    '00000000-0000-4000-8000-000000000001'::uuid,
    'owner',
    TRUE,
    '7777777777777777',
    'manager'
  ),
  (
    '00000000-0000-4000-8000-000000000003'::uuid,
    '00000000-0000-4000-8000-000000000001'::uuid,
    'manager',
    FALSE,
    'eeeeeeeeeeeeeeee',
    'manager'
  ),
  (
    '00000000-0000-4000-8000-000000000004'::uuid,
    '00000000-0000-4000-8000-000000000001'::uuid,
    'contributor',
    FALSE,
    'llllllllllllllll',
    'contributor'
  ),
  (
    '00000000-0000-4000-8000-000000000005'::uuid,
    '00000000-0000-4000-8000-000000000001'::uuid,
    'viewer',
    FALSE,
    'ssssssssssssssss',
    'viewer'
  )
ON CONFLICT DO NOTHING;

-- Space permissions mirror the default role hierarchy. Resource permissions are projected later
-- through `resource_tier`; no per-resource administration permission is stored here.
INSERT INTO "space_role_permissions" ("role_id", "permission")
SELECT sr."id", p."permission"
FROM "space_roles" sr
CROSS JOIN LATERAL unnest(
  CASE
    WHEN sr."name" = 'owner' THEN ARRAY[
      'read_space', 'manage_space_settings', 'invite_members', 'manage_member_roles',
      'manage_roles', 'create_resources', 'move_resources', 'delete_space'
    ]
    WHEN sr."name" = 'manager' THEN ARRAY[
      'read_space', 'manage_space_settings', 'invite_members', 'manage_member_roles',
      'manage_roles', 'create_resources', 'move_resources'
    ]
    WHEN sr."name" = 'contributor' THEN ARRAY['read_space', 'create_resources']
    ELSE ARRAY['read_space']
  END
) AS p("permission")
WHERE sr."space_id" = '00000000-0000-4000-8000-000000000001'::uuid
  AND sr."name" IN ('owner', 'manager', 'contributor', 'viewer')
ON CONFLICT ("role_id", "permission") DO NOTHING;

-- Map every resource, including soft-deleted rows, so restoring from Trash always has a container.
INSERT INTO "space_resources" ("space_id", "resource_type", "resource_id", "position")
SELECT
  '00000000-0000-4000-8000-000000000001'::uuid,
  'breakdown',
  p."id",
  lpad((row_number() OVER (ORDER BY p."created_at", p."id"))::text, 8, '0')
FROM "projects" p
ON CONFLICT ("resource_type", "resource_id") DO NOTHING;

INSERT INTO "space_resources" ("space_id", "resource_type", "resource_id", "position")
SELECT
  '00000000-0000-4000-8000-000000000001'::uuid,
  'screenplay',
  s."id",
  lpad((row_number() OVER (ORDER BY s."created_at", s."id"))::text, 8, '0')
FROM "screenplays" s
ON CONFLICT ("resource_type", "resource_id") DO NOTHING;

-- Intentionally no INSERT into space_memberships. owner_user_id grants settings/rename authority
-- only; access remains additive and unchanged until a later explicit membership flow is used.

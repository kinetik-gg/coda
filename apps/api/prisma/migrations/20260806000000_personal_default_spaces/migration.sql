-- Correct the initial instance-wide Default Space model to one personal Default per user (#361).
--
-- This migration is replay-safe after an N-1 restore. Deterministic UUIDs make inserts stable,
-- while conflict handling preserves user edits made after the first application.

DROP INDEX IF EXISTS "spaces_single_default";
DROP INDEX IF EXISTS "spaces_one_default_per_owner";

-- Provision a personal Default for every account. The fixed legacy Default is deliberately not
-- considered a personal Default even when its owner_user_id happens to match the instance owner.
INSERT INTO "spaces" ("id", "name", "description", "owner_user_id", "is_default")
SELECT
  (
    substr(md5('personal-default-space:' || u."id"::text), 1, 8) || '-' ||
    substr(md5('personal-default-space:' || u."id"::text), 9, 4) || '-4' ||
    substr(md5('personal-default-space:' || u."id"::text), 14, 3) || '-8' ||
    substr(md5('personal-default-space:' || u."id"::text), 18, 3) || '-' ||
    substr(md5('personal-default-space:' || u."id"::text), 21, 12)
  )::uuid,
  'Default',
  'Your personal workspace.',
  u."id",
  TRUE
FROM "users" u
WHERE NOT EXISTS (
  SELECT 1
  FROM "spaces" s
  WHERE s."owner_user_id" = u."id"
    AND s."is_default"
    AND s."deleted_at" IS NULL
    AND s."id" <> '00000000-0000-4000-8000-000000000001'::uuid
)
ON CONFLICT DO NOTHING;

-- Seed the ordinary role hierarchy for every personal Default.
WITH personal_defaults AS (
  SELECT s."id"
  FROM "spaces" s
  WHERE s."is_default"
    AND s."deleted_at" IS NULL
    AND s."owner_user_id" IS NOT NULL
    AND s."id" <> '00000000-0000-4000-8000-000000000001'::uuid
), role_templates("name", "is_owner", "position", "resource_tier") AS (
  VALUES
    ('owner', TRUE, '7777777777777777', 'manager'),
    ('manager', FALSE, 'eeeeeeeeeeeeeeee', 'manager'),
    ('contributor', FALSE, 'llllllllllllllll', 'contributor'),
    ('viewer', FALSE, 'ssssssssssssssss', 'viewer')
)
INSERT INTO "space_roles"
  ("id", "space_id", "name", "is_owner", "position", "resource_tier")
SELECT
  (
    substr(md5('personal-default-role:' || d."id"::text || ':' || t."name"), 1, 8) || '-' ||
    substr(md5('personal-default-role:' || d."id"::text || ':' || t."name"), 9, 4) || '-4' ||
    substr(md5('personal-default-role:' || d."id"::text || ':' || t."name"), 14, 3) || '-8' ||
    substr(md5('personal-default-role:' || d."id"::text || ':' || t."name"), 18, 3) || '-' ||
    substr(md5('personal-default-role:' || d."id"::text || ':' || t."name"), 21, 12)
  )::uuid,
  d."id",
  t."name",
  t."is_owner",
  t."position",
  t."resource_tier"
FROM personal_defaults d
CROSS JOIN role_templates t
ON CONFLICT DO NOTHING;

INSERT INTO "space_role_permissions" ("role_id", "permission")
SELECT sr."id", p."permission"
FROM "space_roles" sr
JOIN "spaces" s ON s."id" = sr."space_id"
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
WHERE s."is_default"
  AND s."deleted_at" IS NULL
  AND s."owner_user_id" IS NOT NULL
  AND s."id" <> '00000000-0000-4000-8000-000000000001'::uuid
  AND sr."name" IN ('owner', 'manager', 'contributor', 'viewer')
ON CONFLICT ("role_id", "permission") DO NOTHING;

-- Each owner receives an ordinary membership, so Defaults use the same authorization path as any
-- other Space.
INSERT INTO "space_memberships" ("space_id", "user_id", "role_id")
SELECT s."id", s."owner_user_id", sr."id"
FROM "spaces" s
JOIN "space_roles" sr ON sr."space_id" = s."id" AND sr."is_owner"
WHERE s."is_default"
  AND s."deleted_at" IS NULL
  AND s."owner_user_id" IS NOT NULL
  AND s."id" <> '00000000-0000-4000-8000-000000000001'::uuid
ON CONFLICT ("space_id", "user_id") DO NOTHING;

-- Re-home resources that still point at the legacy global Default according to resource ownership.
UPDATE "space_resources" sr
SET "space_id" = personal."id"
FROM "projects" p
JOIN "spaces" personal
  ON personal."owner_user_id" = p."owner_user_id"
  AND personal."is_default"
  AND personal."deleted_at" IS NULL
  AND personal."id" <> '00000000-0000-4000-8000-000000000001'::uuid
WHERE sr."resource_type" = 'breakdown'
  AND sr."resource_id" = p."id"
  AND sr."space_id" = '00000000-0000-4000-8000-000000000001'::uuid;

UPDATE "space_resources" sr
SET "space_id" = personal."id"
FROM "screenplays" screenplay
JOIN "spaces" personal
  ON personal."owner_user_id" = screenplay."owner_user_id"
  AND personal."is_default"
  AND personal."deleted_at" IS NULL
  AND personal."id" <> '00000000-0000-4000-8000-000000000001'::uuid
WHERE sr."resource_type" = 'screenplay'
  AND sr."resource_id" = screenplay."id"
  AND sr."space_id" = '00000000-0000-4000-8000-000000000001'::uuid;

-- An N-1 restore can recreate core rows without their newer mapping rows. Fill those gaps now.
INSERT INTO "space_resources" ("space_id", "resource_type", "resource_id", "position")
SELECT
  personal."id",
  'breakdown',
  p."id",
  lpad((row_number() OVER (PARTITION BY personal."id" ORDER BY p."created_at", p."id"))::text, 8, '0')
FROM "projects" p
JOIN "spaces" personal
  ON personal."owner_user_id" = p."owner_user_id"
  AND personal."is_default"
  AND personal."deleted_at" IS NULL
  AND personal."id" <> '00000000-0000-4000-8000-000000000001'::uuid
ON CONFLICT ("resource_type", "resource_id") DO NOTHING;

INSERT INTO "space_resources" ("space_id", "resource_type", "resource_id", "position")
SELECT
  personal."id",
  'screenplay',
  screenplay."id",
  lpad((row_number() OVER (
    PARTITION BY personal."id" ORDER BY screenplay."created_at", screenplay."id"
  ))::text, 8, '0')
FROM "screenplays" screenplay
JOIN "spaces" personal
  ON personal."owner_user_id" = screenplay."owner_user_id"
  AND personal."is_default"
  AND personal."deleted_at" IS NULL
  AND personal."id" <> '00000000-0000-4000-8000-000000000001'::uuid
ON CONFLICT ("resource_type", "resource_id") DO NOTHING;

-- Preserve any access that was explicitly granted on the global Default. Copy its members to each
-- personal Default that inherited one of its resources, using the corresponding role name.
INSERT INTO "space_memberships" ("space_id", "user_id", "role_id")
SELECT DISTINCT destination."space_id", legacy_membership."user_id", destination_role."id"
FROM "space_memberships" legacy_membership
JOIN "space_roles" legacy_role ON legacy_role."id" = legacy_membership."role_id"
JOIN (SELECT DISTINCT "space_id" FROM "space_resources") destination ON TRUE
JOIN "spaces" destination_space
  ON destination_space."id" = destination."space_id"
  AND destination_space."is_default"
  AND destination_space."deleted_at" IS NULL
JOIN "space_roles" destination_role
  ON destination_role."space_id" = destination."space_id"
  AND destination_role."name" = legacy_role."name"
WHERE legacy_membership."space_id" = '00000000-0000-4000-8000-000000000001'::uuid
ON CONFLICT ("space_id", "user_id") DO NOTHING;

-- Pending global invitations now target the legacy owner's personal Default. Completed audit rows
-- remain untouched.
UPDATE "space_invitations" invitation
SET "space_id" = personal."id", "role_id" = personal_role."id"
FROM "spaces" legacy
JOIN "spaces" personal
  ON personal."owner_user_id" = legacy."owner_user_id"
  AND personal."is_default"
  AND personal."deleted_at" IS NULL
  AND personal."id" <> legacy."id"
JOIN "space_roles" legacy_role ON legacy_role."space_id" = legacy."id"
JOIN "space_roles" personal_role
  ON personal_role."space_id" = personal."id"
  AND personal_role."name" = legacy_role."name"
WHERE legacy."id" = '00000000-0000-4000-8000-000000000001'::uuid
  AND invitation."space_id" = legacy."id"
  AND invitation."role_id" = legacy_role."id"
  AND invitation."status" = 'PENDING'
  AND invitation."revoked_at" IS NULL;

-- Retain the legacy graph as soft-deleted audit history; it is no longer a Default or a container.
UPDATE "spaces"
SET "is_default" = FALSE,
    "deleted_at" = COALESCE("deleted_at", CURRENT_TIMESTAMP),
    "updated_at" = CURRENT_TIMESTAMP
WHERE "id" = '00000000-0000-4000-8000-000000000001'::uuid;

CREATE UNIQUE INDEX IF NOT EXISTS "spaces_one_default_per_owner"
  ON "spaces" ("owner_user_id")
  WHERE "is_default" AND "deleted_at" IS NULL;

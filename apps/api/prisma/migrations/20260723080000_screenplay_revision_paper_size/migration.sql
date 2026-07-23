ALTER TABLE "screenplay_revisions"
ADD COLUMN "paper_size" VARCHAR(16);

-- v0.0.2 has not shipped yet. This only upgrades the unreleased intermediate
-- screenplay-revision schema used by development builds. Those checkpoints can
-- only be backfilled from their owning screenplay's current persisted value.
-- All checkpoints created after this migration copy paper_size transactionally
-- with the Fountain source.
DROP TRIGGER "screenplay_revisions_immutable" ON "screenplay_revisions";

UPDATE "screenplay_revisions" AS revision
SET "paper_size" = screenplay."paper_size"
FROM "screenplays" AS screenplay
WHERE screenplay."id" = revision."screenplay_id"
  AND screenplay."owner_user_id" = revision."owner_user_id";

ALTER TABLE "screenplay_revisions"
ALTER COLUMN "paper_size" SET NOT NULL,
ADD CONSTRAINT "screenplay_revisions_paper_size_supported"
CHECK ("paper_size" IN ('letter', 'a4'));

CREATE TRIGGER screenplay_revisions_immutable
BEFORE UPDATE ON "screenplay_revisions"
FOR EACH ROW EXECUTE FUNCTION reject_screenplay_revision_update();

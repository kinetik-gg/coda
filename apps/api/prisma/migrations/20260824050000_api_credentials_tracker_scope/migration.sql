-- Tracker-scoped API credentials (epic #386, S12): a credential binds to EXACTLY ONE resource —
-- a project or a tracker (application-level XOR, enforced by the discriminated
-- `createApiCredentialSchema`). Mirrors `20260824000000_activity_events_project_nullable`: the
-- core-era table's `project_id` relaxes from NOT NULL to nullable while the foreign key itself
-- stays, so no dump/restore compatibility changes.
--
-- The new `tracker_id` column follows the `instance_invitation_tracker_assignment` precedent for
-- a core-adjacent table gaining a tracker edge: a nullable FK onto the appended `trackers` table
-- with CASCADE on the container. An N-1 dump predates the column entirely, so replay after a
-- restore starts from a table that has neither the column nor the constraint.
ALTER TABLE "api_credentials" ALTER COLUMN "project_id" DROP NOT NULL;

ALTER TABLE "api_credentials"
  ADD COLUMN "tracker_id" UUID,
  ADD CONSTRAINT "api_credentials_tracker_id_fkey"
    FOREIGN KEY ("tracker_id") REFERENCES "trackers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "api_credentials_tracker_id_revoked_at_expires_at_idx"
  ON "api_credentials"("tracker_id", "revoked_at", "expires_at");

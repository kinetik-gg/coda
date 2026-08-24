-- Instance invitations may embed one tracker membership grant, mirroring the project embed
-- (`20260722233000_instance_invitation_project_assignment`): nullable pair columns with CASCADE on
-- the container and RESTRICT on the role, a pair CHECK so an embed is always complete-or-absent,
-- and a lookup index for the management console. The service layer additionally refuses an
-- invitation that embeds both a project and a tracker at once; the SQL pair checks stay per-pair
-- so replaying either assignment migration alone stays valid.
ALTER TABLE "instance_invitations"
  ADD COLUMN "tracker_id" UUID,
  ADD COLUMN "tracker_role_id" UUID,
  ADD CONSTRAINT "instance_invitations_tracker_id_fkey"
    FOREIGN KEY ("tracker_id") REFERENCES "trackers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "instance_invitations_tracker_role_id_fkey"
    FOREIGN KEY ("tracker_role_id") REFERENCES "tracker_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "instance_invitations_tracker_role_pair_check"
    CHECK (("tracker_id" IS NULL AND "tracker_role_id" IS NULL) OR ("tracker_id" IS NOT NULL AND "tracker_role_id" IS NOT NULL));

CREATE INDEX "instance_invitations_tracker_id_status_idx"
  ON "instance_invitations"("tracker_id", "status");

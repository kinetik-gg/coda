ALTER TABLE "instance_invitations"
  ADD COLUMN "project_id" UUID,
  ADD COLUMN "role_id" UUID,
  ADD CONSTRAINT "instance_invitations_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "instance_invitations_role_id_fkey"
    FOREIGN KEY ("role_id") REFERENCES "project_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "instance_invitations_project_role_pair_check"
    CHECK (("project_id" IS NULL AND "role_id" IS NULL) OR ("project_id" IS NOT NULL AND "role_id" IS NOT NULL));

CREATE INDEX "instance_invitations_project_id_status_idx"
  ON "instance_invitations"("project_id", "status");

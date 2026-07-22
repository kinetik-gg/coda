ALTER TABLE "instance_invitations"
  ALTER COLUMN "email" DROP NOT NULL,
  ADD COLUMN "is_reusable" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "instance_invitation_redemptions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "invitation_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "email" CITEXT NOT NULL,
  "redeemed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "instance_invitation_redemptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "instance_invitation_redemptions_invitation_id_fkey"
    FOREIGN KEY ("invitation_id") REFERENCES "instance_invitations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "instance_invitation_redemptions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "instance_invitation_redemptions_invitation_id_user_id_key"
  ON "instance_invitation_redemptions"("invitation_id", "user_id");
CREATE UNIQUE INDEX "instance_invitation_redemptions_invitation_id_email_key"
  ON "instance_invitation_redemptions"("invitation_id", "email");
CREATE INDEX "instance_invitation_redemptions_invitation_id_redeemed_at_idx"
  ON "instance_invitation_redemptions"("invitation_id", "redeemed_at");

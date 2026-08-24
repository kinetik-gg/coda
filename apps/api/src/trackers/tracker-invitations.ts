import { ConflictException, NotFoundException } from '@nestjs/common';
import { createToken, hashToken } from '../common/crypto';
import type { DatabaseCapabilities } from '../database/database-capabilities';
import type { PrismaService } from '../prisma/prisma.service';
import type { TrackerActivityService } from './tracker-activity.service';
import { activeInvitationTrackerRole } from './tracker-role-lifecycle';

interface TrackerInvitationActor {
  userId: string;
  permissions: Array<{ permission: string }>;
}

/**
 * Issues a tracker email invitation: the raw token exists only in the returned URL — the row
 * persists its SHA-256 hash with a seven-day expiry, exactly like the screenplay twin.
 */
export async function issueTrackerInvitation(
  deps: {
    prisma: PrismaService;
    db: DatabaseCapabilities;
    activity: TrackerActivityService;
  },
  trackerId: string,
  roleId: string,
  email: string,
  actor: TrackerInvitationActor,
) {
  const token = createToken();
  return deps.prisma.$transaction(async (tx) => {
    const role = await activeInvitationTrackerRole(deps.db, tx, trackerId, roleId);
    if (!role) throw new NotFoundException('Role not found');
    assertGrantableInvitationRole(actor.permissions, role.permissions);
    const invitation = await tx.trackerInvitation.create({
      data: {
        trackerId,
        roleId,
        email,
        tokenHash: hashToken(token),
        inviterId: actor.userId,
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
      },
    });
    await deps.activity.invitationCreated(trackerId, actor.userId, invitation.id, { roleId }, tx);
    return { invitation, token };
  });
}

function assertGrantableInvitationRole(
  actorPermissions: Array<{ permission: string }>,
  rolePermissions: Array<{ permission: string }>,
): void {
  const available = new Set(actorPermissions.map((entry) => entry.permission));
  if (rolePermissions.some((entry) => !available.has(entry.permission))) {
    throw new ConflictException('Cannot grant permissions you do not hold');
  }
}

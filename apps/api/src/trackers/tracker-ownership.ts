import { ConflictException } from '@nestjs/common';
import type { DatabaseCapabilities } from '../database/database-capabilities';
import type { PrismaService } from '../prisma/prisma.service';
import { lockTrackerRoleLifecycle } from './tracker-role-lifecycle';

interface OwnershipTransferInput {
  userId: string;
  trackerId: string;
  membershipId: string;
  actorMembershipId: string;
  version: number;
}

/**
 * Transfers access-ownership of a tracker by moving the owner-role membership from the current
 * owner to a target member and demoting the previous owner to the lowest active role.
 *
 * Exactly like the screenplay ceremony, this deliberately does NOT move `Tracker.ownerUserId`:
 * access-ownership is defined by the `isOwner` role membership (the creator keeps an immutable
 * provenance column), so the optimistic-concurrency claim bumps only `version`. The previous
 * owner is demoted before the target is promoted, so the owner role is never held twice.
 */
export async function transferTrackerOwnership(
  db: DatabaseCapabilities,
  prisma: PrismaService,
  input: OwnershipTransferInput,
) {
  return prisma.$transaction(async (tx) => {
    const tracker = await tx.tracker.findFirst({
      where: { id: input.trackerId, version: input.version },
    });
    const target = await tx.trackerMembership.findFirst({
      where: { id: input.membershipId, trackerId: input.trackerId },
    });
    if (!tracker || !target) throw new ConflictException('Tracker or membership changed');
    // Memberships carry a plain userId (no relation onto User), so fetch the target's status.
    const targetUser = await tx.user.findUnique({
      where: { id: target.userId },
      select: { status: true },
    });
    if (targetUser?.status !== 'ACTIVE') {
      throw new ConflictException('Ownership can only be transferred to an active account');
    }
    if (target.id === input.actorMembershipId) {
      throw new ConflictException('Select another member for ownership transfer');
    }
    const ownerRole = await tx.trackerRole.findFirstOrThrow({
      where: { trackerId: input.trackerId, isOwner: true },
    });
    const demotionCandidate = await tx.trackerRole.findFirst({
      where: { trackerId: input.trackerId, isOwner: false, archivedAt: null },
      orderBy: { position: 'asc' },
      select: { id: true },
    });
    if (!demotionCandidate) {
      throw new ConflictException('No active role is available for the previous owner');
    }
    await lockTrackerRoleLifecycle(db, tx, demotionCandidate.id);
    const demotionRole = await tx.trackerRole.findFirstOrThrow({
      where: {
        id: demotionCandidate.id,
        trackerId: input.trackerId,
        isOwner: false,
        archivedAt: null,
      },
    });
    // Optimistic-concurrency claim without touching owner_user_id (see the doc comment above).
    const claimed = await tx.tracker.updateMany({
      where: { id: input.trackerId, version: input.version },
      data: { version: { increment: 1 } },
    });
    if (claimed.count !== 1) {
      throw new ConflictException('Tracker ownership has changed; refresh and retry');
    }
    // Demote the previous owner first so the owner role is never held by two memberships at once.
    await tx.trackerMembership.update({
      where: { id: input.actorMembershipId },
      data: { roleId: demotionRole.id, version: { increment: 1 } },
    });
    await tx.trackerMembership.update({
      where: { id: target.id },
      data: { roleId: ownerRole.id, version: { increment: 1 } },
    });
    return tx.tracker.findUniqueOrThrow({ where: { id: input.trackerId } });
  });
}

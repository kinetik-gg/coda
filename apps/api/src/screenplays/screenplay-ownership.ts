import { ConflictException } from '@nestjs/common';
import type { DatabaseCapabilities } from '../database/database-capabilities';
import type { PrismaService } from '../prisma/prisma.service';
import { lockScreenplayRoleLifecycle } from './screenplay-role-lifecycle';

interface OwnershipTransferInput {
  userId: string;
  screenplayId: string;
  membershipId: string;
  actorMembershipId: string;
  version: number;
}

/**
 * Transfers access-ownership of a screenplay by moving the owner-role membership from the current
 * owner to a target member and demoting the previous owner to the lowest active role.
 *
 * Unlike project transfer, this deliberately does NOT move `Screenplay.ownerUserId`: that column is
 * an immutable storage-partition key (the `screenplay_revisions` composite FK cascades on update
 * into an immutability trigger, so any change to it fails once checkpoints exist). Access-ownership
 * is defined by the `isOwner` role membership; the column stays with the creator. See the ADR:
 * docs/adr-screenplay-access-control.md.
 */
export async function transferScreenplayOwnership(
  db: DatabaseCapabilities,
  prisma: PrismaService,
  input: OwnershipTransferInput,
) {
  return prisma.$transaction(async (tx) => {
    const screenplay = await tx.screenplay.findFirst({
      where: { id: input.screenplayId, version: input.version },
    });
    const target = await tx.screenplayMembership.findFirst({
      where: { id: input.membershipId, screenplayId: input.screenplayId },
      include: { user: { select: { status: true } } },
    });
    if (!screenplay || !target) throw new ConflictException('Screenplay or membership changed');
    if (target.user.status !== 'ACTIVE') {
      throw new ConflictException('Ownership can only be transferred to an active account');
    }
    if (target.id === input.actorMembershipId) {
      throw new ConflictException('Select another member for ownership transfer');
    }
    const ownerRole = await tx.screenplayRole.findFirstOrThrow({
      where: { screenplayId: input.screenplayId, isOwner: true },
    });
    const demotionCandidate = await tx.screenplayRole.findFirst({
      where: { screenplayId: input.screenplayId, isOwner: false, archivedAt: null },
      orderBy: { position: 'asc' },
      select: { id: true },
    });
    if (!demotionCandidate) {
      throw new ConflictException('No active role is available for the previous owner');
    }
    await lockScreenplayRoleLifecycle(db, tx, demotionCandidate.id);
    const demotionRole = await tx.screenplayRole.findFirstOrThrow({
      where: {
        id: demotionCandidate.id,
        screenplayId: input.screenplayId,
        isOwner: false,
        archivedAt: null,
      },
    });
    // Optimistic-concurrency claim without touching owner_user_id (see the doc comment above).
    const claimed = await tx.screenplay.updateMany({
      where: { id: input.screenplayId, version: input.version },
      data: { version: { increment: 1 } },
    });
    if (claimed.count !== 1) {
      throw new ConflictException('Screenplay ownership has changed; refresh and retry');
    }
    // Demote the previous owner first so the owner role is never held by two memberships at once.
    await tx.screenplayMembership.update({
      where: { id: input.actorMembershipId },
      data: { roleId: demotionRole.id, version: { increment: 1 } },
    });
    await tx.screenplayMembership.update({
      where: { id: target.id },
      data: { roleId: ownerRole.id, version: { increment: 1 } },
    });
    return tx.screenplay.findUniqueOrThrow({ where: { id: input.screenplayId } });
  });
}

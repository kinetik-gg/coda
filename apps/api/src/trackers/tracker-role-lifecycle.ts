import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { DatabaseCapabilities } from '../database/database-capabilities';

export async function lockTrackerRoleLifecycle(
  db: DatabaseCapabilities,
  tx: Prisma.TransactionClient,
  roleId: string,
): Promise<void> {
  await db.acquireTransactionLock(tx, 'tracker-role:' + roleId);
}

export async function activeInvitationTrackerRole(
  db: DatabaseCapabilities,
  tx: Prisma.TransactionClient,
  trackerId: string,
  roleId: string,
) {
  await lockTrackerRoleLifecycle(db, tx, roleId);
  return tx.trackerRole.findFirst({
    where: { id: roleId, trackerId, archivedAt: null, isOwner: false },
    include: { permissions: true },
  });
}

export async function assertInvitationTrackerRoleAvailable(
  db: DatabaseCapabilities,
  tx: Prisma.TransactionClient,
  trackerId: string | null | undefined,
  roleId: string | null | undefined,
): Promise<void> {
  if (!trackerId || !roleId) return;
  const role = await activeInvitationTrackerRole(db, tx, trackerId, roleId);
  if (!role) throw new ConflictException('The invitation tracker role is no longer available');
}

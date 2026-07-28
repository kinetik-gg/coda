import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { DatabaseCapabilities } from '../database/database-capabilities';

export async function lockSpaceRoleLifecycle(
  db: DatabaseCapabilities,
  tx: Prisma.TransactionClient,
  roleId: string,
): Promise<void> {
  await db.acquireTransactionLock(tx, 'space-role:' + roleId);
}

export async function activeInvitationSpaceRole(
  db: DatabaseCapabilities,
  tx: Prisma.TransactionClient,
  spaceId: string,
  roleId: string,
) {
  await lockSpaceRoleLifecycle(db, tx, roleId);
  return tx.spaceRole.findFirst({
    where: { id: roleId, spaceId, archivedAt: null, isOwner: false, space: { deletedAt: null } },
    include: { permissions: true },
  });
}

export async function assertInvitationSpaceRoleAvailable(
  db: DatabaseCapabilities,
  tx: Prisma.TransactionClient,
  spaceId: string | null | undefined,
  roleId: string | null | undefined,
): Promise<void> {
  if (!spaceId || !roleId) return;
  const role = await activeInvitationSpaceRole(db, tx, spaceId, roleId);
  if (!role) throw new ConflictException('The invitation Space role is no longer available');
}

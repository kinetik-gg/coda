import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { DatabaseCapabilities } from '../database/database-capabilities';

export async function lockScreenplayRoleLifecycle(
  db: DatabaseCapabilities,
  tx: Prisma.TransactionClient,
  roleId: string,
): Promise<void> {
  await db.acquireTransactionLock(tx, 'screenplay-role:' + roleId);
}

export async function activeInvitationScreenplayRole(
  db: DatabaseCapabilities,
  tx: Prisma.TransactionClient,
  screenplayId: string,
  roleId: string,
) {
  await lockScreenplayRoleLifecycle(db, tx, roleId);
  return tx.screenplayRole.findFirst({
    where: { id: roleId, screenplayId, archivedAt: null, isOwner: false },
    include: { permissions: true },
  });
}

export async function assertInvitationScreenplayRoleAvailable(
  db: DatabaseCapabilities,
  tx: Prisma.TransactionClient,
  screenplayId: string | null | undefined,
  roleId: string | null | undefined,
): Promise<void> {
  if (!screenplayId || !roleId) return;
  const role = await activeInvitationScreenplayRole(db, tx, screenplayId, roleId);
  if (!role) throw new ConflictException('The invitation screenplay role is no longer available');
}

import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { DatabaseCapabilities } from '../database/database-capabilities';

export async function lockProjectRoleLifecycle(
  db: DatabaseCapabilities,
  tx: Prisma.TransactionClient,
  roleId: string,
): Promise<void> {
  await db.acquireTransactionLock(tx, 'project-role:' + roleId);
}

export async function activeInvitationProjectRole(
  db: DatabaseCapabilities,
  tx: Prisma.TransactionClient,
  projectId: string,
  roleId: string,
) {
  await lockProjectRoleLifecycle(db, tx, roleId);
  return tx.projectRole.findFirst({
    where: {
      id: roleId,
      projectId,
      archivedAt: null,
      isOwner: false,
      project: { deletedAt: null },
    },
    include: { permissions: true },
  });
}

export async function assertInvitationProjectRoleAvailable(
  db: DatabaseCapabilities,
  tx: Prisma.TransactionClient,
  projectId: string | null | undefined,
  roleId: string | null | undefined,
): Promise<void> {
  if (!projectId || !roleId) return;
  const role = await activeInvitationProjectRole(db, tx, projectId, roleId);
  if (!role) throw new ConflictException('The invitation project role is no longer available');
}

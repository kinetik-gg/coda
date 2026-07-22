import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export async function lockProjectRoleLifecycle(
  tx: Prisma.TransactionClient,
  roleId: string,
): Promise<void> {
  await tx.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${'project-role:' + roleId}, 0))`,
  );
}

export async function activeInvitationProjectRole(
  tx: Prisma.TransactionClient,
  projectId: string,
  roleId: string,
) {
  await lockProjectRoleLifecycle(tx, roleId);
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
  tx: Prisma.TransactionClient,
  projectId: string | null | undefined,
  roleId: string | null | undefined,
): Promise<void> {
  if (!projectId || !roleId) return;
  const role = await activeInvitationProjectRole(tx, projectId, roleId);
  if (!role) throw new ConflictException('The invitation project role is no longer available');
}

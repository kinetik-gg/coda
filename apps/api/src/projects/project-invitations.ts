import { ConflictException, NotFoundException } from '@nestjs/common';
import { createToken, hashToken } from '../common/crypto';
import type { PrismaService } from '../prisma/prisma.service';
import { activeInvitationProjectRole } from './project-role-lifecycle';

interface ProjectInvitationActor {
  userId: string;
  permissions: Array<{ permission: string }>;
}

export async function issueProjectInvitation(
  prisma: PrismaService,
  projectId: string,
  roleId: string,
  email: string,
  actor: ProjectInvitationActor,
) {
  const token = createToken();
  return prisma.$transaction(async (tx) => {
    const role = await activeInvitationProjectRole(tx, projectId, roleId);
    if (!role) throw new NotFoundException('Role not found');
    assertGrantableInvitationRole(actor.permissions, role.permissions);
    const invitation = await tx.projectInvitation.create({
      data: {
        projectId,
        roleId,
        email,
        tokenHash: hashToken(token),
        inviterId: actor.userId,
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
      },
    });
    await tx.activityEvent.create({
      data: {
        projectId,
        actorId: actor.userId,
        action: 'INVITED',
        resourceType: 'invitation',
        resourceId: invitation.id,
        metadata: { roleId },
      },
    });
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

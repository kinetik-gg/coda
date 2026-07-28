import { ConflictException, NotFoundException } from '@nestjs/common';
import { createToken, hashToken } from '../common/crypto';
import type { DatabaseCapabilities } from '../database/database-capabilities';
import type { PrismaService } from '../prisma/prisma.service';
import { activeInvitationSpaceRole } from './space-role-lifecycle';

interface SpaceInvitationActor {
  userId: string;
  permissions: Array<{ permission: string }>;
}

export async function issueSpaceInvitation(
  deps: { prisma: PrismaService; db: DatabaseCapabilities },
  spaceId: string,
  roleId: string,
  email: string,
  actor: SpaceInvitationActor,
) {
  const token = createToken();
  return deps.prisma.$transaction(async (tx) => {
    const role = await activeInvitationSpaceRole(deps.db, tx, spaceId, roleId);
    if (!role) throw new NotFoundException('Role not found');
    assertGrantableInvitationRole(actor.permissions, role.permissions);
    const invitation = await tx.spaceInvitation.create({
      data: {
        spaceId,
        roleId,
        email,
        tokenHash: hashToken(token),
        inviterId: actor.userId,
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
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

import { ConflictException, NotFoundException } from '@nestjs/common';
import { createToken, hashToken } from '../common/crypto';
import type { DatabaseCapabilities } from '../database/database-capabilities';
import type { PrismaService } from '../prisma/prisma.service';
import { activeInvitationScreenplayRole } from './screenplay-role-lifecycle';

interface ScreenplayInvitationActor {
  userId: string;
  permissions: Array<{ permission: string }>;
}

export async function issueScreenplayInvitation(
  deps: { prisma: PrismaService; db: DatabaseCapabilities },
  screenplayId: string,
  roleId: string,
  email: string,
  actor: ScreenplayInvitationActor,
) {
  const token = createToken();
  return deps.prisma.$transaction(async (tx) => {
    const role = await activeInvitationScreenplayRole(deps.db, tx, screenplayId, roleId);
    if (!role) throw new NotFoundException('Role not found');
    assertGrantableInvitationRole(actor.permissions, role.permissions);
    const invitation = await tx.screenplayInvitation.create({
      data: {
        screenplayId,
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

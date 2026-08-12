import { NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { provisionSpaceAccess } from './space-roles';

export const PERSONAL_DEFAULT_SPACE_NAME = 'Default';
export const PERSONAL_DEFAULT_SPACE_DESCRIPTION = 'Your personal workspace.';

type SpaceReader = Pick<PrismaService, 'space'>;

export async function personalDefaultSpaceId(prisma: SpaceReader, userId: string): Promise<string> {
  const space = await prisma.space.findFirst({
    where: { ownerUserId: userId, isDefault: true, deletedAt: null },
    select: { id: true },
  });
  if (!space) throw new NotFoundException('Personal Default Space not found');
  return space.id;
}

/** Provisions the one personal Default Space owned by an account. */
export async function ensurePersonalDefaultSpace(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<string> {
  const existing = await tx.space.findFirst({
    where: { ownerUserId: userId, isDefault: true, deletedAt: null },
    select: { id: true },
  });
  if (existing) return existing.id;

  const space = await tx.space.create({
    data: {
      name: PERSONAL_DEFAULT_SPACE_NAME,
      description: PERSONAL_DEFAULT_SPACE_DESCRIPTION,
      ownerUserId: userId,
      isDefault: true,
    },
  });
  await provisionSpaceAccess(tx, space.id, userId);
  return space.id;
}

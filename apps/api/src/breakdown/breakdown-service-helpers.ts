import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { rankBetween } from '../common/rank';
import type { PrismaService } from '../prisma/prisma.service';
import { rankForMove } from './breakdown-ordering';
import type { BreakdownTransaction as Transaction } from './breakdown.types';

interface EntityTypeInput {
  singularName: string;
  pluralName: string;
  displayPrefix?: string | null;
}

interface UpdateEntityTypeInput {
  singularName?: string;
  pluralName?: string;
  displayPrefix?: string | null;
  version: number;
}

export async function addEntityType(
  prisma: PrismaService,
  projectId: string,
  userId: string,
  input: EntityTypeInput,
) {
  return prisma.$transaction(async (tx) => {
    const levels = await tx.entityType.findMany({
      where: { projectId },
      orderBy: { level: 'asc' },
    });
    if (levels.length >= 3)
      throw new ConflictException('A project can have at most three hierarchy levels');
    const parent = levels.at(-1);
    const entityType = await tx.entityType.create({
      data: {
        projectId,
        parentTypeId: parent?.id,
        level: levels.length + 1,
        singularName: input.singularName,
        pluralName: input.pluralName,
        displayPrefix: input.displayPrefix,
        position: rankBetween(parent?.position, null),
      },
    });
    await touchProject(tx, projectId, userId, {
      action: 'CREATED',
      resourceType: 'entity_type',
      resourceId: entityType.id,
    });
    return entityType;
  });
}

export async function updateEntityType(
  prisma: PrismaService,
  projectId: string,
  entityTypeId: string,
  input: UpdateEntityTypeInput,
) {
  const result = await prisma.entityType.updateMany({
    where: { id: entityTypeId, projectId, version: input.version },
    data: {
      ...(input.singularName !== undefined ? { singularName: input.singularName } : {}),
      ...(input.pluralName !== undefined ? { pluralName: input.pluralName } : {}),
      ...(input.displayPrefix !== undefined ? { displayPrefix: input.displayPrefix } : {}),
      version: { increment: 1 },
    },
  });
  if (!result.count) throw new ConflictException('Hierarchy level has changed');
  return prisma.entityType.findUniqueOrThrow({ where: { id: entityTypeId } });
}

export async function removeDeepestEntityType(
  prisma: PrismaService,
  projectId: string,
  entityTypeId: string,
  userId: string,
) {
  return prisma.$transaction(async (tx) => {
    const levels = await tx.entityType.findMany({
      where: { projectId },
      orderBy: { level: 'asc' },
    });
    const target = levels.at(-1);
    if (levels.length === 1 || target?.id !== entityTypeId)
      throw new ConflictException('Only an empty deepest level may be removed');
    const [items, fields] = await Promise.all([
      tx.breakdownItem.count({ where: { entityTypeId } }),
      tx.fieldDefinition.count({ where: { entityTypeId } }),
    ]);
    if (items || fields)
      throw new ConflictException(
        'Clear active and trashed items and fields before removing this level',
      );
    await tx.entityType.delete({ where: { id: entityTypeId } });
    await touchProject(tx, projectId, userId, {
      action: 'DELETED',
      resourceType: 'entity_type',
      resourceId: entityTypeId,
    });
    return { removed: true };
  });
}

export { rankForMove };

export async function lockOrderingGroup(tx: Transaction, scope: string): Promise<void> {
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${scope}, 0))`);
}

export async function validateParent(
  tx: Transaction | PrismaService,
  projectId: string,
  parentTypeId: string | null,
  parentId: string | null,
) {
  if (!parentTypeId && parentId)
    throw new BadRequestException('Top-level items cannot have a parent');
  if (parentTypeId && !parentId)
    throw new BadRequestException('This hierarchy level requires a parent');
  if (parentId) {
    const parent = await tx.breakdownItem.findFirst({
      where: { id: parentId, projectId, entityTypeId: parentTypeId!, deletedAt: null },
    });
    if (!parent) throw new BadRequestException('Parent does not match the configured hierarchy');
  }
}

export function encodeCursor(id: string) {
  return Buffer.from(JSON.stringify({ id }), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): { id: string } {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { id: string };
  } catch {
    throw new BadRequestException('Invalid cursor');
  }
}

export async function touchProject(
  tx: Transaction,
  projectId: string,
  actorId: string,
  event: {
    action: 'CREATED' | 'UPDATED' | 'DELETED';
    resourceType: string;
    resourceId: string;
  },
) {
  await tx.project.update({ where: { id: projectId }, data: { revision: { increment: 1 } } });
  await tx.activityEvent.create({ data: { projectId, actorId, ...event } });
}

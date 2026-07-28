import { NotFoundException } from '@nestjs/common';
import {
  allResourceTypes,
  permissionsForResourceTier,
  type ResourceTier,
  type ResourceType,
} from '@coda/contracts';
import type { PrismaService } from '../prisma/prisma.service';

export interface SpaceResourceRegistryEntry {
  listAccessibleResourceIds(prisma: PrismaService, userId: string): Promise<string[]>;
  resolveOwner(prisma: PrismaService, resourceId: string): Promise<string>;
  tierPermissions(tier: ResourceTier): readonly string[];
  movePreflight(prisma: PrismaService, resourceId: string): Promise<void>;
}

async function accessibleBreakdownIds(prisma: PrismaService, userId: string): Promise<string[]> {
  const projects = await prisma.project.findMany({
    where: {
      deletedAt: null,
      memberships: {
        some: {
          userId,
          role: { archivedAt: null, permissions: { some: { permission: 'read_project' } } },
        },
      },
    },
    select: { id: true },
  });
  return projects.map((project) => project.id);
}

async function accessibleScreenplayIds(prisma: PrismaService, userId: string): Promise<string[]> {
  const memberships = await prisma.screenplayMembership.findMany({
    where: {
      userId,
      role: { archivedAt: null, permissions: { some: { permission: 'read_screenplay' } } },
    },
    select: { screenplayId: true },
  });
  const screenplays = await prisma.screenplay.findMany({
    where: {
      id: { in: memberships.map((membership) => membership.screenplayId) },
      deletedAt: null,
    },
    select: { id: true },
  });
  return screenplays.map((screenplay) => screenplay.id);
}

async function breakdownOwner(prisma: PrismaService, resourceId: string): Promise<string> {
  const project = await prisma.project.findFirst({
    where: { id: resourceId, deletedAt: null },
    select: { ownerUserId: true },
  });
  if (!project) throw new NotFoundException('Breakdown not found');
  return project.ownerUserId;
}

async function screenplayOwner(prisma: PrismaService, resourceId: string): Promise<string> {
  const screenplay = await prisma.screenplay.findFirst({
    where: { id: resourceId, deletedAt: null },
    select: { ownerUserId: true },
  });
  if (!screenplay) throw new NotFoundException('Screenplay not found');
  return screenplay.ownerUserId;
}

export const spaceResourceRegistry = {
  breakdown: {
    listAccessibleResourceIds: accessibleBreakdownIds,
    resolveOwner: breakdownOwner,
    tierPermissions: (tier) => permissionsForResourceTier('breakdown', tier),
    movePreflight: async (prisma, resourceId) => {
      await breakdownOwner(prisma, resourceId);
    },
  },
  screenplay: {
    listAccessibleResourceIds: accessibleScreenplayIds,
    resolveOwner: screenplayOwner,
    tierPermissions: (tier) => permissionsForResourceTier('screenplay', tier),
    movePreflight: async (prisma, resourceId) => {
      await screenplayOwner(prisma, resourceId);
    },
  },
} as const satisfies Record<ResourceType, SpaceResourceRegistryEntry>;

export function spaceResourceRegistryEntries(): Array<[ResourceType, SpaceResourceRegistryEntry]> {
  return allResourceTypes.map((resourceType) => [
    resourceType,
    spaceResourceRegistry[resourceType],
  ]);
}

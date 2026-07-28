import { NotFoundException } from '@nestjs/common';
import {
  allResourceTypes,
  permissionsForResourceTier,
  type ResourceTier,
  type ResourceType,
} from '@coda/contracts';
import type { PrismaService } from '../prisma/prisma.service';

export type SpaceResourcePrisma = Pick<
  PrismaService,
  'project' | 'projectMembership' | 'screenplay' | 'screenplayMembership'
>;

export interface SpaceResourceRegistryEntry {
  canMove(prisma: SpaceResourcePrisma, userId: string, resourceId: string): Promise<boolean>;
  listInSpace(prisma: PrismaService, userId: string): Promise<string[]>;
  listActiveIds(prisma: PrismaService): Promise<string[]>;
  readonly readPermission: string;
  resolveOwner(prisma: PrismaService, resourceId: string): Promise<string>;
  tierPermissions(tier: ResourceTier): readonly string[];
  movePreflight(
    prisma: SpaceResourcePrisma,
    resourceId: string,
    sourceMemberUserIds: readonly string[],
    targetMemberUserIds: readonly string[],
  ): Promise<SpaceMovePreflight>;
}

export interface SpaceMovePreflight {
  gainsAccess: string[];
  losesAccess: string[];
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

async function activeBreakdownIds(prisma: PrismaService): Promise<string[]> {
  const projects = await prisma.project.findMany({
    where: { deletedAt: null },
    select: { id: true },
  });
  return projects.map((project) => project.id);
}

async function activeScreenplayIds(prisma: PrismaService): Promise<string[]> {
  const screenplays = await prisma.screenplay.findMany({
    where: { deletedAt: null },
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

function accessChangePreflight(
  directMemberUserIds: readonly string[],
  sourceMemberUserIds: readonly string[],
  targetMemberUserIds: readonly string[],
): SpaceMovePreflight {
  const directMembers = new Set(directMemberUserIds);
  const sourceMembers = new Set(sourceMemberUserIds);
  const targetMembers = new Set(targetMemberUserIds);
  return {
    gainsAccess: [...targetMembers]
      .filter((userId) => !sourceMembers.has(userId) && !directMembers.has(userId))
      .sort(),
    losesAccess: [...sourceMembers]
      .filter((userId) => !targetMembers.has(userId) && !directMembers.has(userId))
      .sort(),
  };
}

async function breakdownMovePermission(
  prisma: SpaceResourcePrisma,
  userId: string,
  resourceId: string,
): Promise<boolean> {
  const membership = await prisma.projectMembership.findUnique({
    where: { projectId_userId: { projectId: resourceId, userId } },
    include: { role: { include: { permissions: true } } },
  });
  return Boolean(
    membership &&
    !membership.role.archivedAt &&
    (membership.role.isOwner ||
      membership.role.permissions.some((entry) => entry.permission === 'manage_project_settings')),
  );
}

async function screenplayMovePermission(
  prisma: SpaceResourcePrisma,
  userId: string,
  resourceId: string,
): Promise<boolean> {
  const membership = await prisma.screenplayMembership.findUnique({
    where: { screenplayId_userId: { screenplayId: resourceId, userId } },
    include: { role: { include: { permissions: true } } },
  });
  return Boolean(
    membership &&
    !membership.role.archivedAt &&
    (membership.role.isOwner ||
      membership.role.permissions.some(
        (entry) => entry.permission === 'manage_screenplay_settings',
      )),
  );
}

async function breakdownMovePreflight(
  prisma: SpaceResourcePrisma,
  resourceId: string,
  sourceMemberUserIds: readonly string[],
  targetMemberUserIds: readonly string[],
): Promise<SpaceMovePreflight> {
  const members = await prisma.projectMembership.findMany({
    where: { projectId: resourceId, role: { archivedAt: null } },
    select: { userId: true },
  });
  return accessChangePreflight(
    members.map((membership) => membership.userId),
    sourceMemberUserIds,
    targetMemberUserIds,
  );
}

async function screenplayMovePreflight(
  prisma: SpaceResourcePrisma,
  resourceId: string,
  sourceMemberUserIds: readonly string[],
  targetMemberUserIds: readonly string[],
): Promise<SpaceMovePreflight> {
  const members = await prisma.screenplayMembership.findMany({
    where: { screenplayId: resourceId, role: { archivedAt: null } },
    select: { userId: true },
  });
  return accessChangePreflight(
    members.map((membership) => membership.userId),
    sourceMemberUserIds,
    targetMemberUserIds,
  );
}

export const spaceResourceRegistry = {
  breakdown: {
    canMove: breakdownMovePermission,
    listInSpace: accessibleBreakdownIds,
    listActiveIds: activeBreakdownIds,
    readPermission: 'read_project',
    resolveOwner: breakdownOwner,
    tierPermissions: (tier) => permissionsForResourceTier('breakdown', tier),
    movePreflight: breakdownMovePreflight,
  },
  screenplay: {
    canMove: screenplayMovePermission,
    listInSpace: accessibleScreenplayIds,
    listActiveIds: activeScreenplayIds,
    readPermission: 'read_screenplay',
    resolveOwner: screenplayOwner,
    tierPermissions: (tier) => permissionsForResourceTier('screenplay', tier),
    movePreflight: screenplayMovePreflight,
  },
} as const satisfies Record<ResourceType, SpaceResourceRegistryEntry>;

export function spaceResourceRegistryEntries(): Array<[ResourceType, SpaceResourceRegistryEntry]> {
  return allResourceTypes.map((resourceType) => [
    resourceType,
    spaceResourceRegistry[resourceType],
  ]);
}

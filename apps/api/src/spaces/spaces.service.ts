import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { CreateSpace, CreateSpaceRole, UpdateSpace, UpdateSpaceRole } from '@coda/contracts';
import { allResourceTypes, type ResourceType } from '@coda/contracts';
import { rankBetween } from '../common/rank';
import { DatabaseCapabilities } from '../database/database-capabilities';
import { PrismaService } from '../prisma/prisma.service';
import { issueSpaceInvitation } from './space-invitations';
import { SpacePermissionService } from './space-permission.service';
import { spaceResourceRegistryEntries } from './space-resource-registry';
import { lockSpaceRoleLifecycle } from './space-role-lifecycle';
import { transferSpaceOwnership } from './space-ownership';
import { provisionSpaceAccess } from './space-roles';
import { DEFAULT_SPACE_ID } from './space-constants';

type ResourceCounts = Record<ResourceType, number>;

function emptyResourceCounts(): ResourceCounts {
  return Object.fromEntries(allResourceTypes.map((type) => [type, 0])) as ResourceCounts;
}

@Injectable()
export class SpacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: SpacePermissionService,
    private readonly db: DatabaseCapabilities,
  ) {}

  async list(userId: string) {
    this.permissions.assertSession();
    const [memberships, counts] = await Promise.all([
      this.prisma.spaceMembership.findMany({
        where: { userId, role: { archivedAt: null }, space: { deletedAt: null } },
        include: { role: { include: { permissions: true } }, space: true },
      }),
      this.accessibleResourceCounts(userId),
    ]);
    const membershipBySpaceId = new Map(
      memberships.map((membership) => [membership.spaceId, membership]),
    );
    const visibleSpaceIds = new Set([...membershipBySpaceId.keys(), ...counts.keys()]);
    if (visibleSpaceIds.size === 0) return [];
    const spaces = await this.prisma.space.findMany({
      where: { id: { in: [...visibleSpaceIds] }, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
    });
    return spaces.map((space) => ({
      ...space,
      currentMembership: membershipBySpaceId.get(space.id) ?? null,
      resourceCounts: counts.get(space.id) ?? emptyResourceCounts(),
    }));
  }

  async create(userId: string, input: CreateSpace) {
    this.permissions.assertSession();
    return this.prisma.$transaction(async (tx) => {
      const space = await tx.space.create({
        data: { name: input.name, description: input.description, ownerUserId: userId },
      });
      await provisionSpaceAccess(tx, space.id, userId);
      return space;
    });
  }

  async get(userId: string, spaceId: string) {
    const membership = await this.permissions.assert(userId, spaceId, 'read_space');
    const counts = await this.accessibleResourceCounts(userId);
    return {
      ...membership.space,
      currentMembership: membership,
      resourceCounts: counts.get(spaceId) ?? emptyResourceCounts(),
    };
  }

  async update(userId: string, spaceId: string, input: UpdateSpace) {
    await this.permissions.assert(userId, spaceId, 'manage_space_settings');
    const result = await this.prisma.space.updateMany({
      where: { id: spaceId, version: input.version, deletedAt: null },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        version: { increment: 1 },
      },
    });
    if (result.count === 0) throw new ConflictException('Space has changed; refresh and retry');
    return this.prisma.space.findUniqueOrThrow({ where: { id: spaceId } });
  }

  async remove(userId: string, spaceId: string) {
    await this.permissions.assert(userId, spaceId, 'delete_space');
    const space = await this.prisma.space.findFirst({
      where: { id: spaceId, deletedAt: null },
      select: { id: true, isDefault: true, _count: { select: { resources: true } } },
    });
    if (!space) throw new NotFoundException('Space not found');
    if (space.isDefault) throw new ConflictException('The Default Space cannot be deleted');
    if (space._count.resources > 0) {
      throw new ConflictException('Move all resources out of this Space before deleting it');
    }
    await this.prisma.space.update({ where: { id: spaceId }, data: { deletedAt: new Date() } });
    return { id: spaceId };
  }

  async transferOwnership(userId: string, spaceId: string, membershipId: string, version: number) {
    const space = await this.prisma.space.findFirst({
      where: { id: spaceId, deletedAt: null },
      select: { isDefault: true },
    });
    if (space?.isDefault) {
      throw new ConflictException('Ownership of the Default Space cannot be transferred');
    }
    const actor = await this.permissions.membership(userId, spaceId);
    if (!actor.role.isOwner) {
      throw new ConflictException('Only the current owner may transfer ownership');
    }
    return transferSpaceOwnership(this.db, this.prisma, {
      userId,
      spaceId,
      membershipId,
      actorMembershipId: actor.id,
      version,
    });
  }

  async management(userId: string, spaceId: string) {
    const membership = await this.permissions.assert(userId, spaceId, 'manage_space_settings');
    const space = await this.prisma.space.findFirst({
      where: { id: spaceId, deletedAt: null },
      include: {
        roles: {
          where: { archivedAt: null },
          orderBy: { position: 'asc' },
          include: { permissions: true, _count: { select: { memberships: true } } },
        },
        memberships: { orderBy: { createdAt: 'asc' }, include: { role: true } },
        invitations: {
          where: { status: 'PENDING', revokedAt: null },
          orderBy: { createdAt: 'desc' },
          include: { role: { select: { id: true, name: true } } },
        },
        _count: { select: { resources: true } },
      },
    });
    if (!space) throw new NotFoundException('Space not found');
    const users = await this.usersById([
      ...space.memberships.map((entry) => entry.userId),
      ...space.invitations.map((entry) => entry.inviterId),
    ]);
    return {
      ...space,
      memberships: space.memberships.map((entry) => ({
        ...entry,
        user: users.get(entry.userId) ?? null,
      })),
      invitations: space.invitations.map((entry) => ({
        ...entry,
        inviter: users.get(entry.inviterId) ?? null,
      })),
      currentMembership: {
        id: membership.id,
        roleId: membership.roleId,
        permissions: membership.role.permissions.map((entry) => entry.permission),
      },
    };
  }

  async availableUsers(userId: string, spaceId: string) {
    await this.permissions.assert(userId, spaceId, 'invite_members');
    return this.prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        spaceMemberships: { none: { spaceId } },
      },
      orderBy: [{ displayName: 'asc' }, { email: 'asc' }],
      select: { id: true, email: true, displayName: true, status: true },
    });
  }

  async createRole(userId: string, spaceId: string, input: CreateSpaceRole) {
    const actor = await this.permissions.assert(userId, spaceId, 'manage_roles');
    this.assertGrantable(actor.role.permissions, input.permissions);
    const lastRole = await this.prisma.spaceRole.findFirst({
      where: { spaceId, archivedAt: null },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    return this.prisma.spaceRole.create({
      data: {
        spaceId,
        name: input.name,
        description: input.description,
        resourceTier: input.resourceTier,
        position: rankBetween(lastRole?.position, null),
        permissions: { create: input.permissions.map((permission) => ({ permission })) },
      },
      include: { permissions: true },
    });
  }

  async updateRole(userId: string, spaceId: string, roleId: string, input: UpdateSpaceRole) {
    const actor = await this.permissions.assert(userId, spaceId, 'manage_roles');
    if (input.permissions) this.assertGrantable(actor.role.permissions, input.permissions);
    return this.prisma.$transaction(async (tx) => {
      const role = await tx.spaceRole.findFirst({
        where: { id: roleId, spaceId, archivedAt: null },
      });
      if (!role) throw new NotFoundException('Role not found');
      if (role.isOwner) throw new ConflictException('The owner role cannot be changed');
      const updated = await tx.spaceRole.updateMany({
        where: { id: roleId, spaceId, version: input.version, archivedAt: null, isOwner: false },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.resourceTier !== undefined ? { resourceTier: input.resourceTier } : {}),
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) throw new ConflictException('Role has changed; refresh and retry');
      if (input.permissions) {
        await tx.spaceRolePermission.deleteMany({ where: { roleId } });
        await tx.spaceRolePermission.createMany({
          data: input.permissions.map((permission) => ({ roleId, permission })),
        });
      }
      return tx.spaceRole.findUniqueOrThrow({
        where: { id: roleId },
        include: { permissions: true },
      });
    });
  }

  async archiveRole(userId: string, spaceId: string, roleId: string, version: number) {
    await this.permissions.assert(userId, spaceId, 'manage_roles');
    return this.prisma.$transaction(async (tx) => {
      await lockSpaceRoleLifecycle(this.db, tx, roleId);
      const role = await tx.spaceRole.findFirst({
        where: { id: roleId, spaceId, archivedAt: null },
        include: { _count: { select: { memberships: true, invitations: true } } },
      });
      if (!role) throw new NotFoundException('Role not found');
      if (role.isOwner) throw new ConflictException('The owner role cannot be archived');
      if (role._count.memberships > 0 || role._count.invitations > 0) {
        throw new ConflictException('Reassign members and revoke pending invitations first');
      }
      const archived = await tx.spaceRole.updateMany({
        where: { id: roleId, spaceId, version, archivedAt: null, isOwner: false },
        data: { archivedAt: new Date(), version: { increment: 1 } },
      });
      if (archived.count === 0) throw new ConflictException('Role has changed; refresh and retry');
      return tx.spaceRole.findUniqueOrThrow({
        where: { id: roleId },
        include: { permissions: true },
      });
    });
  }

  async addMembership(userId: string, spaceId: string, memberUserId: string, roleId: string) {
    const actor = await this.permissions.assert(userId, spaceId, 'invite_members');
    const [member, existing] = await Promise.all([
      this.prisma.user.findFirst({ where: { id: memberUserId, status: 'ACTIVE' } }),
      this.prisma.spaceMembership.findUnique({
        where: { spaceId_userId: { spaceId, userId: memberUserId } },
      }),
    ]);
    if (!member) throw new NotFoundException('User or role not found');
    if (existing) throw new ConflictException('This user is already a Space member');
    return this.assignMembership(spaceId, memberUserId, roleId, actor.role.permissions);
  }

  async updateMembership(
    userId: string,
    spaceId: string,
    membershipId: string,
    roleId: string,
    version: number,
  ) {
    const actor = await this.permissions.assert(userId, spaceId, 'manage_member_roles');
    const membership = await this.prisma.spaceMembership.findFirst({
      where: { id: membershipId, spaceId },
      include: { role: true },
    });
    if (!membership || membership.role.isOwner)
      throw new ConflictException('Owner membership cannot change');
    return this.prisma.$transaction(async (tx) => {
      await lockSpaceRoleLifecycle(this.db, tx, roleId);
      const role = await tx.spaceRole.findFirst({
        where: { id: roleId, spaceId, archivedAt: null, isOwner: false },
        include: { permissions: true },
      });
      if (!role) throw new NotFoundException('Membership or role not found');
      this.assertGrantable(
        actor.role.permissions,
        role.permissions.map((entry) => entry.permission),
      );
      const result = await tx.spaceMembership.updateMany({
        where: { id: membershipId, spaceId, version },
        data: { roleId, version: { increment: 1 } },
      });
      if (result.count === 0)
        throw new ConflictException('Membership has changed; refresh and retry');
      return tx.spaceMembership.findUniqueOrThrow({
        where: { id: membershipId },
        include: { role: true },
      });
    });
  }

  async removeMembership(userId: string, spaceId: string, membershipId: string, version: number) {
    await this.permissions.assert(userId, spaceId, 'manage_member_roles');
    const membership = await this.prisma.spaceMembership.findFirst({
      where: { id: membershipId, spaceId },
      include: { role: true },
    });
    if (!membership) throw new NotFoundException('Membership not found');
    if (membership.role.isOwner) throw new ConflictException('The Space owner cannot be removed');
    if (membership.userId === userId)
      throw new ConflictException('You cannot remove your own membership');
    const removed = await this.prisma.spaceMembership.deleteMany({
      where: { id: membershipId, spaceId, version },
    });
    if (removed.count === 0)
      throw new ConflictException('Membership has changed; refresh and retry');
    return { id: membershipId };
  }

  async invite(userId: string, spaceId: string, email: string, roleId: string) {
    const actor = await this.permissions.assert(userId, spaceId, 'invite_members');
    return issueSpaceInvitation({ prisma: this.prisma, db: this.db }, spaceId, roleId, email, {
      userId,
      permissions: actor.role.permissions,
    });
  }

  async revokeInvitation(userId: string, spaceId: string, invitationId: string) {
    await this.permissions.assert(userId, spaceId, 'invite_members');
    const result = await this.prisma.spaceInvitation.updateMany({
      where: { id: invitationId, spaceId, status: 'PENDING', revokedAt: null },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    if (result.count === 0) throw new NotFoundException('Invitation not found');
    return { id: invitationId };
  }

  private async assignMembership(
    spaceId: string,
    userId: string,
    roleId: string,
    actorPermissions: Array<{ permission: string }>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await lockSpaceRoleLifecycle(this.db, tx, roleId);
      const role = await tx.spaceRole.findFirst({
        where: { id: roleId, spaceId, archivedAt: null, isOwner: false },
        include: { permissions: true },
      });
      if (!role) throw new NotFoundException('User or role not found');
      this.assertGrantable(
        actorPermissions,
        role.permissions.map((entry) => entry.permission),
      );
      return tx.spaceMembership.create({
        data: { spaceId, userId, roleId },
        include: { role: true },
      });
    });
  }

  private async accessibleResourceCounts(userId: string): Promise<Map<string, ResourceCounts>> {
    const slices = await Promise.all(
      spaceResourceRegistryEntries().map(async ([resourceType, entry]) => {
        const resourceIds = await entry.listInSpace(this.prisma, userId);
        const mappings = resourceIds.length
          ? await this.prisma.spaceResource.findMany({
              where: { resourceType, resourceId: { in: resourceIds } },
              select: { spaceId: true, resourceId: true },
            })
          : [];
        return { resourceType, resourceIds, mappings };
      }),
    );
    const counts = new Map<string, ResourceCounts>();
    for (const slice of slices) {
      const spaceByResourceId = new Map(
        slice.mappings.map((mapping) => [mapping.resourceId, mapping.spaceId]),
      );
      for (const resourceId of slice.resourceIds) {
        const spaceId = spaceByResourceId.get(resourceId) ?? DEFAULT_SPACE_ID;
        const spaceCounts = counts.get(spaceId) ?? emptyResourceCounts();
        spaceCounts[slice.resourceType] += 1;
        counts.set(spaceId, spaceCounts);
      }
    }
    return counts;
  }

  private async usersById(userIds: string[]) {
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(userIds)] } },
      select: { id: true, email: true, displayName: true, status: true },
    });
    return new Map(users.map((user) => [user.id, user]));
  }

  private assertGrantable(
    actorPermissions: Array<{ permission: string }>,
    requestedPermissions: string[],
  ): void {
    const held = new Set(actorPermissions.map((entry) => entry.permission));
    if (requestedPermissions.some((permission) => !held.has(permission))) {
      throw new ConflictException('Cannot grant permissions you do not hold');
    }
  }
}

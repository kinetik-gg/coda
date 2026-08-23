import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { CreateTrackerRole, UpdateTrackerRole } from '@coda/contracts';
import { rankBetween } from '../common/rank';
import { DatabaseCapabilities } from '../database/database-capabilities';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { issueTrackerInvitation } from './tracker-invitations';
import { transferTrackerOwnership } from './tracker-ownership';
import { TrackerPermissionService } from './tracker-permission.service';
import { lockTrackerRoleLifecycle } from './tracker-role-lifecycle';

const memberUserSelection = {
  id: true,
  email: true,
  displayName: true,
  status: true,
} as const;

type MemberUser = {
  id: string;
  email: string;
  displayName: string;
  status: string;
};

/**
 * Membership, invitation, custom-role, and ownership management for trackers — the tracker-scoped
 * twin of the screenplay management surface, with one addition screenplays defer to their seeded
 * roles: full custom role CRUD over the tracker permission vocabulary. Every grant flows through
 * the subset rule — a caller can never hand out a permission they do not hold themselves.
 *
 * The membership/invitation tables carry plain `userId`/`inviterId` columns with no relation onto
 * the core User table (backup round-trip convention), so member/inviter identities are hydrated
 * with a separate lookup rather than a Prisma `include`.
 */
@Injectable()
export class TrackerAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: TrackerPermissionService,
    private readonly db: DatabaseCapabilities,
    private readonly realtime: RealtimeGateway,
  ) {}

  async management(userId: string, trackerId: string) {
    const membership = await this.permissions.assert(userId, trackerId, 'manage_tracker_settings');
    const tracker = await this.prisma.tracker.findFirst({
      where: { id: trackerId, deletedAt: null },
      select: {
        id: true,
        name: true,
        description: true,
        ownerUserId: true,
        version: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!tracker) throw new NotFoundException('Tracker not found');
    const [roles, memberships, invitations] = await Promise.all([
      this.prisma.trackerRole.findMany({
        where: { trackerId, archivedAt: null },
        orderBy: { position: 'asc' },
        include: { permissions: true, _count: { select: { memberships: true } } },
      }),
      this.prisma.trackerMembership.findMany({
        where: { trackerId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, version: true, createdAt: true, userId: true, roleId: true },
      }),
      this.prisma.trackerInvitation.findMany({
        where: { trackerId, status: 'PENDING', revokedAt: null },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          status: true,
          expiresAt: true,
          createdAt: true,
          roleId: true,
          inviterId: true,
        },
      }),
    ]);
    const users = await this.usersById([
      ...memberships.map((entry) => entry.userId),
      ...invitations.map((entry) => entry.inviterId),
    ]);
    const rolesById = new Map(roles.map((role) => [role.id, role]));
    return {
      ...tracker,
      roles,
      memberships: memberships.map(({ userId: memberUserId, roleId, ...rest }) => {
        const role = rolesById.get(roleId);
        return {
          ...rest,
          role: role ? { id: role.id, name: role.name, isOwner: role.isOwner } : null,
          user: users.get(memberUserId) ?? null,
        };
      }),
      invitations: invitations.map(({ inviterId, roleId, ...rest }) => {
        const role = rolesById.get(roleId);
        const inviter = users.get(inviterId);
        return {
          ...rest,
          role: role ? { id: role.id, name: role.name } : null,
          inviter: inviter ? { id: inviter.id, displayName: inviter.displayName } : null,
        };
      }),
      currentMembership: {
        id: membership.id,
        roleId: membership.roleId,
        permissions: membership.role.permissions.map((entry) => entry.permission),
      },
    };
  }

  async invite(userId: string, trackerId: string, email: string, roleId: string) {
    const actor = await this.permissions.assert(userId, trackerId, 'invite_members');
    return issueTrackerInvitation({ prisma: this.prisma, db: this.db }, trackerId, roleId, email, {
      userId,
      permissions: actor.role.permissions,
    });
  }

  async revokeInvitation(userId: string, trackerId: string, invitationId: string) {
    await this.permissions.assert(userId, trackerId, 'invite_members');
    const result = await this.prisma.trackerInvitation.updateMany({
      where: { id: invitationId, trackerId, status: 'PENDING', revokedAt: null },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    if (!result.count) throw new NotFoundException('Pending invitation not found');
    return { id: invitationId };
  }

  async availableUsers(userId: string, trackerId: string) {
    await this.permissions.assert(userId, trackerId, 'invite_members');
    const members = await this.prisma.trackerMembership.findMany({
      where: { trackerId },
      select: { userId: true },
    });
    return this.prisma.user.findMany({
      where: { status: 'ACTIVE', id: { notIn: members.map((member) => member.userId) } },
      orderBy: [{ displayName: 'asc' }, { email: 'asc' }],
      select: memberUserSelection,
    });
  }

  async addMembership(userId: string, trackerId: string, memberUserId: string, roleId: string) {
    const actor = await this.permissions.assert(userId, trackerId, 'invite_members');
    const [member, existing] = await Promise.all([
      this.prisma.user.findFirst({ where: { id: memberUserId, status: 'ACTIVE' } }),
      this.prisma.trackerMembership.findUnique({
        where: { trackerId_userId: { trackerId, userId: memberUserId } },
      }),
    ]);
    if (!member) throw new NotFoundException('User or role not found');
    if (existing) throw new ConflictException('This user is already a tracker member');

    const created = await this.prisma.$transaction(async (tx) => {
      const role = await this.lockedActiveRole(tx, trackerId, roleId);
      if (!role) throw new NotFoundException('User or role not found');
      if (role.isOwner) {
        throw new ConflictException('The owner role can only be assigned by transfer');
      }
      this.assertGrantable(
        actor.role.permissions,
        role.permissions.map((entry) => entry.permission),
      );
      return tx.trackerMembership.create({
        data: { trackerId, userId: memberUserId, roleId },
        include: { role: { include: { permissions: true } } },
      });
    });
    return this.withUser(created);
  }

  async updateMembership(
    userId: string,
    trackerId: string,
    membershipId: string,
    roleId: string,
    version: number,
  ) {
    const actor = await this.permissions.assert(userId, trackerId, 'manage_member_roles');
    const membership = await this.prisma.trackerMembership.findFirst({
      where: { id: membershipId, trackerId },
      include: { role: true },
    });
    if (!membership) throw new NotFoundException('Membership or role not found');
    if (membership.role.isOwner) {
      throw new ConflictException('Use ownership transfer to change the owner membership');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const role = await this.lockedActiveRole(tx, trackerId, roleId);
      if (!role) throw new NotFoundException('Membership or role not found');
      if (role.isOwner) {
        throw new ConflictException('The owner role can only be assigned by transfer');
      }
      this.assertGrantable(
        actor.role.permissions,
        role.permissions.map((entry) => entry.permission),
      );
      const result = await tx.trackerMembership.updateMany({
        where: { id: membershipId, trackerId, version },
        data: { roleId, version: { increment: 1 } },
      });
      if (result.count === 0) {
        throw new ConflictException('Membership has changed; refresh and retry');
      }
      return tx.trackerMembership.findUniqueOrThrow({
        where: { id: membershipId },
        include: { role: { include: { permissions: true } } },
      });
    });
    // Eviction signal: a socket holding the old permission set must not keep acting on it, so
    // force it out of the tracker room now rather than waiting for fanout to notice.
    void this.realtime.evictTrackerMember(trackerId, membership.userId);
    return this.withUser(updated);
  }

  async removeMembership(userId: string, trackerId: string, membershipId: string, version: number) {
    await this.permissions.assert(userId, trackerId, 'manage_member_roles');
    const membership = await this.prisma.trackerMembership.findFirst({
      where: { id: membershipId, trackerId },
      include: { role: true },
    });
    if (!membership) throw new NotFoundException('Membership not found');
    if (membership.role.isOwner) {
      throw new ConflictException('The tracker owner cannot be removed');
    }
    if (membership.userId === userId) {
      throw new ConflictException('You cannot remove your own membership');
    }
    const removed = await this.prisma.trackerMembership.deleteMany({
      where: { id: membershipId, trackerId, version },
    });
    if (removed.count === 0) {
      throw new ConflictException('Membership has changed; refresh and retry');
    }
    void this.realtime.evictTrackerMember(trackerId, membership.userId);
    return { id: membershipId };
  }

  async createRole(userId: string, trackerId: string, input: CreateTrackerRole) {
    const actor = await this.permissions.assert(userId, trackerId, 'manage_roles');
    this.assertGrantable(actor.role.permissions, input.permissions);
    const lastRole = await this.prisma.trackerRole.findFirst({
      where: { trackerId, archivedAt: null },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    return this.prisma.trackerRole.create({
      data: {
        trackerId,
        name: input.name,
        description: input.description,
        position: rankBetween(lastRole?.position, null),
        permissions: { create: input.permissions.map((permission) => ({ permission })) },
      },
      include: { permissions: true },
    });
  }

  async updateRole(userId: string, trackerId: string, roleId: string, input: UpdateTrackerRole) {
    const actor = await this.permissions.assert(userId, trackerId, 'manage_roles');
    if (input.permissions) this.assertGrantable(actor.role.permissions, input.permissions);
    const role = await this.prisma.$transaction(async (tx) => {
      await lockTrackerRoleLifecycle(this.db, tx, roleId);
      const existing = await tx.trackerRole.findFirst({
        where: { id: roleId, trackerId, archivedAt: null },
      });
      if (!existing) throw new NotFoundException('Role not found');
      if (existing.isOwner) throw new ConflictException('The owner role cannot be changed');
      const updated = await tx.trackerRole.updateMany({
        where: { id: roleId, trackerId, version: input.version, archivedAt: null, isOwner: false },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) throw new ConflictException('Role has changed; refresh and retry');
      if (input.permissions) {
        await tx.trackerRolePermission.deleteMany({ where: { roleId } });
        await tx.trackerRolePermission.createMany({
          data: input.permissions.map((permission) => ({ roleId, permission })),
        });
      }
      return readTrackerRole(tx, roleId);
    });
    // Every holder's effective permission set just moved: evict them all from the room.
    for (const holder of await this.roleHolders(trackerId, roleId)) {
      void this.realtime.evictTrackerMember(trackerId, holder);
    }
    return role;
  }

  async archiveRole(userId: string, trackerId: string, roleId: string, version: number) {
    await this.permissions.assert(userId, trackerId, 'manage_roles');
    const role = await this.prisma.$transaction(async (tx) => {
      await lockTrackerRoleLifecycle(this.db, tx, roleId);
      const existing = await tx.trackerRole.findFirst({
        where: { id: roleId, trackerId, archivedAt: null },
        include: { _count: { select: { memberships: true, invitations: true } } },
      });
      if (!existing) throw new NotFoundException('Role not found');
      if (existing.isOwner) throw new ConflictException('The owner role cannot be archived');
      if (existing._count.memberships > 0 || existing._count.invitations > 0) {
        throw new ConflictException('Reassign members and revoke pending invitations first');
      }
      const archived = await tx.trackerRole.updateMany({
        where: { id: roleId, trackerId, version, archivedAt: null, isOwner: false },
        data: { archivedAt: new Date(), version: { increment: 1 } },
      });
      if (archived.count === 0) throw new ConflictException('Role has changed; refresh and retry');
      return readTrackerRole(tx, roleId);
    });
    return role;
  }

  async transferOwnership(
    userId: string,
    trackerId: string,
    membershipId: string,
    version: number,
  ) {
    const actor = await this.permissions.membership(userId, trackerId);
    if (!actor.role.isOwner) {
      throw new ConflictException('Only the current owner may transfer ownership');
    }
    const target = await this.prisma.trackerMembership.findFirst({
      where: { id: membershipId, trackerId },
      select: { userId: true },
    });
    const result = await transferTrackerOwnership(this.db, this.prisma, {
      userId,
      trackerId,
      membershipId,
      actorMembershipId: actor.id,
      version,
    });
    // Both ends of the transfer changed role: the previous owner is demoted, the target is
    // promoted. Neither socket's view of its own access is trustworthy anymore.
    void this.realtime.evictTrackerMember(trackerId, userId);
    if (target) void this.realtime.evictTrackerMember(trackerId, target.userId);
    return result;
  }

  private async lockedActiveRole(tx: Prisma.TransactionClient, trackerId: string, roleId: string) {
    await lockTrackerRoleLifecycle(this.db, tx, roleId);
    return tx.trackerRole.findFirst({
      where: { id: roleId, trackerId, archivedAt: null },
      include: { permissions: true },
    });
  }

  private async roleHolders(trackerId: string, roleId: string): Promise<string[]> {
    const rows = await this.prisma.trackerMembership.findMany({
      where: { trackerId, roleId },
      select: { userId: true },
    });
    return rows.map((row) => row.userId);
  }

  private async withUser<T extends { userId: string }>(membership: T) {
    const user = await this.prisma.user.findUnique({
      where: { id: membership.userId },
      select: memberUserSelection,
    });
    return { ...membership, user };
  }

  private async usersById(ids: string[]): Promise<Map<string, MemberUser>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: memberUserSelection,
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

function readTrackerRole(tx: Prisma.TransactionClient, roleId: string) {
  return tx.trackerRole.findUniqueOrThrow({
    where: { id: roleId },
    include: { permissions: true },
  });
}

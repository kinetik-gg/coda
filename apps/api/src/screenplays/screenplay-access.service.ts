import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseCapabilities } from '../database/database-capabilities';
import { PrismaService } from '../prisma/prisma.service';
import { ScreenplayPermissionService } from './screenplay-permission.service';
import { issueScreenplayInvitation } from './screenplay-invitations';
import { transferScreenplayOwnership } from './screenplay-ownership';
import { lockScreenplayRoleLifecycle } from './screenplay-role-lifecycle';

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
 * Membership, invitation, and ownership management for screenplays — the screenplay-scoped twin of
 * the project management surface (ADR: docs/adr-screenplay-access-control.md). Custom role CRUD is
 * intentionally out of scope; the seeded roles cover the parity requirement.
 *
 * The membership/invitation tables carry plain `userId`/`inviterId` columns with no relation onto
 * the core User table (backup round-trip convention), so member/inviter identities are hydrated with
 * a separate lookup rather than a Prisma `include`.
 */
@Injectable()
export class ScreenplayAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: ScreenplayPermissionService,
    private readonly db: DatabaseCapabilities,
  ) {}

  async management(userId: string, screenplayId: string) {
    const membership = await this.permissions.assert(
      userId,
      screenplayId,
      'manage_screenplay_settings',
    );
    const screenplay = await this.prisma.screenplay.findUnique({
      where: { id: screenplayId },
      select: {
        id: true,
        title: true,
        filename: true,
        ownerUserId: true,
        version: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!screenplay) throw new NotFoundException('Screenplay not found');
    const [roles, memberships, invitations] = await Promise.all([
      this.prisma.screenplayRole.findMany({
        where: { screenplayId, archivedAt: null },
        orderBy: { position: 'asc' },
        include: { permissions: true, _count: { select: { memberships: true } } },
      }),
      this.prisma.screenplayMembership.findMany({
        where: { screenplayId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, version: true, createdAt: true, userId: true, roleId: true },
      }),
      this.prisma.screenplayInvitation.findMany({
        where: { screenplayId, status: 'PENDING', revokedAt: null },
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
    const roleLabels = new Map(roles.map((role) => [role.id, role]));
    return {
      ...screenplay,
      roles,
      memberships: memberships.map(({ userId: memberUserId, roleId, ...rest }) => {
        const role = roleLabels.get(roleId);
        return {
          ...rest,
          role: role ? { id: role.id, name: role.name, isOwner: role.isOwner } : null,
          user: users.get(memberUserId) ?? null,
        };
      }),
      invitations: invitations.map(({ inviterId, roleId, ...rest }) => {
        const role = roleLabels.get(roleId);
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

  async invite(userId: string, screenplayId: string, email: string, roleId: string) {
    const actor = await this.permissions.assert(userId, screenplayId, 'invite_members');
    return issueScreenplayInvitation(
      { prisma: this.prisma, db: this.db },
      screenplayId,
      roleId,
      email,
      { userId, permissions: actor.role.permissions },
    );
  }

  async availableUsers(userId: string, screenplayId: string) {
    await this.permissions.assert(userId, screenplayId, 'invite_members');
    const members = await this.prisma.screenplayMembership.findMany({
      where: { screenplayId },
      select: { userId: true },
    });
    return this.prisma.user.findMany({
      where: { status: 'ACTIVE', id: { notIn: members.map((member) => member.userId) } },
      orderBy: [{ displayName: 'asc' }, { email: 'asc' }],
      select: memberUserSelection,
    });
  }

  async addMembership(userId: string, screenplayId: string, memberUserId: string, roleId: string) {
    const actor = await this.permissions.assert(userId, screenplayId, 'invite_members');
    const [member, existing] = await Promise.all([
      this.prisma.user.findFirst({ where: { id: memberUserId, status: 'ACTIVE' } }),
      this.prisma.screenplayMembership.findUnique({
        where: { screenplayId_userId: { screenplayId, userId: memberUserId } },
      }),
    ]);
    if (!member) throw new NotFoundException('User or role not found');
    if (existing) throw new ConflictException('This user is already a screenplay member');

    const created = await this.prisma.$transaction(async (tx) => {
      await lockScreenplayRoleLifecycle(this.db, tx, roleId);
      const role = await tx.screenplayRole.findFirst({
        where: { id: roleId, screenplayId, archivedAt: null },
        include: { permissions: true },
      });
      if (!role) throw new NotFoundException('User or role not found');
      if (role.isOwner) {
        throw new ConflictException('The owner role can only be assigned by transfer');
      }
      this.assertGrantable(
        actor.role.permissions,
        role.permissions.map((entry) => entry.permission),
      );
      return tx.screenplayMembership.create({
        data: { screenplayId, userId: memberUserId, roleId },
        include: { role: { include: { permissions: true } } },
      });
    });
    return this.withUser(created);
  }

  async updateMembership(
    userId: string,
    screenplayId: string,
    membershipId: string,
    roleId: string,
    version: number,
  ) {
    const actor = await this.permissions.assert(userId, screenplayId, 'manage_member_roles');
    const membership = await this.prisma.screenplayMembership.findFirst({
      where: { id: membershipId, screenplayId },
      include: { role: true },
    });
    if (!membership) throw new NotFoundException('Membership or role not found');
    if (membership.role.isOwner) {
      throw new ConflictException('Use ownership transfer to change the owner membership');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      await lockScreenplayRoleLifecycle(this.db, tx, roleId);
      const role = await tx.screenplayRole.findFirst({
        where: { id: roleId, screenplayId, archivedAt: null },
        include: { permissions: true },
      });
      if (!role) throw new NotFoundException('Membership or role not found');
      if (role.isOwner) {
        throw new ConflictException('The owner role can only be assigned by transfer');
      }
      this.assertGrantable(
        actor.role.permissions,
        role.permissions.map((entry) => entry.permission),
      );
      const result = await tx.screenplayMembership.updateMany({
        where: { id: membershipId, screenplayId, version },
        data: { roleId, version: { increment: 1 } },
      });
      if (result.count === 0) {
        throw new ConflictException('Membership has changed; refresh and retry');
      }
      return tx.screenplayMembership.findUniqueOrThrow({
        where: { id: membershipId },
        include: { role: { include: { permissions: true } } },
      });
    });
    return this.withUser(updated);
  }

  async removeMembership(
    userId: string,
    screenplayId: string,
    membershipId: string,
    version: number,
  ) {
    await this.permissions.assert(userId, screenplayId, 'manage_member_roles');
    const membership = await this.prisma.screenplayMembership.findFirst({
      where: { id: membershipId, screenplayId },
      include: { role: true },
    });
    if (!membership) throw new NotFoundException('Membership not found');
    if (membership.role.isOwner) {
      throw new ConflictException('The screenplay owner cannot be removed');
    }
    if (membership.userId === userId) {
      throw new ConflictException('You cannot remove your own membership');
    }
    const removed = await this.prisma.screenplayMembership.deleteMany({
      where: { id: membershipId, screenplayId, version },
    });
    if (removed.count === 0) {
      throw new ConflictException('Membership has changed; refresh and retry');
    }
    return { id: membershipId };
  }

  async transferOwnership(
    userId: string,
    screenplayId: string,
    membershipId: string,
    version: number,
  ) {
    const actor = await this.permissions.membership(userId, screenplayId);
    if (!actor.role.isOwner) {
      throw new ConflictException('Only the current owner may transfer ownership');
    }
    return transferScreenplayOwnership(this.db, this.prisma, {
      userId,
      screenplayId,
      membershipId,
      actorMembershipId: actor.id,
      version,
    });
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

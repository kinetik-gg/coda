import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseCapabilities } from '../database/database-capabilities';
import { PrismaService } from '../prisma/prisma.service';
import { ScreenplayPermissionService } from './screenplay-permission.service';
import { issueScreenplayInvitation } from './screenplay-invitations';
import { transferScreenplayOwnership } from './screenplay-ownership';
import { lockScreenplayRoleLifecycle } from './screenplay-role-lifecycle';

/**
 * Membership, invitation, and ownership management for screenplays — the screenplay-scoped twin of
 * the project management surface (ADR: docs/adr-screenplay-access-control.md). Custom role CRUD is
 * intentionally out of scope; the seeded roles cover the parity requirement.
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
        roles: {
          where: { archivedAt: null },
          orderBy: { position: 'asc' },
          include: { permissions: true, _count: { select: { memberships: true } } },
        },
        memberships: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            version: true,
            createdAt: true,
            role: { select: { id: true, name: true, isOwner: true } },
            user: { select: { id: true, email: true, displayName: true, status: true } },
          },
        },
        invitations: {
          where: { status: 'PENDING', revokedAt: null },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            email: true,
            status: true,
            expiresAt: true,
            createdAt: true,
            role: { select: { id: true, name: true } },
            inviter: { select: { id: true, displayName: true } },
          },
        },
      },
    });
    if (!screenplay) throw new NotFoundException('Screenplay not found');
    return {
      ...screenplay,
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
    return this.prisma.user.findMany({
      where: { status: 'ACTIVE', screenplayMemberships: { none: { screenplayId } } },
      orderBy: [{ displayName: 'asc' }, { email: 'asc' }],
      select: { id: true, email: true, displayName: true, status: true },
    });
  }

  async addMembership(
    userId: string,
    screenplayId: string,
    memberUserId: string,
    roleId: string,
  ) {
    const actor = await this.permissions.assert(userId, screenplayId, 'invite_members');
    const [member, existing] = await Promise.all([
      this.prisma.user.findFirst({ where: { id: memberUserId, status: 'ACTIVE' } }),
      this.prisma.screenplayMembership.findUnique({
        where: { screenplayId_userId: { screenplayId, userId: memberUserId } },
      }),
    ]);
    if (!member) throw new NotFoundException('User or role not found');
    if (existing) throw new ConflictException('This user is already a screenplay member');

    return this.prisma.$transaction(async (tx) => {
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
        include: {
          role: { include: { permissions: true } },
          user: { select: { id: true, email: true, displayName: true, status: true } },
        },
      });
    });
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
    return this.prisma.$transaction(async (tx) => {
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
        include: {
          role: { include: { permissions: true } },
          user: { select: { id: true, email: true, displayName: true } },
        },
      });
    });
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

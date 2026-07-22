import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { type Permission, type ProjectTemplateId } from '@coda/contracts';
import { ActivityAction, type PrismaClient } from '@prisma/client';
import { rankBetween } from '../common/rank';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionService } from './permission.service';
import { createProject, defaultProjectRoles } from './project-creation';
import { projectExternalDetail } from './project-external-detail';
import { issueProjectInvitation } from './project-invitations';
import { transferProjectOwnership } from './project-ownership';
import { lockProjectRoleLifecycle } from './project-role-lifecycle';
import { projectTemplate, projectTemplates } from './project-templates';

type Transaction = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
  ) {}

  async list(userId: string) {
    const projects = await this.prisma.project.findMany({
      where: { deletedAt: null, memberships: { some: { userId } } },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        description: true,
        ownerUserId: true,
        version: true,
        revision: true,
        updatedAt: true,
        memberships: {
          where: { userId },
          take: 1,
          select: {
            id: true,
            role: { select: { id: true, name: true, permissions: true } },
          },
        },
      },
    });
    return projects.map(({ memberships, ...project }) => ({
      ...project,
      currentMembership: memberships[0] ?? null,
    }));
  }

  async creationOptions(userId: string) {
    const users = await this.prisma.user.findMany({
      where: { id: { not: userId }, status: 'ACTIVE' },
      orderBy: [{ displayName: 'asc' }, { email: 'asc' }],
      select: { id: true, email: true, displayName: true },
    });
    return {
      users,
      roles: defaultProjectRoles
        .filter((role) => !role.isOwner)
        .map((role) => ({ name: role.name })),
      templates: projectTemplates.map(({ id, name, description, levels }) => ({
        id,
        name,
        description,
        levels: levels.map(({ singularName, pluralName }) => ({ singularName, pluralName })),
      })),
    };
  }

  async get(userId: string, projectId: string) {
    await this.permissions.assert(userId, projectId, 'read_project');
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        entityTypes: {
          orderBy: { level: 'asc' },
          include: { _count: { select: { items: { where: { deletedAt: null } } } } },
        },
        roles: {
          where: { archivedAt: null },
          include: { permissions: true },
          orderBy: { position: 'asc' },
        },
        memberships: {
          include: { user: { select: { id: true, displayName: true } }, role: true },
        },
        sourceDocuments: {
          where: { deletedAt: null },
          include: { storageObject: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  async getExternal(userId: string, projectId: string) {
    await this.permissions.assert(userId, projectId, 'read_project');
    const project = await projectExternalDetail(this.prisma, projectId);
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  async management(userId: string, projectId: string) {
    const membership = await this.permissions.assert(userId, projectId, 'manage_project_settings');
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, deletedAt: null },
      select: {
        id: true,
        name: true,
        description: true,
        ownerUserId: true,
        version: true,
        revision: true,
        createdAt: true,
        updatedAt: true,
        entityTypes: {
          orderBy: { level: 'asc' },
          select: {
            id: true,
            parentTypeId: true,
            singularName: true,
            pluralName: true,
            displayPrefix: true,
            level: true,
            position: true,
            enabled: true,
            version: true,
            fields: {
              where: { deletedAt: null },
              orderBy: { position: 'asc' },
              select: {
                id: true,
                name: true,
                key: true,
                type: true,
                required: true,
                position: true,
                configuration: true,
                version: true,
                options: {
                  where: { archivedAt: null },
                  orderBy: { position: 'asc' },
                  select: {
                    id: true,
                    label: true,
                    color: true,
                    position: true,
                    archivedAt: true,
                  },
                },
              },
            },
            _count: { select: { items: { where: { deletedAt: null } } } },
          },
        },
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
        _count: {
          select: {
            items: { where: { deletedAt: null } },
            sourceDocuments: { where: { deletedAt: null } },
            storageObjects: { where: { deletedAt: null } },
          },
        },
      },
    });
    if (!project) throw new NotFoundException('Project not found');
    return {
      ...project,
      currentMembership: {
        id: membership.id,
        roleId: membership.roleId,
        permissions: membership.role.permissions.map((entry) => entry.permission),
      },
    };
  }

  async create(userId: string, input: { name: string; description?: string | null }) {
    return createProject(this.prisma, userId, input);
  }

  async createFromTemplate(
    userId: string,
    input: { name: string; description?: string | null; templateId: ProjectTemplateId },
  ) {
    return createProject(this.prisma, userId, input, projectTemplate(input.templateId));
  }

  async update(
    userId: string,
    projectId: string,
    input: { name?: string; description?: string | null; version: number },
  ) {
    await this.permissions.assert(userId, projectId, 'manage_project_settings');
    const result = await this.prisma.project.updateMany({
      where: { id: projectId, version: input.version, deletedAt: null },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        version: { increment: 1 },
        revision: { increment: 1 },
      },
    });
    if (result.count === 0) throw new ConflictException('Project has changed; refresh and retry');
    return this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  }

  async invite(userId: string, projectId: string, email: string, roleId: string) {
    const actor = await this.permissions.assert(userId, projectId, 'invite_members');
    return issueProjectInvitation(this.prisma, projectId, roleId, email, {
      userId,
      permissions: actor.role.permissions,
    });
  }

  async createRole(
    userId: string,
    projectId: string,
    input: { name: string; description?: string | null; permissions: Permission[] },
  ) {
    const actor = await this.permissions.assert(userId, projectId, 'manage_roles');
    this.assertGrantable(actor.role.permissions, input.permissions);
    const lastRole = await this.prisma.projectRole.findFirst({
      where: { projectId, archivedAt: null },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    return this.prisma.$transaction(async (tx) => {
      const role = await tx.projectRole.create({
        data: {
          projectId,
          name: input.name,
          description: input.description,
          position: rankBetween(lastRole?.position, null),
          permissions: {
            create: input.permissions.map((permission) => ({ permission })),
          },
        },
        include: { permissions: true },
      });
      await tx.project.update({
        where: { id: projectId },
        data: { revision: { increment: 1 } },
      });
      await this.activity(tx, projectId, userId, {
        action: ActivityAction.CREATED,
        resourceType: 'role',
        resourceId: role.id,
      });
      return role;
    });
  }

  async updateRole(
    userId: string,
    projectId: string,
    roleId: string,
    input: {
      name?: string;
      description?: string | null;
      permissions?: Permission[];
      version: number;
    },
  ) {
    const actor = await this.permissions.assert(userId, projectId, 'manage_roles');
    if (input.permissions) this.assertGrantable(actor.role.permissions, input.permissions);
    return this.prisma.$transaction(async (tx) => {
      const role = await tx.projectRole.findFirst({
        where: { id: roleId, projectId, archivedAt: null },
      });
      if (!role) throw new NotFoundException('Role not found');
      if (role.isOwner) throw new ConflictException('The owner role cannot be changed');
      const updated = await tx.projectRole.updateMany({
        where: { id: roleId, projectId, version: input.version, archivedAt: null, isOwner: false },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) throw new ConflictException('Role has changed; refresh and retry');
      if (input.permissions) {
        await tx.projectRolePermission.deleteMany({ where: { roleId } });
        await tx.projectRolePermission.createMany({
          data: input.permissions.map((permission) => ({ roleId, permission })),
        });
      }
      await tx.project.update({
        where: { id: projectId },
        data: { revision: { increment: 1 } },
      });
      await this.activity(tx, projectId, userId, {
        action: ActivityAction.UPDATED,
        resourceType: 'role',
        resourceId: roleId,
      });
      return tx.projectRole.findUniqueOrThrow({
        where: { id: roleId },
        include: { permissions: true },
      });
    });
  }

  async archiveRole(userId: string, projectId: string, roleId: string, version: number) {
    await this.permissions.assert(userId, projectId, 'manage_roles');
    return this.prisma.$transaction(async (tx) => {
      await lockProjectRoleLifecycle(tx, roleId);
      const role = await tx.projectRole.findFirst({
        where: { id: roleId, projectId, archivedAt: null },
        include: {
          _count: {
            select: {
              memberships: true,
              invitations: { where: { status: 'PENDING', revokedAt: null } },
              instanceInvitations: { where: { status: 'PENDING', revokedAt: null } },
            },
          },
        },
      });
      if (!role) throw new NotFoundException('Role not found');
      if (role.isOwner) throw new ConflictException('The owner role cannot be archived');
      if (
        role._count.memberships > 0 ||
        role._count.invitations > 0 ||
        role._count.instanceInvitations > 0
      ) {
        throw new ConflictException('Reassign members and revoke pending invitations first');
      }
      const archived = await tx.projectRole.updateMany({
        where: { id: roleId, projectId, version, archivedAt: null, isOwner: false },
        data: { archivedAt: new Date(), version: { increment: 1 } },
      });
      if (archived.count === 0) throw new ConflictException('Role has changed; refresh and retry');
      await tx.project.update({
        where: { id: projectId },
        data: { revision: { increment: 1 } },
      });
      await this.activity(tx, projectId, userId, {
        action: ActivityAction.DELETED,
        resourceType: 'role',
        resourceId: roleId,
      });
      return tx.projectRole.findUniqueOrThrow({
        where: { id: roleId },
        include: { permissions: true },
      });
    });
  }

  async updateMembership(
    userId: string,
    projectId: string,
    membershipId: string,
    roleId: string,
    version: number,
  ) {
    const actor = await this.permissions.assert(userId, projectId, 'manage_member_roles');
    const membership = await this.prisma.projectMembership.findFirst({
      where: { id: membershipId, projectId },
      include: { role: true },
    });
    if (!membership) throw new NotFoundException('Membership or role not found');
    if (membership.role.isOwner || membership.userId === actor.project.ownerUserId) {
      throw new ConflictException('Use ownership transfer to change the owner membership');
    }
    return this.prisma.$transaction(async (tx) => {
      await lockProjectRoleLifecycle(tx, roleId);
      const role = await tx.projectRole.findFirst({
        where: { id: roleId, projectId, archivedAt: null },
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
      const result = await tx.projectMembership.updateMany({
        where: { id: membershipId, projectId, version },
        data: { roleId, version: { increment: 1 } },
      });
      if (result.count === 0) {
        throw new ConflictException('Membership has changed; refresh and retry');
      }
      await tx.project.update({
        where: { id: projectId },
        data: { revision: { increment: 1 } },
      });
      await this.activity(tx, projectId, userId, {
        action: ActivityAction.UPDATED,
        resourceType: 'membership',
        resourceId: membershipId,
      });
      return tx.projectMembership.findUniqueOrThrow({
        where: { id: membershipId },
        include: {
          role: { include: { permissions: true } },
          user: { select: { id: true, email: true, displayName: true } },
        },
      });
    });
  }

  async availableUsers(userId: string, projectId: string) {
    await this.permissions.assert(userId, projectId, 'invite_members');
    return this.prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        memberships: { none: { projectId } },
      },
      orderBy: [{ displayName: 'asc' }, { email: 'asc' }],
      select: { id: true, email: true, displayName: true, status: true },
    });
  }

  async addMembership(userId: string, projectId: string, memberUserId: string, roleId: string) {
    const actor = await this.permissions.assert(userId, projectId, 'invite_members');
    const [member, existing] = await Promise.all([
      this.prisma.user.findFirst({ where: { id: memberUserId, status: 'ACTIVE' } }),
      this.prisma.projectMembership.findUnique({
        where: { projectId_userId: { projectId, userId: memberUserId } },
      }),
    ]);
    if (!member) throw new NotFoundException('User or role not found');
    if (existing) throw new ConflictException('This user is already a project member');

    return this.prisma.$transaction(async (tx) => {
      await lockProjectRoleLifecycle(tx, roleId);
      const role = await tx.projectRole.findFirst({
        where: { id: roleId, projectId, archivedAt: null },
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
      const membership = await tx.projectMembership.create({
        data: { projectId, userId: memberUserId, roleId },
        include: {
          role: { include: { permissions: true } },
          user: { select: { id: true, email: true, displayName: true, status: true } },
        },
      });
      await tx.project.update({
        where: { id: projectId },
        data: { revision: { increment: 1 } },
      });
      await this.activity(tx, projectId, userId, {
        action: ActivityAction.CREATED,
        resourceType: 'membership',
        resourceId: membership.id,
      });
      return membership;
    });
  }

  async removeMembership(userId: string, projectId: string, membershipId: string, version: number) {
    const actor = await this.permissions.assert(userId, projectId, 'manage_member_roles');
    const membership = await this.prisma.projectMembership.findFirst({
      where: { id: membershipId, projectId },
      include: { role: true },
    });
    if (!membership) throw new NotFoundException('Membership not found');
    if (membership.role.isOwner || membership.userId === actor.project.ownerUserId) {
      throw new ConflictException('The project owner cannot be removed');
    }
    if (membership.userId === userId) {
      throw new ConflictException('You cannot remove your own membership');
    }

    return this.prisma.$transaction(async (tx) => {
      const removed = await tx.projectMembership.deleteMany({
        where: { id: membershipId, projectId, version },
      });
      if (removed.count === 0) {
        throw new ConflictException('Membership has changed; refresh and retry');
      }
      await tx.project.update({
        where: { id: projectId },
        data: { revision: { increment: 1 } },
      });
      await this.activity(tx, projectId, userId, {
        action: ActivityAction.DELETED,
        resourceType: 'membership',
        resourceId: membershipId,
      });
      return { id: membershipId };
    });
  }

  async transferOwnership(
    userId: string,
    projectId: string,
    membershipId: string,
    version: number,
  ) {
    const actor = await this.permissions.membership(userId, projectId);
    if (actor.project.ownerUserId !== userId)
      throw new ConflictException('Only the current owner may transfer ownership');
    return transferProjectOwnership(this.prisma, {
      userId,
      projectId,
      membershipId,
      actorMembershipId: actor.id,
      version,
    });
  }

  private activity(
    tx: Transaction,
    projectId: string,
    actorId: string,
    event: { action: ActivityAction; resourceType: string; resourceId: string },
  ) {
    return tx.activityEvent.create({
      data: { projectId, actorId, ...event },
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

import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createToken, hashToken } from '../common/crypto';
import { PrismaService } from '../prisma/prisma.service';
import { assertInvitationProjectRoleAvailable } from '../projects/project-role-lifecycle';
import { ProjectRetentionService } from '../trash/project-retention.service';
import { InstanceSystemMetrics } from './instance-system-metrics';

interface ManagementListQuery {
  cursor?: string;
  limit: number;
  search?: string;
}

const SUMMARY_LIMIT = 50;

@Injectable()
export class InstanceManagementService {
  private readonly systemMetrics = new InstanceSystemMetrics();

  constructor(
    private readonly prisma: PrismaService,
    private readonly retention: ProjectRetentionService,
  ) {}

  async access(userId: string) {
    const settings = await this.prisma.instanceSettings.findFirst({
      select: { ownerUserId: true },
    });
    return { isAdministrator: settings?.ownerUserId === userId };
  }

  async summary(userId: string) {
    const settings = await this.assertAdministrator(userId);
    const [
      totalUsers,
      activeUsers,
      disabledUsers,
      activeProjects,
      trashedProjects,
      storage,
      trashedStorage,
      activeSessions,
      users,
      projects,
      storageItems,
      activities,
      pendingInvitations,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { status: 'ACTIVE' } }),
      this.prisma.user.count({ where: { status: 'DISABLED' } }),
      this.prisma.project.count({ where: { deletedAt: null } }),
      this.prisma.project.count({ where: { deletedAt: { not: null } } }),
      this.prisma.storageObject.aggregate({
        where: { deletedAt: null },
        _count: { id: true },
        _sum: { sizeBytes: true },
      }),
      this.prisma.storageObject.aggregate({
        where: { deletedAt: { not: null } },
        _count: { id: true },
        _sum: { sizeBytes: true },
      }),
      this.prisma.session.count({ where: { expiresAt: { gt: new Date() } } }),
      this.userList({ limit: SUMMARY_LIMIT }),
      this.projectList({ limit: SUMMARY_LIMIT }),
      this.storageList({ limit: SUMMARY_LIMIT }),
      this.activityList({ limit: SUMMARY_LIMIT }),
      this.prisma.instanceInvitation.count({
        where: {
          status: 'PENDING',
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
      }),
    ]);

    return {
      initializedAt: settings.initializedAt,
      owner: settings.owner,
      retentionDays: 30,
      counts: {
        users: totalUsers,
        activeUsers,
        disabledUsers,
        activeProjects,
        trashedProjects,
        activeSessions,
        storageObjects: storage._count.id,
        storageBytes: storage._sum.sizeBytes ?? 0n,
        trashedStorageObjects: trashedStorage._count.id,
        trashedStorageBytes: trashedStorage._sum.sizeBytes ?? 0n,
        pendingInvitations,
        jobs: 1,
      },
      system: this.systemMetrics.status(),
      jobs: [this.retention.status()],
      users: users.items,
      projects: projects.items,
      storageItems: storageItems.items,
      activities: activities.items,
      listLimits: {
        users: SUMMARY_LIMIT,
        projects: SUMMARY_LIMIT,
        storageItems: SUMMARY_LIMIT,
        activities: SUMMARY_LIMIT,
      },
    };
  }

  async liveStatus(userId: string) {
    await this.assertAdministrator(userId);
    return {
      system: this.systemMetrics.status(),
      jobs: [this.retention.status()],
    };
  }

  async users(userId: string, query: ManagementListQuery) {
    await this.assertAdministrator(userId);
    return this.userList(query);
  }

  async updateUserStatus(actorId: string, userId: string, status: 'ACTIVE' | 'DISABLED') {
    const settings = await this.assertAdministrator(actorId);
    if (status === 'DISABLED' && (userId === actorId || userId === settings.ownerUserId)) {
      throw new ConflictException('The instance administrator account cannot be disabled');
    }
    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!target) throw new NotFoundException('User not found');
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: userId },
        data: { status },
        select: {
          id: true,
          email: true,
          displayName: true,
          company: true,
          department: true,
          status: true,
          updatedAt: true,
        },
      });
      const revoked =
        status === 'DISABLED' ? await tx.session.deleteMany({ where: { userId } }) : { count: 0 };
      return { user, sessionsRevoked: revoked.count };
    });
  }

  async projectsList(userId: string, query: ManagementListQuery) {
    await this.assertAdministrator(userId);
    return this.projectList(query);
  }

  async storage(userId: string, query: ManagementListQuery) {
    await this.assertAdministrator(userId);
    return this.storageList(query);
  }

  async activities(userId: string, query: ManagementListQuery) {
    await this.assertAdministrator(userId);
    return this.activityList(query);
  }

  async jobs(userId: string) {
    await this.assertAdministrator(userId);
    return [this.retention.status()];
  }

  async invitationOptions(userId: string) {
    await this.assertAdministrator(userId);
    const projects = await this.prisma.project.findMany({
      where: { deletedAt: null },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        roles: {
          where: { archivedAt: null, isOwner: false },
          orderBy: [{ position: 'asc' }, { id: 'asc' }],
          select: { id: true, name: true },
        },
      },
    });
    return {
      delivery: 'manual_link' as const,
      defaultExpiry: 'never' as const,
      expiryChoices: [
        { id: 'never', label: 'Never expires' },
        { id: '30_days', label: '30 days' },
        { id: '7_days', label: '7 days' },
        { id: '24_hours', label: '24 hours' },
      ],
      projects,
    };
  }

  async invite(
    userId: string,
    input: {
      email: string;
      expiresIn: 'never' | '30_days' | '7_days' | '24_hours';
      projectId?: string | null;
      roleId?: string | null;
    },
  ) {
    await this.assertAdministrator(userId);
    const existingUser = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (existingUser) throw new ConflictException('A registered user already has this email');
    if (Boolean(input.projectId) !== Boolean(input.roleId)) {
      throw new ConflictException('Project and role must be selected together');
    }
    const token = createToken();
    const expiresAt = this.invitationExpiry(input.expiresIn);
    const invitation = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${'instance-invite:' + input.email.toLowerCase()}, 0))`,
      );
      await assertInvitationProjectRoleAvailable(tx, input.projectId, input.roleId);
      await tx.instanceInvitation.updateMany({
        where: { email: input.email, status: 'PENDING', revokedAt: null },
        data: { status: 'REVOKED', revokedAt: new Date() },
      });
      return tx.instanceInvitation.create({
        data: {
          email: input.email,
          tokenHash: hashToken(token),
          inviterId: userId,
          expiresAt,
          projectId: input.projectId ?? null,
          roleId: input.roleId ?? null,
        },
      });
    });
    return {
      id: invitation.id,
      email: invitation.email,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      projectId: invitation.projectId,
      roleId: invitation.roleId,
      invitationUrl: `/accept-invitation?token=${encodeURIComponent(token)}`,
    };
  }

  async invitations(userId: string, query: ManagementListQuery) {
    await this.assertAdministrator(userId);
    const items = await this.prisma.instanceInvitation.findMany({
      where: query.search ? { email: { contains: query.search, mode: 'insensitive' } } : undefined,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: query.limit + 1,
      select: {
        id: true,
        email: true,
        isReusable: true,
        status: true,
        expiresAt: true,
        acceptedAt: true,
        revokedAt: true,
        createdAt: true,
        inviter: { select: { id: true, displayName: true } },
        acceptedBy: { select: { id: true, displayName: true } },
        project: { select: { id: true, name: true } },
        role: { select: { id: true, name: true } },
        _count: { select: { redemptions: true } },
      },
    });
    const page = this.page(items, query.limit);
    const now = new Date();
    return {
      ...page,
      items: page.items.map((invitation) => ({
        ...invitation,
        redemptionCount: invitation._count.redemptions,
        _count: undefined,
        status:
          invitation.status === 'PENDING' &&
          invitation.expiresAt !== null &&
          invitation.expiresAt <= now
            ? ('EXPIRED' as const)
            : invitation.status,
      })),
    };
  }

  async bulkInvite(
    userId: string,
    input: {
      expiresIn: '30_days' | '7_days' | '24_hours';
      projectId?: string | null;
      roleId?: string | null;
    },
  ) {
    await this.assertAdministrator(userId);
    if (Boolean(input.projectId) !== Boolean(input.roleId)) {
      throw new ConflictException('Project and role must be selected together');
    }
    const token = createToken();
    const invitation = await this.prisma.$transaction(async (tx) => {
      await assertInvitationProjectRoleAvailable(tx, input.projectId, input.roleId);
      return tx.instanceInvitation.create({
        data: {
          email: null,
          isReusable: true,
          tokenHash: hashToken(token),
          inviterId: userId,
          expiresAt: this.invitationExpiry(input.expiresIn),
          projectId: input.projectId ?? null,
          roleId: input.roleId ?? null,
        },
      });
    });
    return {
      id: invitation.id,
      email: null,
      isReusable: true,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      projectId: invitation.projectId,
      roleId: invitation.roleId,
      redemptionCount: 0,
      invitationUrl: `/accept-invitation?token=${encodeURIComponent(token)}`,
    };
  }

  async revokeInvitation(userId: string, invitationId: string) {
    await this.assertAdministrator(userId);
    const result = await this.prisma.instanceInvitation.updateMany({
      where: { id: invitationId, status: 'PENDING', revokedAt: null },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    if (!result.count) throw new NotFoundException('Pending invitation not found');
    return { revoked: true };
  }

  private async assertAdministrator(userId: string) {
    const settings = await this.prisma.instanceSettings.findFirst({
      include: { owner: { select: { id: true, email: true, displayName: true } } },
    });
    if (!settings) throw new NotFoundException('Instance setup is incomplete');
    if (settings.ownerUserId !== userId) {
      throw new ForbiddenException('Only the instance administrator may manage the instance');
    }
    return settings;
  }

  private async userList(query: ManagementListQuery) {
    const items = await this.prisma.user.findMany({
      where: query.search
        ? {
            OR: [
              { displayName: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
              { company: { contains: query.search, mode: 'insensitive' } },
              { department: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : undefined,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: query.limit + 1,
      select: {
        id: true,
        email: true,
        displayName: true,
        company: true,
        department: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { memberships: true, sessions: true, ownedProjects: true } },
      },
    });
    return this.page(items, query.limit);
  }

  private async projectList(query: ManagementListQuery) {
    const items = await this.prisma.project.findMany({
      where: {
        deletedAt: null,
        ...(query.search ? { name: { contains: query.search, mode: 'insensitive' as const } } : {}),
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: query.limit + 1,
      select: {
        id: true,
        name: true,
        description: true,
        version: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
        owner: { select: { id: true, displayName: true, email: true } },
        _count: {
          select: {
            memberships: true,
            items: { where: { deletedAt: null } },
            storageObjects: { where: { deletedAt: null } },
            sourceDocuments: { where: { deletedAt: null } },
          },
        },
      },
    });
    return this.page(items, query.limit);
  }

  private async storageList(query: ManagementListQuery) {
    const items = await this.prisma.storageObject.findMany({
      where: query.search
        ? {
            OR: [
              { originalFilename: { contains: query.search, mode: 'insensitive' } },
              { mimeType: { contains: query.search, mode: 'insensitive' } },
              { project: { name: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : undefined,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: query.limit + 1,
      select: {
        id: true,
        kind: true,
        status: true,
        originalFilename: true,
        mimeType: true,
        sizeBytes: true,
        width: true,
        height: true,
        durationMs: true,
        createdAt: true,
        deletedAt: true,
        project: { select: { id: true, name: true, deletedAt: true } },
      },
    });
    return this.page(items, query.limit);
  }

  private async activityList(query: ManagementListQuery) {
    const items = await this.prisma.activityEvent.findMany({
      where: query.search
        ? {
            OR: [
              { resourceType: { contains: query.search, mode: 'insensitive' } },
              { project: { name: { contains: query.search, mode: 'insensitive' } } },
              { actor: { displayName: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : undefined,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: query.limit + 1,
      select: {
        id: true,
        action: true,
        resourceType: true,
        resourceId: true,
        metadata: true,
        createdAt: true,
        project: { select: { id: true, name: true, deletedAt: true } },
        actor: { select: { id: true, displayName: true } },
      },
    });
    const page = this.page(items, query.limit);
    return {
      ...page,
      items: page.items.map((item) => ({
        ...item,
        metadata: this.sanitizeAuditMetadata(item.metadata ?? null),
      })),
    };
  }

  private invitationExpiry(expiresIn: 'never' | '30_days' | '7_days' | '24_hours') {
    const duration = {
      never: null,
      '30_days': 30 * 86_400_000,
      '7_days': 7 * 86_400_000,
      '24_hours': 86_400_000,
    }[expiresIn];
    return duration === null ? null : new Date(Date.now() + duration);
  }

  private page<T extends { id: string }>(items: T[], limit: number) {
    const hasMore = items.length > limit;
    const pageItems = hasMore ? items.slice(0, limit) : items;
    return {
      items: pageItems,
      nextCursor: hasMore ? (pageItems.at(-1)?.id ?? null) : null,
    };
  }

  private sanitizeAuditMetadata(value: Prisma.JsonValue): Prisma.JsonValue {
    if (Array.isArray(value)) return value.map((entry) => this.sanitizeAuditMetadata(entry));
    if (value === null || typeof value !== 'object') return value;
    const redactedKeys = /email|password|secret|token|object_?key|path/i;
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !redactedKeys.test(key))
        .map(([key, entry]) => [key, this.sanitizeAuditMetadata(entry ?? null)]),
    ) as Prisma.JsonObject;
  }
}

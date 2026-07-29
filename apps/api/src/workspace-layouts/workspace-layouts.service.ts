import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { workspaceLayoutSchema, type WorkspaceLayout } from '@coda/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionService } from '../projects/permission.service';
import { MetricsService } from '../metrics/metrics.service';

function json(layout: WorkspaceLayout): Prisma.InputJsonValue {
  return layout as unknown as Prisma.InputJsonValue;
}

type LayoutClient = Pick<
  Prisma.TransactionClient,
  'projectUserWorkspaceLayout' | 'projectWorkspaceDefault'
>;

async function ensurePersonalLayout(client: LayoutClient, userId: string, projectId: string) {
  const publishedDefault = await client.projectWorkspaceDefault.findUnique({
    where: { projectId },
  });
  if (!publishedDefault) throw new NotFoundException('Workspace default not found');
  const personal = await client.projectUserWorkspaceLayout.upsert({
    where: { projectId_userId: { projectId, userId } },
    create: {
      projectId,
      userId,
      layout: publishedDefault.layout as Prisma.InputJsonValue,
      schemaVersion: publishedDefault.schemaVersion,
      basedOnDefaultRevision: publishedDefault.revision,
    },
    update: {},
  });
  return { personal, publishedDefault };
}

@Injectable()
export class WorkspaceLayoutsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly metrics: MetricsService,
  ) {}

  /** Records a layout-sync conflict on the metrics registry, then raises the 409. */
  private conflict(operation: 'save' | 'publish' | 'reset', detail: string): never {
    this.metrics.recordWorkspaceLayoutConflict(operation);
    throw new ConflictException(detail);
  }

  async get(userId: string, projectId: string) {
    const membership = await this.permissions.membership(userId, projectId);
    return this.prisma.$transaction(async (tx) => {
      const { personal, publishedDefault } = await ensurePersonalLayout(tx, userId, projectId);
      return {
        personal,
        default: publishedDefault,
        canPublish: membership.project.ownerUserId === userId,
      };
    });
  }

  async save(userId: string, projectId: string, layout: WorkspaceLayout, revision: number) {
    const membership = await this.permissions.membership(userId, projectId);
    const validated = workspaceLayoutSchema.parse(layout);
    return this.prisma.$transaction(async (tx) => {
      await ensurePersonalLayout(tx, userId, projectId);
      const data = {
        layout: json(validated),
        schemaVersion: validated.schemaVersion,
        revision: { increment: 1 },
      };
      const result = await tx.projectUserWorkspaceLayout.updateMany({
        where: { projectId, userId, revision },
        data,
      });
      if (!result.count) {
        this.conflict('save', 'Workspace layout has changed; refresh and retry');
      }
      await tx.projectMembershipWorkspaceLayout.updateMany({
        where: { membershipId: membership.id, revision },
        data,
      });
      return tx.projectUserWorkspaceLayout.findUniqueOrThrow({
        where: { projectId_userId: { projectId, userId } },
      });
    });
  }

  async reset(userId: string, projectId: string, revision: number) {
    const membership = await this.permissions.membership(userId, projectId);
    return this.prisma.$transaction(async (tx) => {
      const { publishedDefault } = await ensurePersonalLayout(tx, userId, projectId);
      const data = {
        layout: publishedDefault.layout as Prisma.InputJsonValue,
        schemaVersion: publishedDefault.schemaVersion,
        basedOnDefaultRevision: publishedDefault.revision,
        revision: { increment: 1 },
      };
      const result = await tx.projectUserWorkspaceLayout.updateMany({
        where: { projectId, userId, revision },
        data,
      });
      if (!result.count) {
        this.conflict('reset', 'Workspace layout has changed; refresh and retry');
      }
      await tx.projectMembershipWorkspaceLayout.updateMany({
        where: { membershipId: membership.id, revision },
        data,
      });
      return tx.projectUserWorkspaceLayout.findUniqueOrThrow({
        where: { projectId_userId: { projectId, userId } },
      });
    });
  }

  async publish(
    userId: string,
    projectId: string,
    personalRevision: number,
    defaultRevision: number,
  ) {
    const membership = await this.permissions.membership(userId, projectId);
    if (membership.project.ownerUserId !== userId) {
      throw new ForbiddenException('Only the current project owner may publish the default layout');
    }
    return this.prisma.$transaction(async (tx) => {
      await ensurePersonalLayout(tx, userId, projectId);
      const personal = await tx.projectUserWorkspaceLayout.findFirst({
        where: { projectId, userId, revision: personalRevision },
      });
      if (!personal) {
        this.conflict('publish', 'Personal workspace layout has changed; refresh and retry');
      }
      const validated = workspaceLayoutSchema.parse(personal.layout);
      const published = await tx.projectWorkspaceDefault.updateMany({
        where: { projectId, revision: defaultRevision },
        data: {
          layout: json(validated),
          schemaVersion: validated.schemaVersion,
          publishedById: userId,
          publishedAt: new Date(),
          revision: { increment: 1 },
        },
      });
      if (!published.count) {
        this.conflict('publish', 'Workspace default has changed; refresh and retry');
      }
      const owner = await tx.project.updateMany({
        where: { id: projectId, ownerUserId: userId, deletedAt: null },
        data: { revision: { increment: 1 } },
      });
      if (!owner.count) {
        throw new ForbiddenException(
          'Only the current project owner may publish the default layout',
        );
      }
      const current = await tx.projectWorkspaceDefault.findUniqueOrThrow({
        where: { projectId },
      });
      await tx.activityEvent.create({
        data: {
          projectId,
          actorId: userId,
          action: 'UPDATED',
          resourceType: 'workspace_default',
          resourceId: projectId,
          metadata: { revision: current.revision },
        },
      });
      return current;
    });
  }
}

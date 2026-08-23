import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { workspaceLayoutSchema, type WorkspaceLayout } from '@coda/contracts';
import { MetricsService } from '../metrics/metrics.service';
import { PrismaService } from '../prisma/prisma.service';
import { TrackerPermissionService } from './tracker-permission.service';
import { ensureTrackerWorkspaceDefault } from './default-tracker-workspace-layout';

function json(layout: WorkspaceLayout): Prisma.InputJsonValue {
  return layout as unknown as Prisma.InputJsonValue;
}

type TrackerLayoutClient = Pick<
  Prisma.TransactionClient,
  'trackerUserWorkspaceLayout' | 'trackerWorkspaceDefault'
>;

/**
 * Clones the canonical default into the caller's personal row on first access. The upsert's
 * empty `update` arm makes repeat access a no-op so a diverged personal layout is never
 * clobbered by re-reading. The user-keyed table carries plain `trackerId`/`userId` columns and
 * no relations — see the FK-free rationale on `TrackerUserWorkspaceLayout` in schema.prisma.
 */
async function ensurePersonalLayout(
  client: TrackerLayoutClient,
  userId: string,
  trackerId: string,
) {
  const publishedDefault = await ensureTrackerWorkspaceDefault(client, trackerId);
  const personal = await client.trackerUserWorkspaceLayout.upsert({
    where: { trackerId_userId: { trackerId, userId } },
    create: {
      trackerId,
      userId,
      layout: publishedDefault.layout as Prisma.InputJsonValue,
      schemaVersion: publishedDefault.schemaVersion,
    },
    update: {},
  });
  return { personal, publishedDefault };
}

/**
 * Tracker workspace layouts, cloning the breakdown twin (`workspace-layouts.service.ts`)
 * onto the tracker aggregate: a lazily seeded canonical default that members clone into a
 * personal row, CAS-on-revision saves/resets, and an owner-gated publish. Two structural
 * divergences from the twin: there is no membership-shared layout row (the tracker pair is
 * user-keyed only), and the publish gate is the `manage_tracker_settings` grant through the
 * single permission choke point instead of the project's `ownerUserId` check — tracker roles
 * express management authority through the permission graph (the same grant governs settings
 * updates and deletion), while every remaining mechanic (conflict metrics, double CAS, the
 * resource revision bump riding inside the publish transaction) mirrors the twin exactly.
 */
@Injectable()
export class TrackerWorkspaceLayoutsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: TrackerPermissionService,
    private readonly metrics: MetricsService,
  ) {}

  /** Records a layout-sync conflict on the metrics registry, then raises the 409. */
  private conflict(operation: 'save' | 'publish' | 'reset', detail: string): never {
    this.metrics.recordWorkspaceLayoutConflict(operation);
    throw new ConflictException(detail);
  }

  async get(userId: string, trackerId: string) {
    const membership = await this.permissions.assert(userId, trackerId, 'read_tracker');
    return this.prisma.$transaction(async (tx) => {
      const { personal, publishedDefault } = await ensurePersonalLayout(tx, userId, trackerId);
      const canPublish = membership.role.permissions.some(
        (entry) => entry.permission === 'manage_tracker_settings',
      );
      return { personal, default: publishedDefault, canPublish };
    });
  }

  async save(userId: string, trackerId: string, layout: WorkspaceLayout, revision: number) {
    await this.permissions.assert(userId, trackerId, 'read_tracker');
    const validated = workspaceLayoutSchema.parse(layout);
    return this.prisma.$transaction(async (tx) => {
      await ensurePersonalLayout(tx, userId, trackerId);
      const result = await tx.trackerUserWorkspaceLayout.updateMany({
        where: { trackerId, userId, revision },
        data: {
          layout: json(validated),
          schemaVersion: validated.schemaVersion,
          revision: { increment: 1 },
        },
      });
      if (!result.count) {
        this.conflict('save', 'Workspace layout has changed; refresh and retry');
      }
      return tx.trackerUserWorkspaceLayout.findUniqueOrThrow({
        where: { trackerId_userId: { trackerId, userId } },
      });
    });
  }

  async reset(userId: string, trackerId: string, revision: number) {
    await this.permissions.assert(userId, trackerId, 'read_tracker');
    return this.prisma.$transaction(async (tx) => {
      const { publishedDefault } = await ensurePersonalLayout(tx, userId, trackerId);
      const result = await tx.trackerUserWorkspaceLayout.updateMany({
        where: { trackerId, userId, revision },
        data: {
          layout: publishedDefault.layout as Prisma.InputJsonValue,
          schemaVersion: publishedDefault.schemaVersion,
          revision: { increment: 1 },
        },
      });
      if (!result.count) {
        this.conflict('reset', 'Workspace layout has changed; refresh and retry');
      }
      return tx.trackerUserWorkspaceLayout.findUniqueOrThrow({
        where: { trackerId_userId: { trackerId, userId } },
      });
    });
  }

  async publish(
    userId: string,
    trackerId: string,
    personalRevision: number,
    defaultRevision: number,
  ) {
    await this.permissions.assert(userId, trackerId, 'manage_tracker_settings');
    return this.prisma.$transaction(async (tx) => {
      await ensurePersonalLayout(tx, userId, trackerId);
      const personal = await tx.trackerUserWorkspaceLayout.findFirst({
        where: { trackerId, userId, revision: personalRevision },
      });
      if (!personal) {
        this.conflict('publish', 'Personal workspace layout has changed; refresh and retry');
      }
      const validated = workspaceLayoutSchema.parse(personal.layout);
      const published = await tx.trackerWorkspaceDefault.updateMany({
        where: { trackerId, revision: defaultRevision },
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
      // The twin bumps the project revision here to carry invalidation to clients; for trackers
      // the same bump doubles as the live-row guard — a trashed tracker aborts the publish.
      const live = await tx.tracker.updateMany({
        where: { id: trackerId, deletedAt: null },
        data: { version: { increment: 1 }, revision: { increment: 1 } },
      });
      if (!live.count) throw new NotFoundException('Tracker not found');
      return tx.trackerWorkspaceDefault.findUniqueOrThrow({ where: { trackerId } });
    });
  }
}

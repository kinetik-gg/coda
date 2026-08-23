import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CreateTracker, ListTrackersQuery, UpdateTracker } from '@coda/contracts';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TrackerActivityService } from './tracker-activity.service';
import { TrackerPermissionService } from './tracker-permission.service';
import { provisionTrackerAccess } from './tracker-roles';
import { TrackerSpacesService } from './tracker-spaces.service';

const trackerSelection = {
  id: true,
  ownerUserId: true,
  name: true,
  description: true,
  version: true,
  revision: true,
  createdAt: true,
  updatedAt: true,
} as const;

function knownError(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

@Injectable()
export class TrackersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: TrackerPermissionService,
    private readonly spaces: TrackerSpacesService,
    private readonly activity: TrackerActivityService,
  ) {}

  async list(userId: string, query: ListTrackersQuery) {
    // Memberships carry a plain `trackerId` (no relation onto Tracker), so resolve the caller's
    // tracker ids first, then page the trackers themselves.
    const memberships = await this.prisma.trackerMembership.findMany({
      where: { userId },
      select: { trackerId: true },
    });
    const directIds = memberships.map((membership) => membership.trackerId);
    const accessibleIds = await this.spaces.listAccessibleIds(userId, directIds, query.spaceId);
    return this.prisma.tracker.findMany({
      where: { id: { in: accessibleIds }, deletedAt: null },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: trackerSelection,
    });
  }

  async create(userId: string, input: CreateTracker) {
    const spaceId = await this.spaces.authorizeTarget(userId, input.spaceId);
    return this.serializable(async (transaction) => {
      const created = await transaction.tracker.create({
        data: {
          ownerUserId: userId,
          name: input.name,
          description: input.description ?? null,
        },
        select: trackerSelection,
      });
      // A new tracker is provisioned with the seeded role graph and an owner-role membership so
      // the owner is resolved through the same membership path as every other member.
      await provisionTrackerAccess(transaction, created.id, userId);
      await this.spaces.place(transaction, created.id, spaceId);
      await this.activity.created(created.id, userId, transaction);
      return created;
    });
  }

  async get(userId: string, trackerId: string) {
    // `assert` returns the caller's membership; its role permissions are surfaced as `access` so
    // the client can render permission-aware states (a read-only member sees a read-only grid)
    // without hitting a management surface.
    const membership = await this.permissions.assert(userId, trackerId, 'read_tracker');
    const tracker = await this.prisma.tracker.findFirst({
      where: { id: trackerId, deletedAt: null },
      select: trackerSelection,
    });
    if (!tracker) throw new NotFoundException('Tracker not found');
    return {
      ...tracker,
      access: { permissions: membership.role.permissions.map((entry) => entry.permission) },
    };
  }

  async update(userId: string, trackerId: string, input: UpdateTracker) {
    await this.permissions.assert(userId, trackerId, 'manage_tracker_settings');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.tracker.update({
          where: { id: trackerId, version: input.version, deletedAt: null },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            version: { increment: 1 },
            revision: { increment: 1 },
          },
          select: trackerSelection,
        });
        // A rename is feed-worthy; a description-only edit stays off the activity feed.
        if (input.name !== undefined) await this.activity.renamed(trackerId, userId, tx);
        return updated;
      });
    } catch (error) {
      return this.handleUpdateFailure(error, trackerId);
    }
  }

  /**
   * Soft-deletes a tracker: the deletion triple plus version/revision bumps. Restore and purge are
   * deliberately out of scope until the trash surface lands (epic #386, S11); pending tracker
   * invitation revocation rides with that work too, since nothing can join before it then.
   * Authorization mirrors screenplay trash: `manage_tracker_settings` held by DIRECT membership
   * only — Space reach grants working access to contents, never the authority to destroy them.
   */
  async remove(userId: string, trackerId: string) {
    const membership = await this.permissions.directManagementMembership(userId, trackerId);
    const canManage = membership.role.permissions.some(
      (entry) => entry.permission === 'manage_tracker_settings',
    );
    if (!canManage) throw new ForbiddenException('Missing permission: manage_tracker_settings');
    const deletedAt = new Date();
    const batch = randomUUID();
    return this.serializable(async (transaction) => {
      const result = await transaction.tracker.updateMany({
        where: { id: trackerId, deletedAt: null },
        data: {
          deletedAt,
          deletedById: userId,
          deletionBatchId: batch,
          version: { increment: 1 },
          revision: { increment: 1 },
        },
      });
      if (!result.count) throw new NotFoundException('Tracker not found');
      await this.activity.deleted(trackerId, userId, transaction);
      return { id: trackerId, deletedAt, deletionBatchId: batch };
    });
  }

  /**
   * Serializable-retry wrapper mirroring the screenplay service's: P2034 (write conflict) and
   * P2002 (unique violation, e.g. a concurrent Space placement of the same resource id) are worth
   * one transparent replay inside the same request; exhausting the attempts is a client-visible
   * conflict rather than a 500.
   */
  private async serializable<T>(
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (!knownError(error, 'P2034') && !knownError(error, 'P2002')) throw error;
        if (attempt === 2) {
          throw new ConflictException('Tracker changed concurrently; retry the request');
        }
      }
    }
    throw new ConflictException('Tracker operation could not be completed');
  }

  private async handleUpdateFailure(error: unknown, trackerId: string): Promise<never> {
    if (!knownError(error, 'P2025')) throw error;
    const tracker = await this.prisma.tracker.findFirst({
      where: { id: trackerId, deletedAt: null },
      select: { id: true },
    });
    if (!tracker) throw new NotFoundException('Tracker not found');
    throw new ConflictException('Tracker was modified by another session');
  }
}

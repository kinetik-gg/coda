import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { TrackerPermissionService } from '../trackers/tracker-permission.service';
import { TrackersService } from '../trackers/trackers.service';
import {
  listTrashedTrackers,
  purgeExpiredTrackers,
  purgeTracker,
  restoreTracker,
} from './trash-tracker';

/**
 * Tracker trash lifecycle, authorized through {@link TrackerPermissionService} so it obeys the
 * tracker access convention: trash/restore/purge require `manage_tracker_settings` held by DIRECT
 * membership — a Space-tier manager is refused like a non-member (`404` from
 * `directManagementMembership`, which only ever resolves a direct `TrackerMembership` row), and a
 * member whose role lacks the permission is refused `403`. `restore`/`purge` resolve while trashed
 * because membership persists through soft-delete: they authorize through
 * {@link TrackerPermissionService.directManagementMembership}, which — unlike the choke point —
 * does not gate on `deletedAt`, since the whole point is to act on a tracker that is already
 * soft-deleted. The list is owner-scoped ("trackers I own that are trashed") and
 * `purgeExpiredTrackers` is the unauthenticated retention sweep run by the scheduler.
 *
 * Trash itself reconciles with S4 rather than duplicating it: the soft-delete triple, activity
 * event, and pending-invitation revocation live in {@link TrackersService.remove}; this wrapper
 * contributes what S4 could not do alone — the realtime eviction that forces every connected
 * socket out of the tracker room, exactly like the screenplay trash surface.
 */
@Injectable()
export class TrackerTrashService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: TrackerPermissionService,
    private readonly trackers: TrackersService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async trash(userId: string, trackerId: string) {
    const result = await this.trackers.remove(userId, trackerId);
    // Eviction signal: a trashed tracker must reject a socket exactly like a non-member (404 on
    // the next join), so anyone still connected from before the trash is forced out now rather
    // than being able to keep polling a document nobody else can reach.
    void this.realtime.evictTracker(trackerId);
    return result;
  }

  async restore(userId: string, trackerId: string) {
    await this.assertTrashedManagement(userId, trackerId);
    return restoreTracker(this.prisma, trackerId);
  }

  async purge(userId: string, trackerId: string) {
    await this.assertTrashedManagement(userId, trackerId);
    return purgeTracker(this.prisma, trackerId);
  }

  async listTrashed(userId: string) {
    return listTrashedTrackers(this.prisma, userId);
  }

  async purgeExpiredTrackers(now = new Date()): Promise<number> {
    return purgeExpiredTrackers(this.prisma, now);
  }

  // `restore`/`purge` act on an already-trashed tracker, so they cannot route through the
  // permission choke point: `assert` 404s a soft-deleted tracker by design.
  // `directManagementMembership` is the direct-membership-only equivalent that does not gate on
  // `deletedAt`.
  private async assertTrashedManagement(userId: string, trackerId: string): Promise<void> {
    const membership = await this.permissions.directManagementMembership(userId, trackerId);
    if (
      !membership.role.permissions.some((entry) => entry.permission === 'manage_tracker_settings')
    ) {
      throw new ForbiddenException('Missing permission: manage_tracker_settings');
    }
  }
}

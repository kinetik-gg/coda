import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { ScreenplayPermissionService } from '../screenplays/screenplay-permission.service';
import {
  listTrashedScreenplays,
  purgeExpiredScreenplays,
  purgeScreenplay,
  restoreScreenplay,
  trashScreenplay,
} from './trash-screenplay';

/**
 * Screenplay trash lifecycle, authorized through {@link ScreenplayPermissionService} so it obeys the
 * access-control convention (ADR: docs/adr-screenplay-access-control.md): trash/restore/purge require
 * `manage_screenplay_settings` (owner + admin) — a read-only member is refused `403` and a
 * non-member `404`, so the sole-owner semantics #148 shipped are never loosened. `restore`/`purge`
 * resolve while trashed because membership persists through soft-delete: they authorize through
 * {@link ScreenplayPermissionService.directManagementMembership}, which — unlike `assert` — does
 * not gate on `deletedAt` (#263), since the whole point of `restore`/`purge` is to act on a
 * screenplay that is already soft-deleted. The list is owner-scoped
 * ("screenplays I own that are trashed") and `purgeExpiredScreenplays` is the unauthenticated
 * retention sweep run by the scheduler.
 */
@Injectable()
export class ScreenplayTrashService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: ScreenplayPermissionService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async trashScreenplay(userId: string, screenplayId: string) {
    await this.assertDirectManagement(userId, screenplayId);
    const result = await trashScreenplay(this.prisma, userId, screenplayId);
    // Eviction signal: a trashed screenplay must reject a socket exactly like a non-member (404 on
    // the next join), so anyone still connected from before the trash is forced out now rather than
    // being able to keep publishing to a document nobody else can reach.
    void this.realtime.evictScreenplay(screenplayId);
    return result;
  }

  async restoreScreenplay(userId: string, screenplayId: string) {
    await this.assertTrashedManagement(userId, screenplayId);
    return restoreScreenplay(this.prisma, screenplayId);
  }

  async purgeScreenplay(userId: string, screenplayId: string) {
    await this.assertTrashedManagement(userId, screenplayId);
    return purgeScreenplay(this.prisma, screenplayId);
  }

  async listTrashedScreenplays(userId: string) {
    return listTrashedScreenplays(this.prisma, userId);
  }

  async purgeExpiredScreenplays(now = new Date()): Promise<number> {
    return purgeExpiredScreenplays(this.prisma, now);
  }

  private async assertDirectManagement(userId: string, screenplayId: string): Promise<void> {
    const membership = await this.permissions.assert(
      userId,
      screenplayId,
      'manage_screenplay_settings',
    );
    if ('spaceId' in membership) {
      throw new ForbiddenException('Space access cannot delete a screenplay');
    }
  }

  // `restore`/`purge` act on an already-trashed screenplay, so — unlike `trashScreenplay` above —
  // they cannot route through `assert`: the choke point 404s a soft-deleted screenplay by design
  // (#263). `directManagementMembership` is the direct-membership-only equivalent that does not
  // gate on `deletedAt`.
  private async assertTrashedManagement(userId: string, screenplayId: string): Promise<void> {
    const membership = await this.permissions.directManagementMembership(userId, screenplayId);
    if (
      !membership.role.permissions.some(
        (entry) => entry.permission === 'manage_screenplay_settings',
      )
    ) {
      throw new ForbiddenException('Missing permission: manage_screenplay_settings');
    }
  }
}

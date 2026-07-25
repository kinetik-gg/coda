import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
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
 * resolve while trashed because membership persists through soft-delete. The list is owner-scoped
 * ("screenplays I own that are trashed") and `purgeExpiredScreenplays` is the unauthenticated
 * retention sweep run by the scheduler.
 */
@Injectable()
export class ScreenplayTrashService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: ScreenplayPermissionService,
  ) {}

  async trashScreenplay(userId: string, screenplayId: string) {
    await this.permissions.assert(userId, screenplayId, 'manage_screenplay_settings');
    return trashScreenplay(this.prisma, userId, screenplayId);
  }

  async restoreScreenplay(userId: string, screenplayId: string) {
    await this.permissions.assert(userId, screenplayId, 'manage_screenplay_settings');
    return restoreScreenplay(this.prisma, screenplayId);
  }

  async purgeScreenplay(userId: string, screenplayId: string) {
    await this.permissions.assert(userId, screenplayId, 'manage_screenplay_settings');
    return purgeScreenplay(this.prisma, screenplayId);
  }

  async listTrashedScreenplays(userId: string) {
    return listTrashedScreenplays(this.prisma, userId);
  }

  async purgeExpiredScreenplays(now = new Date()): Promise<number> {
    return purgeExpiredScreenplays(this.prisma, now);
  }
}

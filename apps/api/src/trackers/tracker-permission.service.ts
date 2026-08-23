import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { TrackerPermission } from '@coda/contracts';
import { RequestAuthContext } from '../auth/request-auth-context';
import { PrismaService } from '../prisma/prisma.service';
import { spaceResourceRegistry } from '../spaces/space-resource-registry';
import { SpaceResourcesService } from '../spaces/space-resources.service';

/**
 * The single permission choke point for trackers, structurally identical to the screenplay twin
 * (`ScreenplayPermissionService`): a non-member sees `404` (tenant isolation — the tracker must
 * not be observable), a member whose role lacks the permission sees `403`. Access arrives from two
 * directions and resolves in this order — a direct `TrackerMembership` role grant, or a Space-tier
 * fallback projected through `spaceResourceRegistry.tracker.tierPermissions`.
 *
 * API credentials cannot scope to trackers (they are project-bound and are not Space members), so
 * any request arriving on a credential is treated as a non-member — no credential can silently
 * reach a tracker until credential scoping ships.
 */
@Injectable()
export class TrackerPermissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authContext: RequestAuthContext,
    private readonly spaceResources?: SpaceResourcesService,
  ) {}

  async membership(userId: string, trackerId: string) {
    if (this.authContext.credential()) throw new NotFoundException('Tracker not found');
    // The membership carries a plain `trackerId` column (no relation onto the core Tracker table —
    // see the appended-table backup convention in schema.prisma); callers that need the tracker row
    // (owner, deletedAt) fetch it separately.
    const [directMembership, tracker] = await Promise.all([
      this.prisma.trackerMembership.findUnique({
        where: { trackerId_userId: { trackerId, userId } },
        include: { role: { include: { permissions: true } } },
      }),
      this.prisma.tracker.findUnique({
        where: { id: trackerId },
        select: { id: true, deletedAt: true },
      }),
    ]);
    if (directMembership && !directMembership.role.archivedAt && tracker && !tracker.deletedAt) {
      return directMembership;
    }

    const spaceMembership = this.spaceResources
      ? await this.spaceResources.resolveActiveMembership(userId, 'tracker', trackerId)
      : null;
    if (!spaceMembership || !tracker || tracker.deletedAt) {
      throw new NotFoundException('Tracker not found');
    }
    const permissions = spaceResourceRegistry.tracker
      .tierPermissions(spaceMembership.role.resourceTier)
      .map((permission) => ({ permission }));
    return {
      ...spaceMembership,
      trackerId,
      role: { ...spaceMembership.role, isOwner: false, permissions },
    };
  }

  async assert(userId: string, trackerId: string, permission: TrackerPermission) {
    const membership = await this.membership(userId, trackerId);
    if (!membership.role.permissions.some((entry) => entry.permission === permission)) {
      throw new ForbiddenException(`Missing permission: ${permission}`);
    }
    return membership;
  }

  /**
   * Direct-membership check that deliberately does NOT gate on the tracker's `deletedAt` — unlike
   * {@link membership}/{@link assert}, later trash work (restore/purge, epic #386) legitimately
   * needs to authorize against a tracker that is already soft-deleted, because membership persists
   * through trash. This mirrors how the screenplay twin's `directManagementMembership` serves
   * `ScreenplayTrashService` rather than special-casing the choke point itself. Space-projected
   * reach is out of scope by construction: only a direct membership row can manage a tracker's
   * deletion lifecycle.
   */
  async directManagementMembership(userId: string, trackerId: string) {
    if (this.authContext.credential()) throw new NotFoundException('Tracker not found');
    const directMembership = await this.prisma.trackerMembership.findUnique({
      where: { trackerId_userId: { trackerId, userId } },
      include: { role: { include: { permissions: true } } },
    });
    if (!directMembership || directMembership.role.archivedAt) {
      throw new NotFoundException('Tracker not found');
    }
    return directMembership;
  }
}

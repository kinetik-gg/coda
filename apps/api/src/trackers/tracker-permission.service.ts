import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { TrackerPermission } from '@coda/contracts';
import type { AuthenticatedCredential } from '../auth/request-auth-context';
import { RequestAuthContext } from '../auth/request-auth-context';
import { PrismaService } from '../prisma/prisma.service';
import { spaceResourceRegistry } from '../spaces/space-resource-registry';
import { SpaceResourcesService } from '../spaces/space-resources.service';

/**
 * The single permission choke point for trackers, structurally identical to the screenplay twin
 * (`ScreenplayPermissionService`): a non-member sees `404` (tenant isolation — the tracker must
 * not be observable), a member whose role lacks the permission sees `403`. Access arrives from
 * three directions and resolves in this order — a tracker-scoped credential bound to THIS tracker
 * (its granted permissions are the authority; no membership or Space fallback exists for it), a
 * direct `TrackerMembership` role grant, or a Space-tier fallback projected through
 * `spaceResourceRegistry.tracker.tierPermissions`.
 *
 * Credentials bound to a DIFFERENT tracker — and project-scoped credentials, which can never
 * address a tracker — still see `404`: a credential resolves exactly one resource, the one it
 * was minted for.
 */
@Injectable()
export class TrackerPermissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authContext: RequestAuthContext,
    private readonly spaceResources?: SpaceResourcesService,
  ) {}

  async membership(userId: string, trackerId: string) {
    const credential = this.authContext.credential();
    if (credential) return this.credentialMembership(credential, userId, trackerId);
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

  /**
   * A credential's grants resolve directly from the token itself — no membership row, no role
   * graph, no Space tier. A credential aimed at another tracker (or at a project) must not even
   * reveal that this tracker exists, so it takes the same `404` a stranger would.
   */
  private credentialMembership(
    credential: AuthenticatedCredential,
    userId: string,
    trackerId: string,
  ) {
    if (
      credential.resourceType !== 'tracker' ||
      credential.trackerId !== trackerId ||
      credential.userId !== userId
    ) {
      throw new NotFoundException('Tracker not found');
    }
    return {
      id: credential.id,
      // A credential resolves no role row: its grants travel inside the token.
      roleId: null,
      userId: credential.userId,
      trackerId,
      role: {
        archivedAt: null,
        isOwner: false,
        permissions: credential.permissions.map((permission) => ({ permission })),
      },
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
   * The comment gate for record comments, mirroring the breakdown comment permission (`comment`)
   * rather than inventing a new authority split. The breakdown matrix — direct owner/admin/editor
   * may comment while a direct viewer stays read-only, and Space reach grants commenting from the
   * viewer tier up — maps onto the tracker vocabulary as `edit_tracker_records OR
   * comment_tracker`, because roles can never hold the tier-grant-only `comment_tracker` (see
   * tracker-permissions.ts) and the tier table grants it from the viewer tier up. Both halves are
   * needed: an assert of `comment_tracker` alone would lock every direct member out of their own
   * tracker's comments.
   */
  async assertCommenter(userId: string, trackerId: string) {
    const membership = await this.membership(userId, trackerId);
    const granted = new Set(membership.role.permissions.map((entry) => entry.permission));
    if (!granted.has('comment_tracker') && !granted.has('edit_tracker_records')) {
      throw new ForbiddenException('Missing permission: comment_tracker');
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
   * deletion lifecycle — and so is credential reach: the management/trash family stays
   * session-only (no tracker-credential allowlist entry admits it), so a credential of any scope
   * is refused before the membership lookup.
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

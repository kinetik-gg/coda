import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { ScreenplayPermission } from '@coda/contracts';
import { RequestAuthContext } from '../auth/request-auth-context';
import { PrismaService } from '../prisma/prisma.service';
import { spaceResourceRegistry } from '../spaces/space-resource-registry';
import { SpaceResourcesService } from '../spaces/space-resources.service';

/**
 * The single permission choke point for screenplays, structurally identical to the project
 * {@link PermissionService}: a non-member sees `404` (tenant isolation — the screenplay must not be
 * observable), a member whose role lacks the permission sees `403`.
 *
 * API credentials cannot yet scope to screenplays (ADR: docs/adr-screenplay-access-control.md), so
 * any request arriving on a credential is treated as a non-member — no credential can silently
 * reach a screenplay until credential scoping ships.
 */
@Injectable()
export class ScreenplayPermissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authContext: RequestAuthContext,
    private readonly spaceResources?: SpaceResourcesService,
  ) {}

  async membership(userId: string, screenplayId: string) {
    if (this.authContext.credential()) throw new NotFoundException('Screenplay not found');
    // The membership carries a plain `screenplayId` column (no relation onto the core Screenplay
    // table — see the appended-table backup convention in schema.prisma); callers that need the
    // screenplay row (owner, deletedAt) fetch it separately.
    const directMembership = await this.prisma.screenplayMembership.findUnique({
      where: { screenplayId_userId: { screenplayId, userId } },
      include: { role: { include: { permissions: true } } },
    });
    if (directMembership && !directMembership.role.archivedAt) return directMembership;

    const spaceMembership = this.spaceResources
      ? await this.spaceResources.resolveActiveMembership(userId, 'screenplay', screenplayId)
      : null;
    if (!spaceMembership) {
      throw new NotFoundException('Screenplay not found');
    }
    const permissions = spaceResourceRegistry.screenplay
      .tierPermissions(spaceMembership.role.resourceTier)
      .map((permission) => ({ permission }));
    return {
      ...spaceMembership,
      screenplayId,
      role: { ...spaceMembership.role, isOwner: false, permissions },
    };
  }

  async assert(userId: string, screenplayId: string, permission: ScreenplayPermission) {
    const membership = await this.membership(userId, screenplayId);
    if (!membership.role.permissions.some((entry) => entry.permission === permission)) {
      throw new ForbiddenException(`Missing permission: ${permission}`);
    }
    return membership;
  }
}

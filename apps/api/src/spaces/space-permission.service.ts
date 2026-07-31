import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { SpacePermission } from '@coda/contracts';
import { RequestAuthContext } from '../auth/request-auth-context';
import { PrismaService } from '../prisma/prisma.service';
import { resolveDefaultSpaceAuthority } from './default-space-authority';
import { DEFAULT_SPACE_ID } from './space-constants';

/**
 * The single permission choke point for Spaces. A non-member receives `404` so a Space is never
 * observable across tenants; a member without the requested permission receives `403`.
 *
 * The Default Space is the one exception, because it is the one Space whose existence is not a
 * secret: it has a fixed id, every instance has exactly one, and every unplaced resource resolves
 * to it. It also has zero memberships by construction, so the lookup below can never succeed for
 * it — which is why its settings were unreachable for everyone on every instance (#334).
 * `resolveDefaultSpaceAuthority` supplies the standing instead (see that module for the rule and
 * why it grants no new resource access), and a caller who is not that authority gets an honest
 * `403` rather than a `404` pretending the always-present container is not there.
 *
 * API credentials are project-scoped. Until credentials can be explicitly scoped to a Space,
 * treating one as a member would silently grant it access beyond the project it represents.
 */
@Injectable()
export class SpacePermissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authContext: RequestAuthContext,
  ) {}

  async membership(userId: string, spaceId: string) {
    if (this.authContext.credential()) throw new NotFoundException('Space not found');
    const membership = await this.prisma.spaceMembership.findUnique({
      where: { spaceId_userId: { spaceId, userId } },
      include: { role: { include: { permissions: true } }, space: true },
    });
    if (!membership || membership.space.deletedAt || membership.role.archivedAt) {
      if (spaceId !== DEFAULT_SPACE_ID) throw new NotFoundException('Space not found');
      const authority = await resolveDefaultSpaceAuthority(this.prisma, userId);
      if (!authority) {
        throw new ForbiddenException(
          'The Default Space is administered by the instance administrator',
        );
      }
      return authority;
    }
    return membership;
  }

  async assert(userId: string, spaceId: string, permission: SpacePermission) {
    const membership = await this.membership(userId, spaceId);
    if (!membership.role.permissions.some((entry) => entry.permission === permission)) {
      throw new ForbiddenException(`Missing permission: ${permission}`);
    }
    return membership;
  }

  assertSession(): void {
    if (this.authContext.credential()) throw new NotFoundException('Space not found');
  }
}

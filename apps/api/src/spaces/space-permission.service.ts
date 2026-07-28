import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { SpacePermission } from '@coda/contracts';
import { RequestAuthContext } from '../auth/request-auth-context';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The single permission choke point for Spaces. A non-member receives `404` so a Space is never
 * observable across tenants; a member without the requested permission receives `403`.
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
      throw new NotFoundException('Space not found');
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

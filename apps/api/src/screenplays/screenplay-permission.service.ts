import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { ScreenplayPermission } from '@coda/contracts';
import { RequestAuthContext } from '../auth/request-auth-context';
import { PrismaService } from '../prisma/prisma.service';

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
  ) {}

  async membership(userId: string, screenplayId: string) {
    if (this.authContext.credential()) throw new NotFoundException('Screenplay not found');
    const membership = await this.prisma.screenplayMembership.findUnique({
      where: { screenplayId_userId: { screenplayId, userId } },
      include: { role: { include: { permissions: true } }, screenplay: true },
    });
    if (!membership || membership.role.archivedAt)
      throw new NotFoundException('Screenplay not found');
    return membership;
  }

  async assert(userId: string, screenplayId: string, permission: ScreenplayPermission) {
    const membership = await this.membership(userId, screenplayId);
    if (!membership.role.permissions.some((entry) => entry.permission === permission)) {
      throw new ForbiddenException(`Missing permission: ${permission}`);
    }
    return membership;
  }
}

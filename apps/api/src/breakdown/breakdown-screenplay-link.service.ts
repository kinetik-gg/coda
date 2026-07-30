import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { BreakdownScreenplayLinkState, BreakdownScreenplayLinkView } from '@coda/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionService } from '../projects/permission.service';
import { ScreenplayPermissionService } from '../screenplays/screenplay-permission.service';

/**
 * The permission a breakdown member needs to choose which screenplay the breakdown follows.
 * `manage_source_documents` already governs "what source material is this breakdown built from",
 * and the Space `contributor` tier grants it, so a contributor can link without being handed
 * project-settings authority.
 */
const LINK_PERMISSION = 'manage_source_documents' as const;

type LinkRow = {
  projectId: string;
  screenplayId: string;
  createdById: string;
  updatedById: string;
  createdAt: Date;
  updatedAt: Date;
};

type LinkedScreenplay = BreakdownScreenplayLinkView['screenplay'];

function view(row: LinkRow, screenplay: LinkedScreenplay): BreakdownScreenplayLinkView {
  return {
    projectId: row.projectId,
    screenplayId: row.screenplayId,
    createdById: row.createdById,
    updatedById: row.updatedById,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    screenplay,
  };
}

/**
 * Owns `breakdown_screenplay_links`: the one screenplay a breakdown follows (issue #238).
 *
 * Two properties are load-bearing and must survive every future change here.
 *
 * 1. **Nothing in this service reads or writes `ItemSourceReference`, `SourceDocument`, or
 *    `StorageObject`.** The link is a sidecar. Linking or unlinking therefore cannot alter the
 *    ordered resolution of any pre-existing PDF source reference; that equivalence holds by
 *    construction rather than by test.
 * 2. **The link row carries no foreign key onto `projects`, `screenplays`, or `users`** (the
 *    N-1 `pg_restore --clean` convention). Every read must therefore re-validate the plain
 *    `screenplayId` against the live screenplay graph, and every purge path must delete link rows
 *    explicitly — no cascade will do it.
 */
@Injectable()
export class BreakdownScreenplayLinkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly screenplayPermissions: ScreenplayPermissionService,
  ) {}

  /**
   * Resolves the linked screenplay for display, or `null` when the caller cannot see it, it is in
   * trash, or it has already been purged. A dangling link is reported rather than hidden so the
   * breakdown can offer to clear it.
   */
  private async readableScreenplay(
    userId: string,
    screenplayId: string,
  ): Promise<LinkedScreenplay> {
    try {
      await this.screenplayPermissions.assert(userId, screenplayId, 'read_screenplay');
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) return null;
      throw error;
    }
    const screenplay = await this.prisma.screenplay.findFirst({
      where: { id: screenplayId, deletedAt: null },
      select: { id: true, title: true, filename: true, version: true },
    });
    return screenplay ?? null;
  }

  async get(userId: string, projectId: string): Promise<BreakdownScreenplayLinkState> {
    const membership = await this.permissions.assert(userId, projectId, 'read_project');
    const canLink = membership.role.permissions.some(
      (entry) => entry.permission === LINK_PERMISSION,
    );
    const link = await this.prisma.breakdownScreenplayLink.findUnique({ where: { projectId } });
    if (!link) return { link: null, canLink };
    return { link: view(link, await this.readableScreenplay(userId, link.screenplayId)), canLink };
  }

  /**
   * Links the breakdown to `screenplayId`, replacing any previous link. The actor must hold
   * {@link LINK_PERMISSION} on the breakdown *and* `read_screenplay` on the screenplay: the
   * breakdown check runs first so a caller who cannot see the breakdown never learns anything
   * about the screenplay, and each side keeps its own 404-for-non-members convention.
   */
  async link(
    userId: string,
    projectId: string,
    screenplayId: string,
  ): Promise<BreakdownScreenplayLinkState> {
    await this.permissions.assert(userId, projectId, LINK_PERMISSION);
    await this.screenplayPermissions.assert(userId, screenplayId, 'read_screenplay');
    const screenplay = await this.prisma.screenplay.findFirst({
      where: { id: screenplayId, deletedAt: null },
      select: { id: true, title: true, filename: true, version: true },
    });
    // A direct screenplay membership survives trashing, so `assert` alone would happily link a
    // breakdown to a screenplay that is already on its way to being purged.
    if (!screenplay) throw new NotFoundException('Screenplay not found');

    const link = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.breakdownScreenplayLink.upsert({
        where: { projectId },
        create: { projectId, screenplayId, createdById: userId, updatedById: userId },
        update: { screenplayId, updatedById: userId },
      });
      await tx.activityEvent.create({
        data: {
          projectId,
          actorId: userId,
          action: 'UPDATED',
          resourceType: 'breakdown_screenplay_link',
          resourceId: screenplayId,
          metadata: { screenplayId, screenplayVersion: screenplay.version },
        },
      });
      return saved;
    });
    return { link: view(link, screenplay), canLink: true };
  }

  /**
   * Clears the breakdown's screenplay link. Deliberately requires no screenplay access: a link to
   * a screenplay the actor can no longer see (moved out of a Space, trashed, purged) must still be
   * removable from the breakdown side.
   */
  async unlink(userId: string, projectId: string): Promise<BreakdownScreenplayLinkState> {
    await this.permissions.assert(userId, projectId, LINK_PERMISSION);
    await this.prisma.$transaction(async (tx) => {
      const removed = await tx.breakdownScreenplayLink.deleteMany({ where: { projectId } });
      if (!removed.count) return;
      await tx.activityEvent.create({
        data: {
          projectId,
          actorId: userId,
          action: 'DELETED',
          resourceType: 'breakdown_screenplay_link',
          resourceId: projectId,
          metadata: {},
        },
      });
    });
    return { link: null, canLink: true };
  }
}

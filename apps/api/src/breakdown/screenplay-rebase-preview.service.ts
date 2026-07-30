import { Injectable } from '@nestjs/common';
import type { ScreenplayRebasePlan } from '@coda/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionService } from '../projects/permission.service';
import { ScreenplayPermissionService } from '../screenplays/screenplay-permission.service';
import { readLiveScreenplay, readRebaseLink, readRebasePlan } from './screenplay-rebase-read';

/**
 * Previewing a rebase reveals the linked screenplay's text through the breakdown and is the first
 * step of moving pins, so it takes the same permission pinning does. A member who could not act on
 * the plan is not shown one — the same "a control the API would reject is not offered" rule the link
 * state already follows.
 */
const PREVIEW_PERMISSION = 'manage_items' as const;

/**
 * Produces the reviewable rebase plan for a breakdown (issue #242).
 *
 * ## This service writes nothing
 *
 * That is the whole contract of #242, and it is enforced structurally rather than by discipline:
 *
 * - It reaches Prisma only through `screenplay-rebase-read.ts`, which touches
 *   `findUnique`/`findMany`/`findFirst` only. There is no `$transaction`, no `create`, no `update`,
 *   no `upsert`, no `delete`, and no raw execution in this file, in that reader, or in the pure
 *   assembler they delegate to.
 * - It deliberately does **not** depend on `ScreenplaysService`. The pin flow reaches for
 *   `ensureCheckpoint` to cut a `ScreenplayRevision`, which is a write; the preview never needs one,
 *   because it compares against the screenplay's live `sourceText` directly and reports whichever
 *   revision already exists for that version, or `null`. The apply step (#243) cuts the revision
 *   inside the transaction that is allowed to write, and rejects the plan if the live version moved
 *   first.
 * - It records no activity event. A preview is a read; a read that logged would not be one.
 *
 * `screenplay-rebase-preview.service.test.ts` holds all three files to that with a Prisma double
 * whose every mutating method throws, so a future write here fails a test rather than shipping.
 *
 * The reads live in a shared module rather than inline here because #243 must rebuild *the same
 * plan* from the same facts inside its writing transaction. Two readers would be two definitions of
 * what a plan is built from, and the fingerprint comparison that rejects a stale plan would quietly
 * stop comparing like with like.
 */
@Injectable()
export class ScreenplayRebasePreviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly screenplayPermissions: ScreenplayPermissionService,
  ) {}

  /**
   * Builds the plan.
   *
   * Permission order matches the pin route: the breakdown permission first, so a caller who cannot
   * see the breakdown learns nothing about the screenplay it follows, then `read_screenplay` on the
   * screenplay itself.
   *
   * `expectedScreenplayVersion` is optional optimistic concurrency — a screenplay that has already
   * moved past it answers `409` rather than a plan describing text the reviewer never read.
   */
  async preview(
    userId: string,
    projectId: string,
    expectedScreenplayVersion?: number,
  ): Promise<ScreenplayRebasePlan> {
    await this.permissions.assert(userId, projectId, PREVIEW_PERMISSION);
    const link = await readRebaseLink(this.prisma, projectId);
    await this.screenplayPermissions.assert(userId, link.screenplayId, 'read_screenplay');

    const screenplay = await readLiveScreenplay(
      this.prisma,
      link.screenplayId,
      expectedScreenplayVersion,
    );
    return readRebasePlan(this.prisma, { projectId, link, screenplay, computedAt: new Date() });
  }
}

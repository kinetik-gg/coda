import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { ScreenplayRebasePlan } from '@coda/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionService } from '../projects/permission.service';
import { ScreenplayPermissionService } from '../screenplays/screenplay-permission.service';
import {
  buildScreenplayRebasePlan,
  type RebaseReference,
  type RebaseSourceRevision,
} from './screenplay-rebase-plan';
import type { PinRow } from './source-revision-pin';

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
 * - It touches Prisma through `findUnique`/`findMany`/`findFirst` only. There is no `$transaction`,
 *   no `create`, no `update`, no `upsert`, no `delete`, and no raw execution anywhere in this file
 *   or in the pure assembler it delegates to.
 * - It deliberately does **not** depend on `ScreenplaysService`. The pin flow reaches for
 *   `ensureCheckpoint` to cut a `ScreenplayRevision`, which is a write; the preview never needs one,
 *   because it compares against the screenplay's live `sourceText` directly and reports whichever
 *   revision already exists for that version, or `null`. #243 cuts the revision inside the
 *   transaction that is allowed to write, and rejects the plan if the live version moved first.
 * - It records no activity event. A preview is a read; a read that logged would not be one.
 *
 * `screenplay-rebase-preview.service.test.ts` holds the service to that with a Prisma double whose
 * every mutating method throws, so a future write here fails a test rather than shipping.
 */
@Injectable()
export class ScreenplayRebasePreviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly screenplayPermissions: ScreenplayPermissionService,
  ) {}

  /**
   * The link row, which carries both the screenplay a plan may target and the `updatedAt` that
   * invalidates the plan if the breakdown is relinked underneath it.
   */
  private async link(projectId: string): Promise<{ screenplayId: string; updatedAt: Date }> {
    const link = await this.prisma.breakdownScreenplayLink.findUnique({
      where: { projectId },
      select: { screenplayId: true, updatedAt: true },
    });
    if (!link) {
      throw new NotFoundException('Link a screenplay to this breakdown before previewing a rebase');
    }
    return link;
  }

  /**
   * The screenplay's live, mutable text — the one place in this flow that reads it rather than a
   * revision, because "rebase onto the current screenplay" is precisely a question about live text.
   *
   * `expectedVersion` is the client's optimistic-concurrency claim. Rejecting a mismatch with `409`
   * rather than quietly previewing a newer version keeps a plan from describing text the user has
   * not seen, and mirrors how pinning treats a stale `screenplayVersion`.
   */
  private async liveScreenplay(
    screenplayId: string,
    expectedVersion: number | undefined,
  ): Promise<{ version: number; sourceText: string }> {
    const screenplay = await this.prisma.screenplay.findFirst({
      where: { id: screenplayId, deletedAt: null },
      select: { version: true, sourceText: true },
    });
    if (!screenplay) throw new NotFoundException('Screenplay not found');
    if (expectedVersion !== undefined && expectedVersion !== screenplay.version) {
      throw new ConflictException('Screenplay was modified by another session');
    }
    return screenplay;
  }

  /** Every active source reference in the breakdown, in a stable review order. */
  private async references(projectId: string): Promise<RebaseReference[]> {
    return this.prisma.itemSourceReference.findMany({
      where: { item: { projectId, deletedAt: null } },
      select: { id: true, itemId: true },
      orderBy: [{ itemId: 'asc' }, { position: 'asc' }],
    });
  }

  /**
   * The pins for those references that point at the linked screenplay.
   *
   * Filtering on `screenplayId` matters: a pin left behind by an earlier link to a different
   * screenplay must not be compared against this screenplay's text. It is reported as excluded
   * `pin-unavailable` instead, because its revision is not among the ones loaded below.
   */
  private async pins(projectId: string, screenplayId: string): Promise<Map<string, PinRow>> {
    const rows = await this.prisma.itemSourceRevisionPin.findMany({
      where: { projectId, screenplayId },
    });
    return new Map(rows.map((row) => [row.itemSourceReferenceId, row]));
  }

  /**
   * The text of each distinct revision those pins name, in one query keyed by revision id.
   *
   * Distinct-keyed rather than per-row on purpose: several references routinely share a revision,
   * and #240 established that this flow never issues a query per reference.
   */
  private async revisions(
    screenplayId: string,
    pins: ReadonlyMap<string, PinRow>,
  ): Promise<Map<string, RebaseSourceRevision>> {
    const ids = [...new Set([...pins.values()].map((pin) => pin.screenplayRevisionId))];
    if (!ids.length) return new Map();
    const rows = await this.prisma.screenplayRevision.findMany({
      where: { id: { in: ids }, screenplayId, screenplay: { deletedAt: null } },
      select: { id: true, screenplayVersion: true, sourceText: true },
    });
    return new Map(
      rows.map((row) => [
        row.id,
        { screenplayVersion: row.screenplayVersion, sourceText: row.sourceText },
      ]),
    );
  }

  /**
   * The revision already cut for the live version, if any. A pure lookup — the preview never
   * creates one, which is what keeps it free of side effects.
   */
  private async targetRevisionId(
    screenplayId: string,
    screenplayVersion: number,
  ): Promise<string | null> {
    const revision = await this.prisma.screenplayRevision.findUnique({
      where: { screenplayId_screenplayVersion: { screenplayId, screenplayVersion } },
      select: { id: true },
    });
    return revision?.id ?? null;
  }

  /**
   * Builds the plan.
   *
   * Permission order matches the pin route: the breakdown permission first, so a caller who cannot
   * see the breakdown learns nothing about the screenplay it follows, then `read_screenplay` on the
   * screenplay itself.
   */
  async preview(
    userId: string,
    projectId: string,
    expectedScreenplayVersion?: number,
  ): Promise<ScreenplayRebasePlan> {
    await this.permissions.assert(userId, projectId, PREVIEW_PERMISSION);
    const link = await this.link(projectId);
    await this.screenplayPermissions.assert(userId, link.screenplayId, 'read_screenplay');

    const screenplay = await this.liveScreenplay(link.screenplayId, expectedScreenplayVersion);
    const [references, pins] = await Promise.all([
      this.references(projectId),
      this.pins(projectId, link.screenplayId),
    ]);
    const [revisions, targetRevisionId] = await Promise.all([
      this.revisions(link.screenplayId, pins),
      this.targetRevisionId(link.screenplayId, screenplay.version),
    ]);

    return buildScreenplayRebasePlan({
      projectId,
      screenplayId: link.screenplayId,
      linkUpdatedAt: link.updatedAt,
      target: {
        screenplayVersion: screenplay.version,
        screenplayRevisionId: targetRevisionId,
        sourceText: screenplay.sourceText,
      },
      references,
      pins,
      revisions,
      computedAt: new Date(),
    });
  }
}

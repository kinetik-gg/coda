import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { PinSourceReferenceRevisionInput, ResolvedSourceReferenceView } from '@coda/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionService } from '../projects/permission.service';
import { ScreenplayPermissionService } from '../screenplays/screenplay-permission.service';
import { ScreenplaysService } from '../screenplays/screenplays.service';
import {
  assertRangeWithinRevision,
  excerptOf,
  resolveReference,
  sourceTextHash,
  type PinRow,
  type ReferenceRow,
} from './source-revision-pin';

/**
 * Pinning changes what source material an item is built from, so it uses the same permission that
 * created the reference in the first place (`DocumentsService.addReference`) rather than inventing a
 * new one.
 */
const PIN_PERMISSION = 'manage_items' as const;

const referenceSelection = {
  id: true,
  itemId: true,
  sourceDocumentId: true,
  startPage: true,
  endPage: true,
  position: true,
} as const;

/**
 * Owns `item_source_revision_pins`: the immutable revision and source range one breakdown source
 * reference is pinned to (issue #239).
 *
 * Three properties are load-bearing.
 *
 * 1. **A pin is a sidecar, never a rewrite.** Nothing here writes `ItemSourceReference`,
 *    `SourceDocument`, or `StorageObject`. A pinned reference keeps its `sourceDocumentId`,
 *    `startPage`, and `endPage` untouched, so removing the pin — or losing its revision to a
 *    screenplay purge — degrades to legacy PDF resolution instead of destroying the reference.
 * 2. **Resolution reads the revision, never the mutable screenplay.** `Screenplay.sourceText` is
 *    read exactly once, at pin time, and only through `ScreenplaysService.ensureCheckpoint`, which
 *    snapshots it. Every later read goes to `ScreenplayRevision.sourceText`.
 * 3. **No identifier here has a foreign key** (the N-1 `pg_restore --clean` convention), so every
 *    read re-validates the plain ids against the live graph and every purge path deletes pin rows
 *    explicitly. See `apps/api/src/trash/`.
 */
@Injectable()
export class SourceRevisionPinService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
    private readonly screenplayPermissions: ScreenplayPermissionService,
    private readonly screenplays: ScreenplaysService,
  ) {}

  /**
   * Loads an active reference on an active item in this project. Deliberately independent of the
   * route's `itemId` claim: the reference's own `itemId` is checked, so a caller cannot reach
   * another item's reference by naming an item they can see.
   */
  private async reference(
    projectId: string,
    itemId: string,
    referenceId: string,
  ): Promise<ReferenceRow> {
    const reference = await this.prisma.itemSourceReference.findFirst({
      where: { id: referenceId, itemId, item: { projectId, deletedAt: null } },
      select: referenceSelection,
    });
    if (!reference) throw new NotFoundException('Source reference not found');
    return reference;
  }

  /**
   * The screenplay the breakdown currently follows. A pin may only ever target that screenplay:
   * allowing an arbitrary screenplay id would let one breakdown accumulate pins across several
   * screenplays, which the one-screenplay-per-breakdown cardinality chosen in #238 rules out and
   * which the rebase flow (#242, #243) could not present coherently.
   */
  private async linkedScreenplayId(projectId: string): Promise<string> {
    const link = await this.prisma.breakdownScreenplayLink.findUnique({
      where: { projectId },
      select: { screenplayId: true },
    });
    if (!link) {
      throw new NotFoundException('Link a screenplay to this breakdown before pinning a reference');
    }
    return link.screenplayId;
  }

  /**
   * The pinned revision's Fountain source, or `null` when the caller may not read the screenplay or
   * the revision is gone. `screenplay: { deletedAt: null }` keeps a trashed screenplay's pins
   * `unavailable` rather than resolvable, matching how every other screenplay read behaves.
   */
  private async revisionSourceText(userId: string, pin: PinRow): Promise<string | null> {
    try {
      await this.screenplayPermissions.assert(userId, pin.screenplayId, 'read_screenplay');
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) return null;
      throw error;
    }
    const revision = await this.prisma.screenplayRevision.findFirst({
      where: {
        id: pin.screenplayRevisionId,
        screenplayId: pin.screenplayId,
        screenplay: { deletedAt: null },
      },
      select: { sourceText: true },
    });
    return revision?.sourceText ?? null;
  }

  private async resolve(
    userId: string,
    reference: ReferenceRow,
  ): Promise<ResolvedSourceReferenceView> {
    const pin = await this.prisma.itemSourceRevisionPin.findUnique({
      where: { itemSourceReferenceId: reference.id },
    });
    return resolveReference(
      reference,
      pin,
      pin ? await this.revisionSourceText(userId, pin) : null,
    );
  }

  async get(
    userId: string,
    projectId: string,
    itemId: string,
    referenceId: string,
  ): Promise<ResolvedSourceReferenceView> {
    await this.permissions.assert(userId, projectId, 'read_project');
    return this.resolve(userId, await this.reference(projectId, itemId, referenceId));
  }

  /**
   * Pins the reference to the revision for `input.screenplayVersion`, replacing any previous pin.
   *
   * Order matters. The breakdown permission is asserted first so a caller who cannot see the
   * breakdown learns nothing about the linked screenplay; `read_screenplay` follows, keeping each
   * aggregate's own 404-for-non-members convention. Only then is the checkpoint created or reused —
   * a stale `screenplayVersion` fails there with `409` rather than silently pinning offsets the user
   * selected against different text, and an exhausted checkpoint quota fails with `507`.
   */
  async pin(
    userId: string,
    projectId: string,
    itemId: string,
    referenceId: string,
    input: PinSourceReferenceRevisionInput,
  ): Promise<ResolvedSourceReferenceView> {
    await this.permissions.assert(userId, projectId, PIN_PERMISSION);
    const reference = await this.reference(projectId, itemId, referenceId);
    const screenplayId = await this.linkedScreenplayId(projectId);
    await this.screenplayPermissions.assert(userId, screenplayId, 'read_screenplay');

    const revision = await this.screenplays.ensureCheckpoint(screenplayId, input.screenplayVersion);
    assertRangeWithinRevision(revision.sourceText, input.source);
    const hash = sourceTextHash(excerptOf(revision.sourceText, input.source));

    const pin = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.itemSourceRevisionPin.upsert({
        where: { itemSourceReferenceId: reference.id },
        create: {
          itemSourceReferenceId: reference.id,
          projectId,
          itemId: reference.itemId,
          screenplayId,
          screenplayRevisionId: revision.id,
          screenplayVersion: revision.screenplayVersion,
          sourceStart: input.source.start,
          sourceEnd: input.source.end,
          sourceTextHash: hash,
          createdById: userId,
          updatedById: userId,
        },
        update: {
          screenplayId,
          screenplayRevisionId: revision.id,
          screenplayVersion: revision.screenplayVersion,
          sourceStart: input.source.start,
          sourceEnd: input.source.end,
          sourceTextHash: hash,
          updatedById: userId,
        },
      });
      await tx.activityEvent.create({
        data: {
          projectId,
          actorId: userId,
          action: 'UPDATED',
          resourceType: 'item_source_revision_pin',
          resourceId: reference.id,
          metadata: {
            screenplayId,
            screenplayRevisionId: revision.id,
            screenplayVersion: revision.screenplayVersion,
            sourceStart: input.source.start,
            sourceEnd: input.source.end,
          },
        },
      });
      return saved;
    });
    return resolveReference(reference, pin, revision.sourceText);
  }

  /**
   * Removes the pin, leaving the reference resolving to its original PDF and pages. Requires no
   * screenplay access: a pin to a screenplay the actor can no longer see must still be clearable
   * from the breakdown side, exactly as unlinking is.
   */
  async unpin(
    userId: string,
    projectId: string,
    itemId: string,
    referenceId: string,
  ): Promise<ResolvedSourceReferenceView> {
    await this.permissions.assert(userId, projectId, PIN_PERMISSION);
    const reference = await this.reference(projectId, itemId, referenceId);
    await this.prisma.$transaction(async (tx) => {
      const removed = await tx.itemSourceRevisionPin.deleteMany({
        where: { itemSourceReferenceId: reference.id },
      });
      if (!removed.count) return;
      await tx.activityEvent.create({
        data: {
          projectId,
          actorId: userId,
          action: 'DELETED',
          resourceType: 'item_source_revision_pin',
          resourceId: reference.id,
          metadata: {},
        },
      });
    });
    return resolveReference(reference, null, null);
  }
}

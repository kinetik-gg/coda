import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { pinStaleness, type SourceReferencePinSummary } from '@coda/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { ScreenplayPermissionService } from '../screenplays/screenplay-permission.service';
import { pinView, type PinRow } from './source-revision-pin';

/**
 * Attaches issue #240's current/stale/unavailable pin summary to a batch of source references in a
 * bounded number of queries, independent of how many references are being read.
 *
 * The "list a breakdown with many pinned items must not N+1" acceptance criterion is met by keying
 * every screenplay-touching query by *distinct* `screenplayId`/`screenplayRevisionId`, never by
 * reference count: a page of a hundred items that each pin the one screenplay the breakdown follows
 * costs the same handful of queries as a page with one pinned reference.
 *
 * Staleness is computed from each pin's own `screenplayId`, not from the breakdown's current
 * screenplay link — a pin may only be *created* against the linked screenplay (enforced by
 * `SourceRevisionPinService.pin`), but the link can move on later while an older pin still names the
 * screenplay it was cut from, and that pin's staleness is still meaningful.
 */
@Injectable()
export class SourceReferenceStalenessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly screenplayPermissions: ScreenplayPermissionService,
  ) {}

  /**
   * The live `version` of every readable, non-trashed screenplay among `screenplayIds`, keyed by id.
   * A screenplay absent from the returned map is trashed, purged, or unreadable by `userId` — the
   * same "unavailable" standard `SourceRevisionPinService`'s single-reference read applies.
   */
  private async liveVersions(
    userId: string,
    screenplayIds: readonly string[],
  ): Promise<Map<string, number>> {
    const versions = new Map<string, number>();
    const uniqueIds = [...new Set(screenplayIds)];
    if (!uniqueIds.length) return versions;

    const readableIds: string[] = [];
    await Promise.all(
      uniqueIds.map(async (id) => {
        try {
          await this.screenplayPermissions.assert(userId, id, 'read_screenplay');
          readableIds.push(id);
        } catch (error) {
          if (!(error instanceof NotFoundException || error instanceof ForbiddenException)) {
            throw error;
          }
        }
      }),
    );
    if (!readableIds.length) return versions;

    const rows = await this.prisma.screenplay.findMany({
      where: { id: { in: readableIds }, deletedAt: null },
      select: { id: true, version: true },
    });
    for (const row of rows) versions.set(row.id, row.version);
    return versions;
  }

  /** Revision ids among `pins` whose row still exists — one bounded query regardless of pin count. */
  private async availableRevisionIds(pins: readonly PinRow[]): Promise<Set<string>> {
    const uniqueIds = [...new Set(pins.map((pin) => pin.screenplayRevisionId))];
    if (!uniqueIds.length) return new Set();
    const rows = await this.prisma.screenplayRevision.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true },
    });
    return new Set(rows.map((row) => row.id));
  }

  /**
   * Resolves the current/stale/unavailable summary for every pinned `itemSourceReferenceId` among
   * `referenceIds`. A reference absent from `referenceIds`, or one with no pin row, is simply absent
   * from the returned map — the caller reports it as `unpinned`, the legacy state.
   */
  async summaries(
    userId: string,
    referenceIds: readonly string[],
  ): Promise<Map<string, SourceReferencePinSummary>> {
    const summaries = new Map<string, SourceReferencePinSummary>();
    if (!referenceIds.length) return summaries;

    const pins = await this.prisma.itemSourceRevisionPin.findMany({
      where: { itemSourceReferenceId: { in: [...referenceIds] } },
    });
    if (!pins.length) return summaries;

    const [liveVersions, availableRevisionIds] = await Promise.all([
      this.liveVersions(
        userId,
        pins.map((pin) => pin.screenplayId),
      ),
      this.availableRevisionIds(pins),
    ]);

    for (const pin of pins) {
      summaries.set(
        pin.itemSourceReferenceId,
        summarizePin(pin, liveVersions, availableRevisionIds),
      );
    }
    return summaries;
  }
}

/**
 * Pure derivation of one pin's {@link SourceReferencePinSummary}, kept independent of the database so
 * it can be unit-tested with plain maps and sets.
 */
export function summarizePin(
  pin: PinRow,
  liveVersions: ReadonlyMap<string, number>,
  availableRevisionIds: ReadonlySet<string>,
): SourceReferencePinSummary {
  const liveVersion = liveVersions.get(pin.screenplayId);
  const revisionAvailable = availableRevisionIds.has(pin.screenplayRevisionId);
  if (liveVersion === undefined || !revisionAvailable) {
    return { resolution: 'unavailable', pin: pinView(pin), staleness: null };
  }
  return {
    resolution: 'pinned',
    pin: pinView(pin),
    staleness: pinStaleness(pin.screenplayVersion, liveVersion),
  };
}

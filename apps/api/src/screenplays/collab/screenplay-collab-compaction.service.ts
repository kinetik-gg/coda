import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import * as Y from 'yjs';
import { env } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { SCREENPLAY_COLLAB_TEXT_KEY, yTextToString } from './screenplay-collab.constants';

export type CompactionSkipReason = 'no-op' | 'digest-mismatch' | 'screenplay-missing';

export interface CompactionOutcome {
  screenplayId: string;
  folded: boolean;
  reason?: CompactionSkipReason;
  throughSeq?: number;
  byteLength?: number;
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Folds a screenplay's update log into its checkpoint (ADR: docs/adr-collaboration-engine-and-
 * transport.md, Decision 3 — Compaction). Runs on the singleton scheduler, leader-elected via the
 * `schedulerCoordination` capability; see `ScreenplayCollabJob`.
 *
 * The one rule that matters: replay the log into a fresh `Y.Doc`, then `Y.encodeStateAsUpdate` —
 * NEVER `Y.mergeUpdates` over the raw log. The ADR's spike measured `Y.mergeUpdates` over 32,000
 * single-character updates at 7,468 ms producing 335 KiB (and 483 s / 1.83 MiB over the full
 * 168k-update fixture), against 264 ms / 164 KiB for replay-and-re-encode over the same data,
 * because `Y.mergeUpdates` preserves per-update item boundaries instead of collapsing them.
 */
@Injectable()
export class ScreenplayCollabCompactionService {
  private readonly logger = new Logger(ScreenplayCollabCompactionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * One scheduler tick: folds every screenplay whose log has crossed the configured threshold.
   * One screenplay's fold failing (a corrupt row, a transient database error) must never abort the
   * rest of the tick — each is caught and logged independently, matching how
   * `purgeExpiredScreenplays` continues past a single failure and reports the survivors. The
   * unhealthy screenplay is simply retried on the next tick, exactly like a whole-job failure
   * already is at the `JobRunner` level.
   */
  async tick(): Promise<CompactionOutcome[]> {
    const screenplayIds = await this.candidates();
    const outcomes: CompactionOutcome[] = [];
    for (const screenplayId of screenplayIds) {
      try {
        outcomes.push(await this.compact(screenplayId));
      } catch (error) {
        this.logger.error(
          `Compaction failed for screenplay ${screenplayId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }
    return outcomes;
  }

  private async candidates(): Promise<string[]> {
    const config = env();
    const grouped = await this.prisma.screenplayCollabUpdate.groupBy({
      by: ['screenplayId'],
      _count: { _all: true },
      _sum: { byteLength: true },
    });
    return grouped
      .filter(
        (group) =>
          group._count._all >= config.COLLAB_COMPACTION_ROW_THRESHOLD ||
          (group._sum.byteLength ?? 0) >= config.COLLAB_COMPACTION_BYTE_THRESHOLD,
      )
      .map((group) => group.screenplayId);
  }

  /**
   * Folds one screenplay's log past its current checkpoint. Exposed (not just `tick`) so both the
   * scheduler and tests can drive a single screenplay directly without waiting on the threshold
   * scan.
   *
   * Steps exactly match the ADR: (1) load the existing checkpoint into a fresh `Y.Doc`, (2) apply
   * every log row after it in `seq` order, (3) materialise the text and compare its digest against
   * `Screenplay.sourceText` — abort the fold if they differ, (4) write the re-encoded state as the
   * new checkpoint, (5) delete the folded log rows. Steps 4-5 happen in one transaction so a crash
   * between them can never lose the checkpoint or double-delete.
   */
  async compact(screenplayId: string): Promise<CompactionOutcome> {
    const doc = new Y.Doc();
    try {
      const checkpoint = await this.prisma.screenplayCollabCheckpoint.findUnique({
        where: { screenplayId },
      });
      if (checkpoint) Y.applyUpdate(doc, checkpoint.payload);

      const rows = await this.prisma.screenplayCollabUpdate.findMany({
        where: { screenplayId, seq: { gt: checkpoint?.throughSeq ?? 0 } },
        orderBy: { seq: 'asc' },
        select: { seq: true, payload: true },
      });
      if (rows.length === 0) return { screenplayId, folded: false, reason: 'no-op' };
      for (const row of rows) Y.applyUpdate(doc, row.payload);

      const screenplay = await this.prisma.screenplay.findUnique({
        where: { id: screenplayId },
        select: { sourceText: true },
      });
      if (!screenplay) {
        this.logger.warn(`Skipping compaction for missing screenplay ${screenplayId}`);
        return { screenplayId, folded: false, reason: 'screenplay-missing' };
      }

      const documentDigest = sha256Hex(yTextToString(doc.getText(SCREENPLAY_COLLAB_TEXT_KEY)));
      if (documentDigest !== sha256Hex(screenplay.sourceText)) {
        // The live Yjs document has diverged from the canonical projection (e.g. the debounced
        // materialiser has not caught up yet). Folding now would checkpoint content that does not
        // match `sourceText`, so abort — the next tick retries once the two converge.
        this.logger.warn(
          `Aborting compaction fold for screenplay ${screenplayId}: document digest does not ` +
            'match sourceText',
        );
        return { screenplayId, folded: false, reason: 'digest-mismatch' };
      }

      const throughSeq = rows.at(-1)!.seq;
      const payload = Buffer.from(Y.encodeStateAsUpdate(doc));
      await this.prisma.$transaction(async (tx) => {
        await tx.screenplayCollabCheckpoint.upsert({
          where: { screenplayId },
          create: {
            screenplayId,
            throughSeq,
            payload,
            byteLength: payload.byteLength,
            documentDigest,
          },
          update: { throughSeq, payload, byteLength: payload.byteLength, documentDigest },
        });
        await tx.screenplayCollabUpdate.deleteMany({
          where: { screenplayId, seq: { lte: throughSeq } },
        });
      });
      return { screenplayId, folded: true, throughSeq, byteLength: payload.byteLength };
    } finally {
      doc.destroy();
    }
  }
}

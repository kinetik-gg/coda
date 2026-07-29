import { HttpException, Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as Y from 'yjs';
import { PrismaService } from '../../prisma/prisma.service';
import { SCREENPLAY_LIMITS, type ScreenplayLimits } from '../screenplay-limits';
import { SCREENPLAY_COLLAB_TEXT_KEY, yTextToString } from './screenplay-collab.constants';

const PROJECTION_DEBOUNCE_MS = 700;
const PROJECTION_TRANSACTION_ATTEMPTS = 5;

function isRetryable(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2034' || error.code === 'P2025')
  );
}

/**
 * Debounces the durable Yjs log back into Screenplay.sourceText, the canonical plain-Fountain
 * projection consumed by exports, previews, checkpoints, and external adapters.
 */
@Injectable()
export class ScreenplayCollabProjectionService implements OnModuleDestroy {
  private readonly logger = new Logger(ScreenplayCollabProjectionService.name);
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SCREENPLAY_LIMITS) private readonly limits: ScreenplayLimits,
  ) {}

  schedule(screenplayId: string): void {
    const existing = this.timers.get(screenplayId);
    if (existing) clearTimeout(existing);
    this.timers.set(
      screenplayId,
      setTimeout(() => {
        this.timers.delete(screenplayId);
        void this.project(screenplayId).catch((error: unknown) => {
          this.logger.error(
            `Unable to project collaboration updates for screenplay ${screenplayId}`,
            error instanceof Error ? error.stack : undefined,
          );
        });
      }, PROJECTION_DEBOUNCE_MS),
    );
  }

  onModuleDestroy(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  async project(screenplayId: string): Promise<number | undefined> {
    const sourceText = await this.replaySource(screenplayId);
    if (sourceText === undefined) return undefined;
    const sourceByteLength = Buffer.byteLength(sourceText, 'utf8');
    for (let attempt = 0; attempt < PROJECTION_TRANSACTION_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (transaction) => {
            const screenplay = await transaction.screenplay.findFirst({
              where: { id: screenplayId, deletedAt: null },
              select: {
                ownerUserId: true,
                sourceText: true,
                sourceByteLength: true,
                version: true,
              },
            });
            if (!screenplay) return undefined;
            if (screenplay.sourceText === sourceText) return screenplay.version;
            const aggregate = await transaction.screenplay.aggregate({
              where: { ownerUserId: screenplay.ownerUserId },
              _sum: { sourceByteLength: true },
            });
            const nextTotal =
              (aggregate._sum.sourceByteLength ?? 0) -
              screenplay.sourceByteLength +
              sourceByteLength;
            if (nextTotal > this.limits.maxSourceBytesPerOwner) {
              throw new HttpException('Screenplay source storage quota exceeded', 507);
            }
            const updated = await transaction.screenplay.update({
              where: { id: screenplayId, version: screenplay.version, deletedAt: null },
              data: { sourceText, sourceByteLength, version: { increment: 1 } },
              select: { version: true },
            });
            return updated.version;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (!isRetryable(error)) throw error;
      }
    }
    throw new Error(`Could not project collaboration updates for ${screenplayId}`);
  }

  private async replaySource(screenplayId: string): Promise<string | undefined> {
    const doc = new Y.Doc();
    try {
      const checkpoint = await this.prisma.screenplayCollabCheckpoint.findUnique({
        where: { screenplayId },
        select: { throughSeq: true, payload: true },
      });
      if (checkpoint) Y.applyUpdate(doc, checkpoint.payload);
      const rows = await this.prisma.screenplayCollabUpdate.findMany({
        where: { screenplayId, seq: { gt: checkpoint?.throughSeq ?? 0 } },
        orderBy: { seq: 'asc' },
        select: { payload: true },
      });
      if (!checkpoint && rows.length === 0) return undefined;
      for (const row of rows) Y.applyUpdate(doc, row.payload);
      return yTextToString(doc.getText(SCREENPLAY_COLLAB_TEXT_KEY));
    } finally {
      doc.destroy();
    }
  }
}

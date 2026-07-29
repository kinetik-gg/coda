import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as Y from 'yjs';
import { Prisma } from '@prisma/client';
import type { ScreenplayPermission } from '@coda/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { ScreenplayPermissionService } from '../screenplay-permission.service';
import {
  SCREENPLAY_COLLAB_BOOTSTRAP_CLIENT_ID,
  SCREENPLAY_COLLAB_TEXT_KEY,
} from './screenplay-collab.constants';

function isKnownError(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

/**
 * Yjs's own zero-state encoding is one zero byte, not a zero-length array — a genuinely empty
 * `Uint8Array` fails to decode as a state vector at all. Callers (the gateway's wire-payload
 * normalization) legitimately produce a zero-length array for a missing/absent field, so this is
 * the one place that difference is reconciled.
 */
function normalizeStateVector(stateVector: Uint8Array): Uint8Array {
  return stateVector.length === 0 ? Uint8Array.of(0) : stateVector;
}

/** A joined member's identity and permission set, as returned to the gateway. */
export interface ScreenplayCollabIdentity {
  userId: string;
  displayName: string;
  permissions: ScreenplayPermission[];
}

export interface ScreenplayCollabSyncState {
  /** Everything the server has that the caller's state vector says it is missing. */
  update: Uint8Array;
  serverStateVector: Uint8Array;
}

/**
 * Persistence and Yjs replay for the durable per-screenplay update log (ADR:
 * docs/adr-collaboration-engine-and-transport.md, Decision 3). This is the ONLY place that reads or
 * writes `screenplay_collab_updates` / `screenplay_collab_checkpoints`, so the gateway and the
 * compaction job share one code path for building and appending to a screenplay's Yjs document.
 *
 * Both tables carry plain `screenplayId` columns with no relation onto the core `Screenplay` table
 * (the appended-table backup convention — see schema.prisma), so every core reference here is a
 * separate lookup rather than a Prisma `include`.
 */
@Injectable()
export class ScreenplayCollabLogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: ScreenplayPermissionService,
  ) {}

  /**
   * Authorizes a `join-screenplay` handshake: `read_screenplay`, plus the tenant-isolation
   * convention that a non-member and a trashed screenplay are indistinguishable (both `404`, never
   * `403` — a `403` would confirm the screenplay exists).
   */
  async assertJoin(userId: string, screenplayId: string): Promise<ScreenplayCollabIdentity> {
    // `assert` throws `ForbiddenException` for a member whose role lacks `read_screenplay`; that
    // can only happen for a future, unusually restrictive role, but the join handshake still must
    // never distinguish it from a non-member (see the tenant-isolation convention above).
    const membership = await this.permissions
      .assert(userId, screenplayId, 'read_screenplay')
      .catch((error: unknown) => {
        if (error instanceof ForbiddenException)
          throw new NotFoundException('Screenplay not found');
        throw error;
      });
    const screenplay = await this.prisma.screenplay.findFirst({
      where: { id: screenplayId, deletedAt: null },
      select: { id: true },
    });
    if (!screenplay) throw new NotFoundException('Screenplay not found');
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { displayName: true },
    });
    return {
      userId,
      displayName: user?.displayName ?? '',
      permissions: membership.role.permissions.map(
        (entry) => entry.permission as ScreenplayPermission,
      ),
    };
  }

  /**
   * Seeds a screenplay's Yjs document from its current `sourceText` the first time anyone joins —
   * otherwise a screenplay authored before collaboration shipped would appear blank to its first
   * collaborator. Runs at most once per screenplay: guarded by an existence check plus a unique
   * `(screenplayId, seq)` constraint, so a race between two concurrent first joins is resolved by
   * whichever insert wins; the loser's (functionally identical) seed is discarded.
   */
  async ensureBootstrapped(screenplayId: string): Promise<void> {
    const [existingUpdate, existingCheckpoint] = await Promise.all([
      this.prisma.screenplayCollabUpdate.findFirst({
        where: { screenplayId },
        select: { id: true },
      }),
      this.prisma.screenplayCollabCheckpoint.findUnique({
        where: { screenplayId },
        select: { screenplayId: true },
      }),
    ]);
    if (existingUpdate || existingCheckpoint) return;

    const screenplay = await this.prisma.screenplay.findUnique({
      where: { id: screenplayId },
      select: { sourceText: true, ownerUserId: true },
    });
    if (!screenplay) return;

    const doc = new Y.Doc();
    try {
      doc.getText(SCREENPLAY_COLLAB_TEXT_KEY).insert(0, screenplay.sourceText);
      const seed = Buffer.from(Y.encodeStateAsUpdate(doc));
      await this.prisma.screenplayCollabUpdate.create({
        data: {
          screenplayId,
          seq: 1,
          authorUserId: screenplay.ownerUserId,
          actorClientId: SCREENPLAY_COLLAB_BOOTSTRAP_CLIENT_ID,
          payload: seed,
          byteLength: seed.byteLength,
        },
      });
    } catch (error) {
      // Another join already bootstrapped this screenplay; the seed we built is discarded.
      if (!isKnownError(error, 'P2002')) throw error;
    } finally {
      doc.destroy();
    }
  }

  /**
   * Replays the checkpoint (if any) plus every log row after it into a fresh `Y.Doc`, then returns
   * exactly what the caller's state vector says it is missing. Bounded by the compaction
   * thresholds — the log a join ever has to replay stays small because compaction folds it away.
   */
  async loadSyncState(
    screenplayId: string,
    clientStateVector: Uint8Array,
  ): Promise<ScreenplayCollabSyncState> {
    const doc = await this.replayDocument(screenplayId);
    try {
      return {
        // A genuinely empty byte array is not a valid encoded state vector to Yjs (its own
        // encoding of "no state" is one zero byte, `Y.encodeStateVector(new Y.Doc())`); a
        // brand-new client with no local document yet must still get the full document back.
        update: Y.encodeStateAsUpdate(doc, normalizeStateVector(clientStateVector)),
        serverStateVector: Y.encodeStateVector(doc),
      };
    } finally {
      doc.destroy();
    }
  }

  /**
   * Materializes the durable Yjs document back into the canonical Fountain projection. The
   * projection advances `version` only when the text changed, so a forced Save/Export flush is
   * idempotent and cannot manufacture optimistic-concurrency conflicts for `paperSize`.
   */
  async materializeSourceText(screenplayId: string): Promise<number | undefined> {
    const doc = await this.replayDocument(screenplayId);
    try {
      const sourceText = doc.getText(SCREENPLAY_COLLAB_TEXT_KEY).toString();
      const screenplay = await this.prisma.screenplay.findFirst({
        where: { id: screenplayId, deletedAt: null },
        select: { sourceText: true, version: true },
      });
      if (!screenplay) return undefined;
      if (screenplay.sourceText === sourceText) return screenplay.version;
      const updated = await this.prisma.screenplay.update({
        where: { id: screenplayId, deletedAt: null },
        data: {
          sourceText,
          sourceByteLength: Buffer.byteLength(sourceText, 'utf8'),
          version: { increment: 1 },
        },
        select: { version: true },
      });
      return updated.version;
    } finally {
      doc.destroy();
    }
  }

  /**
   * Appends one update to the log under the next sequence number for this screenplay. Sequence
   * allocation reads the current tail (last log row, or the checkpoint's `throughSeq` once the log
   * has been folded past it) inside a serializable transaction and retries on the rare conflict —
   * the same pattern `ScreenplaysService` uses for its quota checks — rather than a raw-SQL row
   * lock, which would trip the `quality:db-portability` gate.
   */
  async appendUpdate(
    screenplayId: string,
    authorUserId: string,
    actorClientId: string,
    update: Uint8Array,
  ): Promise<number> {
    const payload = Buffer.from(update);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const [lastUpdate, checkpoint] = await Promise.all([
              tx.screenplayCollabUpdate.findFirst({
                where: { screenplayId },
                orderBy: { seq: 'desc' },
                select: { seq: true },
              }),
              tx.screenplayCollabCheckpoint.findUnique({
                where: { screenplayId },
                select: { throughSeq: true },
              }),
            ]);
            const seq = Math.max(lastUpdate?.seq ?? 0, checkpoint?.throughSeq ?? 0) + 1;
            await tx.screenplayCollabUpdate.create({
              data: {
                screenplayId,
                seq,
                authorUserId,
                actorClientId,
                payload,
                byteLength: payload.byteLength,
              },
            });
            return seq;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (!isKnownError(error, 'P2034') && !isKnownError(error, 'P2002')) throw error;
        // Lost the race for this sequence number (another publish or a concurrent compaction fold
        // committed first) — the next attempt reads a fresh tail.
      }
    }
    throw new Error(`Could not allocate a collab update sequence number for ${screenplayId}`);
  }

  private async replayDocument(screenplayId: string): Promise<Y.Doc> {
    const doc = new Y.Doc();
    try {
      const checkpoint = await this.prisma.screenplayCollabCheckpoint.findUnique({
        where: { screenplayId },
      });
      if (checkpoint) Y.applyUpdate(doc, checkpoint.payload);
      const rows = await this.prisma.screenplayCollabUpdate.findMany({
        where: { screenplayId, seq: { gt: checkpoint?.throughSeq ?? 0 } },
        orderBy: { seq: 'asc' },
        select: { payload: true },
      });
      for (const row of rows) Y.applyUpdate(doc, row.payload);
      return doc;
    } catch (error) {
      doc.destroy();
      throw error;
    }
  }
}

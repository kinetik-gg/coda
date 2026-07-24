import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { DatabaseCapabilities, type ClaimedDeletionJob } from './database-capabilities';

/**
 * SQLite implementation of {@link DatabaseCapabilities}, used ONLY by the portability test lane
 * (issue #77). Nothing ships on SQLite — this class is not bound in `AppModule` and exists so the
 * lane can prove every construct the Postgres adapter hides behind the seam has a portable,
 * single-process equivalent. It honours the three binding portability notes on the interface:
 *
 * 1. **Advisory locks are channel-correct no-ops.** SQLite's `$executeRaw` channel rejects any
 *    result-returning statement, so translating the Postgres `SELECT pg_advisory_xact_lock(...)`
 *    into `SELECT 1` would throw. The correct SQLite behaviour is to emit **no statement at all**:
 *    SQLite is single-writer, so a write transaction already excludes every other writer for its
 *    duration — exactly the mutual exclusion the advisory lock provided across replicas. The desktop
 *    profile is single-process (`multiReplica: false`, spike §3), so there is no second replica to
 *    coordinate with and nothing to serialize beyond what SQLite already serializes.
 *
 * 2. **`claimNextDeletionJob` uses no `FOR UPDATE SKIP LOCKED` and no `INTERVAL` literal.** The
 *    staleness cutoff is computed in JavaScript and the claim is an ordinary
 *    read-then-update inside a transaction; with a single writer there is no contention to skip.
 *
 * 3. **`caseInsensitiveEmail` restores the citext guarantee in application code.** SQLite has no
 *    citext and column collations are not expressible through the Prisma datamodel, so equality and
 *    uniqueness would silently become case-sensitive. Normalising to lower case on both reads and
 *    writes makes `A@x.com` and `a@x.com` collide on the plain unique index, matching Postgres.
 */
@Injectable()
export class SqliteDatabaseCapabilities extends DatabaseCapabilities {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async acquireTransactionLock(_tx: Prisma.TransactionClient, _key: string): Promise<void> {
    // No-op by design — see portability note 1. Emitting any statement here (even `SELECT 1`) would
    // throw on SQLite's execute channel; single-writer semantics supply the mutual exclusion.
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async acquireTransactionLockById(_tx: Prisma.TransactionClient, _id: bigint): Promise<void> {
    // No-op by design — see portability note 1.
  }

  tryTransactionLock(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _tx: Prisma.TransactionClient,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _namespace: number,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _key: string,
  ): Promise<boolean> {
    // A single-process instance always wins the lock: there is no other replica to skip for. The
    // scheduler's own timer guards against re-entrant ticks, so returning true lets the job run,
    // which is the desired single-process behaviour (spike §3, `multiReplica: false`).
    return Promise.resolve(true);
  }

  async claimNextDeletionJob(staleClaimMinutes: number): Promise<ClaimedDeletionJob | null> {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - staleClaimMinutes * 60_000);
    const claimToken = randomUUID();

    return this.prisma.$transaction(async (tx) => {
      const job = await tx.storageDeletionJob.findFirst({
        where: {
          notBefore: { lte: now },
          OR: [{ claimedAt: null }, { claimedAt: { lte: staleBefore } }],
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true, objectKey: true, attempts: true },
      });
      if (!job) return null;
      await tx.storageDeletionJob.update({
        where: { id: job.id },
        data: { claimToken, claimedAt: now, updatedAt: now },
      });
      return { id: job.id, objectKey: job.objectKey, attempts: job.attempts, claimToken };
    });
  }

  caseInsensitiveEmail(email: string): string {
    // Restore citext's case-insensitive equality/uniqueness in application code (portability note 2
    // on the interface). Every write path must persist this canonical form so the plain SQLite
    // unique index rejects case-variant duplicates.
    return email.toLowerCase();
  }
}

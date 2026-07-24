import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { DatabaseCapabilities, type ClaimedDeletionJob } from './database-capabilities';

/**
 * PostgreSQL implementation of {@link DatabaseCapabilities}. This class is the ONE place raw,
 * Postgres-specific SQL (`pg_advisory_xact_lock`, `hashtextextended`, `FOR UPDATE SKIP LOCKED`,
 * `INTERVAL`, `citext` semantics) is allowed to live; the portability lint gate
 * (`scripts/check-db-portability.ts`) fails if any of it leaks outside this directory.
 *
 * Every method preserves the exact behaviour the codebase relied on before the seam was extracted.
 */
@Injectable()
export class PostgresDatabaseCapabilities extends DatabaseCapabilities {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async acquireTransactionLock(tx: Prisma.TransactionClient, key: string): Promise<void> {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
  }

  async acquireTransactionLockById(tx: Prisma.TransactionClient, id: bigint): Promise<void> {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${id})`);
  }

  async tryTransactionLock(
    tx: Prisma.TransactionClient,
    namespace: number,
    key: string,
  ): Promise<boolean> {
    // Cast the namespace to int4: Prisma binds the numeric parameter as bigint, which would
    // otherwise select the single-argument pg_try_advisory_xact_lock(bigint) signature instead
    // of the two-int form. hashtext already returns int4.
    const rows = await tx.$queryRaw<{ locked: boolean }[]>(
      Prisma.sql`SELECT pg_try_advisory_xact_lock(${namespace}::int4, hashtext(${key})) AS locked`,
    );
    return rows[0]?.locked ?? false;
  }

  async claimNextDeletionJob(staleClaimMinutes: number): Promise<ClaimedDeletionJob | null> {
    const claimToken = randomUUID();
    const claimed = await this.prisma.$queryRaw<Array<Omit<ClaimedDeletionJob, 'claimToken'>>>(
      Prisma.sql`
        UPDATE "storage_deletion_jobs"
        SET
          "claim_token" = CAST(${claimToken} AS UUID),
          "claimed_at" = CURRENT_TIMESTAMP,
          "updated_at" = CURRENT_TIMESTAMP
        WHERE "id" = (
          SELECT "id"
          FROM "storage_deletion_jobs"
          WHERE "not_before" <= CURRENT_TIMESTAMP
            AND (
              "claimed_at" IS NULL
              OR "claimed_at" <= CURRENT_TIMESTAMP - ${staleClaimMinutes}::int * INTERVAL '1 minute'
            )
          ORDER BY "created_at" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        RETURNING "id", "object_key" AS "objectKey", "attempts"
      `,
    );
    return claimed[0] ? { ...claimed[0], claimToken } : null;
  }

  caseInsensitiveEmail(email: string): string {
    // The citext column case-folds equality in the database, so no application-level normalization
    // is required on Postgres — this is a deliberate pass-through. See design note #2 on the
    // DatabaseCapabilities interface for the SQLite obligation.
    return email;
  }
}

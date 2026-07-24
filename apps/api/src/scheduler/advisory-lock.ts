import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { SCHEDULER_LOCK_NAMESPACE } from './scheduler.constants';

/** Outcome of an attempt to run work while holding a job's advisory lock. */
export type LockAttempt<T> = { acquired: false } | { acquired: true; value: T };

/**
 * Serializes a job across replicas with a transaction-scoped Postgres advisory lock.
 *
 * `pg_try_advisory_xact_lock` is non-blocking: a replica that cannot take the lock returns
 * immediately (`acquired: false`) instead of queueing, so concurrent replicas skip rather than
 * double-run. The lock is transaction-scoped, so it is released automatically when the callback
 * settles — there is no unlock to leak, and a crashed replica drops its lock when the connection
 * closes. The callback runs on the same pinned connection that holds the lock, which is why it must
 * complete within the interactive-transaction timeout.
 */
@Injectable()
export class SchedulerAdvisoryLock {
  constructor(private readonly prisma: PrismaService) {}

  async runExclusively<T>(
    key: string,
    handler: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<LockAttempt<T>> {
    const timeout = env().SCHEDULER_JOB_TIMEOUT_MS;
    return this.prisma.$transaction(
      async (tx) => {
        // Cast the namespace to int4: Prisma binds the numeric parameter as bigint, which would
        // otherwise select the single-argument pg_try_advisory_xact_lock(bigint) signature instead
        // of the two-int form. hashtext already returns int4.
        const rows = await tx.$queryRaw<{ locked: boolean }[]>(
          Prisma.sql`SELECT pg_try_advisory_xact_lock(${SCHEDULER_LOCK_NAMESPACE}::int4, hashtext(${key})) AS locked`,
        );
        if (!rows[0]?.locked) return { acquired: false };
        return { acquired: true, value: await handler(tx) };
      },
      { timeout, maxWait: timeout },
    );
  }
}

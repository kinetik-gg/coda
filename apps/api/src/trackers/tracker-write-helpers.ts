import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { DatabaseCapabilities } from '../database/database-capabilities';

/**
 * Mutation mechanics shared by the tracker field and record services: optimistic-version failure
 * disambiguation (409 stale vs 404 gone, matching the S4 tracker surface) and the ordering-group
 * advisory lock that serializes concurrent rank moves within one tracker.
 */

export function prismaKnownError(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

export interface VersionedResource {
  id: string;
  deletedAt: Date | null;
}

/**
 * Resolves a failed version-guarded update into the S4 disambiguation: `exists` re-reads the live
 * (non-trashed) row — a miss is a `404`, a hit means the caller's `version` was stale (`409`).
 * Any other Prisma error is rethrown untouched.
 */
export async function staleVersionOrGone(
  error: unknown,
  label: string,
  exists: () => Promise<VersionedResource | null>,
): Promise<never> {
  if (!prismaKnownError(error, 'P2025')) throw error;
  if (!(await exists())) throw new NotFoundException(`${label} not found`);
  throw new ConflictException(`${label} was modified by another session`);
}

/** Same disambiguation for `updateMany` flows, where staleness surfaces as `count === 0`. */
export async function countMismatchOrGone(
  count: number,
  label: string,
  exists: () => Promise<VersionedResource | null>,
): Promise<void> {
  if (count > 0) return;
  if (!(await exists())) throw new NotFoundException(`${label} not found`);
  throw new ConflictException(`${label} was modified by another session`);
}

export function lockOrderingGroup(
  db: DatabaseCapabilities,
  tx: Prisma.TransactionClient,
  scope: string,
): Promise<void> {
  return db.acquireTransactionLock(tx, scope);
}

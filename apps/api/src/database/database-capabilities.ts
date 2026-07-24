import type { Prisma } from '@prisma/client';

/**
 * A job claimed from the storage-deletion outbox, ready to have its physical object deleted. The
 * `claimToken` fences the claim: the claimant re-supplies it on the follow-up delete/release so a
 * stale claim taken over by another worker cannot be mutated by the original holder.
 */
export interface ClaimedDeletionJob {
  id: string;
  objectKey: string;
  attempts: number;
  claimToken: string;
}

/**
 * The seam corralling every database construct that Prisma does NOT abstract and that is not
 * portable across the SQL dialects Coda targets. Today the only production dialect is PostgreSQL;
 * the desktop/embedded lane (#77) adds SQLite. Everything a query needs beyond plain Prisma model
 * calls — advisory locks, `FOR UPDATE SKIP LOCKED`, `INTERVAL` arithmetic, `citext` case-folding —
 * lives behind this interface so the raw, dialect-specific SQL exists in exactly one place (the
 * Postgres implementation) and can be swapped wholesale for another engine.
 *
 * Injected as an abstract-class DI token: `constructor(private readonly db: DatabaseCapabilities)`,
 * bound in `AppModule` to {@link PostgresDatabaseCapabilities}.
 *
 * ## Portability design notes (binding — from the #73 spike findings)
 *
 * These are the traps a second implementation (SQLite, #77) MUST honour. They are recorded here,
 * on the interface, because they are contract obligations, not implementation trivia:
 *
 * 1. **Channel-correct advisory-lock no-ops.** The Postgres locks are emitted as result-returning
 *    `SELECT pg_advisory_xact_lock(...)` statements through Prisma's *execute* channel
 *    (`$executeRaw`). On SQLite that channel **rejects any statement that returns rows**
 *    (`Execute returned results, which is not allowed in SQLite`). A SQLite implementation therefore
 *    must NOT translate the lock into `SELECT 1` (or any other query) on the execute channel — the
 *    correct no-op is to emit **no statement at all** and rely on SQLite's single-writer semantics
 *    (or an in-process keyed async mutex) for the mutual exclusion the advisory lock provided.
 *
 * 2. **`citext` loss is silent.** Production stores `User.email` (and invitation emails) as
 *    `citext`, so `where: { email }` equality is case-insensitive *at the database*. SQLite has no
 *    citext: `A@x.com` and `a@x.com` become **distinct** rows and the uniqueness the account model
 *    depends on vanishes with no error. The {@link caseInsensitiveEmail} hook is where that strategy
 *    is restored (normalized/lowercased shadow column or a `NOCASE` collation), and #77 must ship a
 *    test that fails loudly if case-variant emails are accepted as distinct.
 *
 * 3. **`INTERVAL` literals and `FOR UPDATE SKIP LOCKED` are Postgres syntax.** Both raise SQLite
 *    syntax errors. They are confined to {@link claimNextDeletionJob}; a SQLite implementation
 *    computes the staleness cutoff in JS and, being single-writer, needs no skip-locked contention
 *    handling — an ordinary transactional `UPDATE ... WHERE id IN (SELECT ... LIMIT 1)` suffices.
 */
export abstract class DatabaseCapabilities {
  /**
   * Take a transaction-scoped advisory lock keyed by an opaque string, blocking until it is granted.
   * The lock is held for the remainder of `tx` and released automatically when the transaction
   * settles, so there is no unlock to leak and a crashed connection drops it. Used to serialize
   * check-then-act sections (password reset, project/role lifecycle, ordering-group reordering,
   * upload reservations, instance-invite dedup) across replicas.
   *
   * Postgres: `SELECT pg_advisory_xact_lock(hashtextextended($key, 0))`.
   */
  abstract acquireTransactionLock(tx: Prisma.TransactionClient, key: string): Promise<void>;

  /**
   * Take a transaction-scoped advisory lock on a fixed numeric id (the single-`bigint` lock space).
   * Distinct from {@link acquireTransactionLock}'s hashed-string keys so the setup-owner singleton
   * guard occupies a stable, collision-free slot. Held and released with `tx` exactly as above.
   *
   * Postgres: `SELECT pg_advisory_xact_lock($id)`.
   */
  abstract acquireTransactionLockById(tx: Prisma.TransactionClient, id: bigint): Promise<void>;

  /**
   * Attempt a transaction-scoped advisory lock in an isolated two-int namespace **without blocking**:
   * a caller that cannot take the lock returns `false` immediately instead of queueing, so
   * concurrent replicas skip rather than double-run. Backs the scheduler's single-execution guard.
   * The two-int namespace cannot collide with the single-`bigint` locks above.
   *
   * Postgres: `SELECT pg_try_advisory_xact_lock($namespace::int4, hashtext($key))`.
   */
  abstract tryTransactionLock(
    tx: Prisma.TransactionClient,
    namespace: number,
    key: string,
  ): Promise<boolean>;

  /**
   * Atomically claim the oldest eligible row from the storage-deletion outbox, stamping it with a
   * fresh fencing `claimToken`, or return `null` when nothing is claimable. "Eligible" means past
   * its `notBefore` and either unclaimed or whose prior claim is older than `staleClaimMinutes`
   * (a crashed worker's claim is reclaimable). Concurrent workers must never claim the same row.
   *
   * Postgres: an `UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1)` with the
   * staleness cutoff expressed as `CURRENT_TIMESTAMP - $staleClaimMinutes * INTERVAL '1 minute'`.
   */
  abstract claimNextDeletionJob(staleClaimMinutes: number): Promise<ClaimedDeletionJob | null>;

  /**
   * Case-insensitive-email strategy hook. Returns the value to place at `where: { email }` for a
   * case-insensitive lookup, and the canonical form writes should persist.
   *
   * Postgres: a pass-through — the `citext` column already case-folds equality in the database, so
   * the raw string is returned unchanged and no application-level normalization is required.
   *
   * SQLite (#77): must return a match against a normalized (lowercased) column and every write path
   * must store that normalized form; see portability design note #2 on this interface.
   */
  abstract caseInsensitiveEmail(email: string): string;
}

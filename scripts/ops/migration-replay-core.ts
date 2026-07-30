/**
 * Pure, Docker-free helpers for the migration-replay gate
 * (`validate-migration-replay.ts`, issue #269).
 *
 * The backup-compatibility contract requires migrations to be replay-safe: `_prisma_migrations`
 * travels inside the database dump, so restoring an N-1 backup onto a current-schema database
 * rewinds the migration ledger and the next `prisma migrate deploy` re-applies every migration that
 * shipped since. Keeping the ledger parsing and the replay reasoning here lets
 * `pnpm test:deployment` cover it without booting a Compose stack, mirroring
 * `backup-roundtrip-core.ts`.
 *
 * This is a strict addition to `assertExactlyOnceMigration` in `scripts/smoke-deployment.ts`, which
 * asserts the unrelated concurrency property that two simultaneous boots apply each migration
 * exactly once. Neither substitutes for the other.
 */

/**
 * Migrations that are known NOT to survive re-application today, with the error each produces when
 * replayed against a database where its objects already exist. Every one of them creates appended
 * tables or indexes without `IF NOT EXISTS`, so an operator who restores an older archive and
 * restarts hits `prisma migrate deploy` failing at the first of these. This gate found them; fixing
 * them means rewriting committed migration files, which is a deliberate human decision and is
 * tracked separately.
 *
 * The list is a checked-in baseline, not a permission: the gate fails when a migration outside it
 * turns out to be replay-unsafe, AND when one on it starts passing (so the list cannot rot). While
 * it is non-empty the end-to-end `prisma migrate deploy` assertion cannot run and is skipped
 * explicitly; emptying the list turns that assertion on automatically.
 */
export const KNOWN_REPLAY_UNSAFE_MIGRATIONS = [
  '20260724140236_two_factor_totp',
  '20260725000000_screenplay_access_control',
  '20260725000000_screenplay_panel_layouts',
  '20260726000000_screenplay_collab_log',
  '20260729000000_screenplay_comment_threads',
];

/** Reads the applied-migration ledger, tuples-only, one migration name per line. */
export const MIGRATION_LEDGER_SQL =
  'SELECT migration_name FROM "_prisma_migrations" ' +
  'WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name;';

/** Counts ledger rows that are unfinished or rolled back — either would mean a broken replay. */
export const MIGRATION_HEALTH_SQL =
  'SELECT count(*) FILTER (WHERE finished_at IS NULL), ' +
  'count(*) FILTER (WHERE rolled_back_at IS NOT NULL), count(*), count(DISTINCT migration_name) ' +
  'FROM "_prisma_migrations";';

/**
 * `prisma migrate deploy` exactly as the application's boot sequence runs it
 * (`apps/api/src/boot/migration-runner.ts`), resolved from inside the running container so this
 * gate exercises the same CLI, schema, and generated client an operator's next boot would.
 */
export const MIGRATE_DEPLOY_SCRIPT = [
  "const { spawnSync } = require('node:child_process');",
  // `prisma` is a dependency of the API workspace, not of the image root, so resolve it the way
  // the boot sequence does — from inside apps/api — rather than from the `node -e` cwd.
  "const cli = require.resolve('prisma/build/index.js', { paths: ['/app/apps/api', '/app'] });",
  "const result = spawnSync(process.execPath, [cli, 'migrate', 'deploy', '--schema',",
  "  '/app/apps/api/prisma/schema.prisma'], { stdio: 'inherit' });",
  'process.exit(result.status === null ? 1 : result.status);',
].join('\n');

/** Parses a `psql -tA` result set of migration names into a stable, de-duplicated list. */
export function parseMigrationLedger(output: string): string[] {
  return [
    ...new Set(
      output
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !/^\(\d+ rows?\)$/u.test(line)),
    ),
  ].sort();
}

export interface MigrationHealth {
  unfinished: number;
  rolledBack: number;
  total: number;
  distinct: number;
}

/** Parses the four counters produced by {@link MIGRATION_HEALTH_SQL}. */
export function parseMigrationHealth(output: string): MigrationHealth {
  const cells = output
    .trim()
    .split('|')
    .map((value) => Number.parseInt(value.trim(), 10));
  if (cells.length !== 4 || cells.some((value) => Number.isNaN(value))) {
    throw new Error(
      `Migration-ledger health query returned an unexpected result: ${output.trim()}`,
    );
  }
  const [unfinished, rolledBack, total, distinct] = cells as [number, number, number, number];
  return { unfinished, rolledBack, total, distinct };
}

/**
 * Migrations the current build has applied that the restored N-1 ledger no longer records. These
 * are exactly the migrations `migrate deploy` must be able to re-apply against a database whose
 * objects they already created — the replay this gate exists to prove survivable.
 */
export function rewoundMigrations(head: string[], restored: string[]): string[] {
  const known = new Set(restored);
  return head.filter((name) => !known.has(name));
}

/**
 * Fails when the replay did not bring the ledger back to the pre-restore head, or when it left
 * unfinished or rolled-back rows behind. A `migrate deploy` that exits 0 while silently skipping a
 * migration would otherwise pass unnoticed.
 */
export function assertLedgerReturnedToHead(
  head: string[],
  afterReplay: string[],
  health: MigrationHealth,
): void {
  const missing = rewoundMigrations(head, afterReplay);
  if (missing.length > 0) {
    throw new Error(
      `migrate deploy exited 0 but ${missing.length} migration(s) are still absent from the ` +
        `ledger after the replay: ${missing.join(', ')}`,
    );
  }
  if (health.unfinished !== 0) {
    throw new Error(`${health.unfinished} migration(s) never finished applying during the replay`);
  }
  if (health.rolledBack !== 0) {
    throw new Error(`${health.rolledBack} migration(s) were rolled back during the replay`);
  }
  if (health.total !== health.distinct) {
    throw new Error(
      `Replay left duplicate ledger rows: ${health.total} rows across ${health.distinct} names`,
    );
  }
}

export interface ReplayFailure {
  migration: string;
  error: string;
}

/**
 * Compares the migrations that actually failed re-application against
 * {@link KNOWN_REPLAY_UNSAFE_MIGRATIONS}, restricted to the ones this fixture rewound (a fixture
 * from a newer release simply does not exercise the older entries). Fails in both directions: a new
 * replay-unsafe migration is a regression, and a baseline entry that now passes means the list is
 * stale and must shrink.
 */
export function assertReplayBaseline(rewound: string[], failed: ReplayFailure[]): void {
  const exercised = new Set(
    KNOWN_REPLAY_UNSAFE_MIGRATIONS.filter((name) => rewound.includes(name)),
  );
  const regressions = failed.filter((failure) => !exercised.has(failure.migration));
  if (regressions.length > 0) {
    throw new Error(
      `${regressions.length} migration(s) cannot be re-applied after an N-1 restore. Make them ` +
        'idempotent (CREATE TABLE/INDEX IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, fixed UUIDs, ' +
        'ON CONFLICT DO NOTHING) — an operator who restores an older archive and restarts hits ' +
        'this as a crash loop:\n' +
        regressions.map((failure) => `  ${failure.migration}: ${failure.error}`).join('\n'),
    );
  }
  const failedNames = new Set(failed.map((failure) => failure.migration));
  const nowPassing = [...exercised].filter((name) => !failedNames.has(name));
  if (nowPassing.length > 0) {
    throw new Error(
      'These migrations now replay cleanly and must be removed from ' +
        `KNOWN_REPLAY_UNSAFE_MIGRATIONS: ${nowPassing.join(', ')}`,
    );
  }
}

/** Condenses a psql failure into the one line that names the problem. */
export function firstPostgresError(output: string): string {
  const line = output
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .find((entry) => /^(psql:.*)?ERROR:/u.test(entry));
  return line ?? output.trim().split(/\r?\n/u)[0] ?? 'unknown error';
}

/**
 * Human summary of what the restore actually rewound. A fixture produced by the current release
 * rewinds nothing, which makes the replay vacuous rather than wrong — the gate says so out loud
 * instead of failing, because fixture freshness is tracked separately (issue #270) and this lane
 * must stay correct whichever release the committed fixture came from.
 */
export function describeRewind(rewound: string[], fixtureAppVersion: string): string {
  if (rewound.length === 0) {
    return (
      `WARNING: restoring the N-1 fixture (app ${fixtureAppVersion}) rewound no migrations, so the ` +
      'replay below re-applied nothing. The committed fixture is not older than the current ' +
      'migration head; regenerate it (tests/fixtures/backups/README.md) to make this gate bite.'
    );
  }
  return (
    `Restoring the N-1 fixture (app ${fixtureAppVersion}) rewound ${rewound.length} migration(s) ` +
    `out of the ledger; migrate deploy must re-apply them against objects they already created: ` +
    rewound.join(', ')
  );
}

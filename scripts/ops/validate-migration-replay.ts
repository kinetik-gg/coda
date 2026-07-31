import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  type Stack,
  bootUninitializedStack,
  compose,
  stack,
  tearDown,
} from './backup-roundtrip-compose';
import {
  FIXTURE_ARCHIVE_PATH,
  FIXTURE_METADATA_PATH,
  type FixtureMetadata,
  assertImportableFormatVersion,
  parseImportOutcome,
  readArchiveManifestSummary,
} from './backup-roundtrip-core';
import {
  KNOWN_REPLAY_UNSAFE_MIGRATIONS,
  MIGRATE_DEPLOY_SCRIPT,
  MIGRATION_HEALTH_SQL,
  MIGRATION_LEDGER_SQL,
  type ReplayFailure,
  assertLedgerReturnedToHead,
  assertReplayBaseline,
  describeRewind,
  firstPostgresError,
  parseMigrationHealth,
  parseMigrationLedger,
  rewoundMigrations,
} from './migration-replay-core';

/**
 * Migration-replay gate for the Recovery workflow (issue #269).
 *
 * The backup-compatibility contract requires migrations to survive re-application, because
 * `_prisma_migrations` travels inside the database dump: restoring an N-1 archive onto a
 * current-schema database rewinds the ledger and the next boot re-applies everything that shipped
 * since, against objects those migrations already created. Nothing exercised that. This runs the
 * operator sequence for real:
 *
 *  1. Boot the build under test against an empty database so it reaches the current migration head.
 *  2. Restore the committed N-1 fixture through `POST /api/v1/setup/import`. The in-app engine
 *     restores with `pg_restore --clean --if-exists`, so this genuinely rewinds `_prisma_migrations`
 *     while every appended table (which the older dump does not know about) survives with its rows.
 *  3. Re-apply each rewound migration against that database, each inside its own transaction that
 *     is rolled back, so one failure does not mask the rest — `prisma migrate deploy` aborts at the
 *     first error and would only ever report one. Compare the failures against the checked-in
 *     {@link KNOWN_REPLAY_UNSAFE_MIGRATIONS} baseline.
 *  4. Once that baseline is empty, run `prisma migrate deploy` itself and assert it succeeds and
 *     returns the ledger to the pre-restore head with no unfinished, rolled-back, or duplicated
 *     rows. That assertion turns on automatically the moment the baseline is emptied.
 *
 * This does not weaken or replace `assertExactlyOnceMigration` in `scripts/smoke-deployment.ts`,
 * which asserts the separate concurrency property that two simultaneous boots apply each migration
 * exactly once. Requires `CODA_IMAGE` to name the build under test, and Docker Compose.
 */

const MIGRATIONS_DIR = 'apps/api/prisma/migrations';

function psql(target: Stack, sql: string): string {
  return compose(
    target,
    [
      'exec',
      '-T',
      '-e',
      `PGPASSWORD=${target.environment.POSTGRES_PASSWORD ?? ''}`,
      'postgres',
      'psql',
      '-U',
      'coda',
      '-d',
      'coda',
      '-tAc',
      sql,
    ],
    true,
  );
}

/**
 * Feeds a whole migration file to psql on stdin inside a rolled-back transaction. `compose()` has
 * no stdin channel and migration bodies are far too large for an argv, so this shells out directly
 * with the same project/file/environment wiring.
 */
function replayInRolledBackTransaction(target: Stack, sql: string): ReplayFailure['error'] | null {
  const result = spawnSync(
    'docker',
    [
      'compose',
      '--project-name',
      target.project,
      ...target.files.flatMap((file) => ['-f', file]),
      'exec',
      '-T',
      '-e',
      `PGPASSWORD=${target.environment.POSTGRES_PASSWORD ?? ''}`,
      'postgres',
      'psql',
      '-U',
      'coda',
      '-d',
      'coda',
      '-v',
      'ON_ERROR_STOP=1',
      '-f',
      '-',
    ],
    {
      encoding: 'utf8',
      env: target.environment,
      input: `BEGIN;\n${sql}\nROLLBACK;\n`,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  if (result.error) throw result.error;
  return result.status === 0 ? null : firstPostgresError(`${result.stdout}\n${result.stderr}`);
}

function readLedger(target: Stack): string[] {
  return parseMigrationLedger(psql(target, MIGRATION_LEDGER_SQL));
}

/** Runs `prisma migrate deploy` inside the app container, exactly as the boot sequence does. */
function migrateDeploy(target: Stack): void {
  compose(target, ['exec', '-T', 'coda', 'node', '-e', MIGRATE_DEPLOY_SCRIPT]);
}

async function restoreFixture(target: Stack, archive: Buffer): Promise<void> {
  const response = await fetch(`${target.appUrl}/api/v1/setup/import`, {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      'x-coda-setup-token': target.environment.SETUP_TOKEN ?? '',
    },
    body: new Uint8Array(archive),
  });
  const outcome = parseImportOutcome(await response.text());
  if (outcome.status !== 'complete') {
    throw new Error(`N-1 restore did not complete: ${outcome.message ?? 'unknown error'}`);
  }
}

function probeReplay(target: Stack, rewound: string[]): ReplayFailure[] {
  const failures: ReplayFailure[] = [];
  for (const migration of rewound) {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, migration, 'migration.sql'), 'utf8');
    const error = replayInRolledBackTransaction(target, sql);
    process.stdout.write(`  ${error === null ? 'replays' : 'FAILS  '}  ${migration}\n`);
    if (error !== null) failures.push({ migration, error });
  }
  return failures;
}

function deployAndAssertHead(target: Stack, head: string[]): void {
  migrateDeploy(target);
  assertLedgerReturnedToHead(
    head,
    readLedger(target),
    parseMigrationHealth(psql(target, MIGRATION_HEALTH_SQL)),
  );
  // An operator who reboots once more must find nothing pending, which a migration that
  // re-applies itself unconditionally would break.
  migrateDeploy(target);
  assertLedgerReturnedToHead(
    head,
    readLedger(target),
    parseMigrationHealth(psql(target, MIGRATION_HEALTH_SQL)),
  );
}

async function main(): Promise<void> {
  const metadata = JSON.parse(
    readFileSync(resolve(FIXTURE_METADATA_PATH), 'utf8'),
  ) as FixtureMetadata;
  const archive = readFileSync(resolve(FIXTURE_ARCHIVE_PATH));
  assertImportableFormatVersion(readArchiveManifestSummary(archive).formatVersion);

  const target = stack('coda-migration-replay', 53_024, 59_024, metadata.configEncryptionKey);
  try {
    await bootUninitializedStack(target);
    const head = readLedger(target);
    if (head.length === 0) {
      throw new Error('Boot left an empty migration ledger; the build never applied migrations');
    }
    process.stdout.write(`Current build booted at migration head: ${head.length} migration(s).\n`);

    await restoreFixture(target, archive);
    const rewound = rewoundMigrations(head, readLedger(target));
    process.stdout.write(`${describeRewind(rewound, metadata.appVersion)}\n`);

    const failures = probeReplay(target, rewound);
    assertReplayBaseline(rewound, failures);

    const blocking = KNOWN_REPLAY_UNSAFE_MIGRATIONS.filter((name) => rewound.includes(name));
    if (blocking.length === 0) {
      deployAndAssertHead(target, head);
      process.stdout.write(
        `Migration replay gate passed: prisma migrate deploy re-applied ${rewound.length} ` +
          `migration(s) after the N-1 restore and returned the ledger to all ${head.length}, ` +
          'with a second deploy a clean no-op.\n',
      );
      return;
    }
    process.stdout.write(
      `Migration replay gate passed: all ${rewound.length - blocking.length} of ${rewound.length} ` +
        'replayable migrations re-applied cleanly after the N-1 restore, and no new migration ' +
        'regressed. The end-to-end prisma migrate deploy assertion stays skipped while ' +
        `${blocking.length} pre-existing migration(s) remain on the KNOWN_REPLAY_UNSAFE_MIGRATIONS ` +
        `baseline: ${blocking.join(', ')}.\n`,
    );
  } finally {
    tearDown(target);
  }
}

void main();

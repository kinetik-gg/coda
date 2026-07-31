import { describe, expect, it } from 'vitest';

import {
  KNOWN_REPLAY_UNSAFE_MIGRATIONS,
  MIGRATE_DEPLOY_SCRIPT,
  assertLedgerReturnedToHead,
  assertReplayBaseline,
  describeRewind,
  firstPostgresError,
  parseMigrationHealth,
  parseMigrationLedger,
  rewoundMigrations,
} from './migration-replay-core';

/**
 * Covers the reasoning behind the migration-replay gate (issue #269) without booting Docker, the
 * same way `backup-roundtrip-core.test.ts` covers the round-trip gate.
 */

const HEALTHY = { unfinished: 0, rolledBack: 0, total: 3, distinct: 3 };

describe('parseMigrationLedger', () => {
  it('reads tuples-only psql output into a sorted, de-duplicated list', () => {
    expect(parseMigrationLedger('20260728000000_spaces\n20260721000000_initial\n\n')).toEqual([
      '20260721000000_initial',
      '20260728000000_spaces',
    ]);
  });

  it('ignores a psql row-count footer', () => {
    expect(parseMigrationLedger('20260721000000_initial\n(1 row)\n')).toEqual([
      '20260721000000_initial',
    ]);
  });
});

describe('parseMigrationHealth', () => {
  it('parses the four counters', () => {
    expect(parseMigrationHealth(' 0|0|34|34 \n')).toEqual({
      unfinished: 0,
      rolledBack: 0,
      total: 34,
      distinct: 34,
    });
  });

  it('throws on an unexpected result rather than reporting a false pass', () => {
    expect(() => parseMigrationHealth('ERROR')).toThrow(/unexpected result/u);
  });
});

describe('rewoundMigrations', () => {
  it('reports the migrations the N-1 restore removed from the ledger', () => {
    expect(rewoundMigrations(['a', 'b', 'c'], ['a'])).toEqual(['b', 'c']);
  });

  it('reports none when the fixture is already at the current head', () => {
    expect(rewoundMigrations(['a', 'b'], ['a', 'b'])).toEqual([]);
  });
});

describe('assertLedgerReturnedToHead', () => {
  it('passes when the replay restored every migration cleanly', () => {
    expect(() =>
      assertLedgerReturnedToHead(['a', 'b', 'c'], ['a', 'b', 'c'], HEALTHY),
    ).not.toThrow();
  });

  it('fails when migrate deploy exited 0 but skipped a migration', () => {
    expect(() => assertLedgerReturnedToHead(['a', 'b'], ['a'], HEALTHY)).toThrow(/still absent/u);
  });

  it('fails on an unfinished migration', () => {
    expect(() => assertLedgerReturnedToHead(['a'], ['a'], { ...HEALTHY, unfinished: 1 })).toThrow(
      /never finished/u,
    );
  });

  it('fails on a rolled-back migration', () => {
    expect(() => assertLedgerReturnedToHead(['a'], ['a'], { ...HEALTHY, rolledBack: 1 })).toThrow(
      /rolled back/u,
    );
  });

  it('fails when the replay duplicated a ledger row', () => {
    expect(() =>
      assertLedgerReturnedToHead(['a'], ['a'], { ...HEALTHY, total: 4, distinct: 3 }),
    ).toThrow(/duplicate ledger rows/u);
  });
});

describe('describeRewind', () => {
  it('names the replayed migrations when the fixture is genuinely older', () => {
    expect(describeRewind(['20260728000000_spaces'], '0.0.3')).toContain(
      'rewound 1 migration(s) out of the ledger',
    );
  });

  it('says out loud that the replay was vacuous when nothing rewound', () => {
    const message = describeRewind([], '0.0.7');
    expect(message).toContain('WARNING');
    expect(message).toContain('regenerate it');
  });
});

describe('KNOWN_REPLAY_UNSAFE_MIGRATIONS', () => {
  it('is empty, so the end-to-end migrate deploy assertion runs (issue #324)', () => {
    expect(KNOWN_REPLAY_UNSAFE_MIGRATIONS).toEqual([]);
  });
});

describe('assertReplayBaseline', () => {
  const known = '20260726000000_screenplay_collab_log';

  it('passes when the only failures are the exercised baseline entries', () => {
    expect(() =>
      assertReplayBaseline(
        [known, 'other'],
        [{ migration: known, error: 'ERROR: exists' }],
        [known],
      ),
    ).not.toThrow();
  });

  it('fails when a migration outside the baseline cannot be re-applied', () => {
    expect(() =>
      assertReplayBaseline(['other'], [{ migration: 'other', error: 'ERROR: exists' }], [known]),
    ).toThrow(/cannot be re-applied after an N-1 restore/u);
  });

  it('fails when a baseline entry the fixture exercised now replays cleanly', () => {
    expect(() => assertReplayBaseline([known], [], [known])).toThrow(/must be removed from/u);
  });

  it('ignores baseline entries this fixture never rewound', () => {
    expect(() => assertReplayBaseline(['other'], [], [known])).not.toThrow();
  });

  it('treats any replay failure as a regression against the real, now-empty baseline', () => {
    expect(() =>
      assertReplayBaseline([known], [{ migration: known, error: 'ERROR: exists' }]),
    ).toThrow(/cannot be re-applied after an N-1 restore/u);
  });
});

describe('firstPostgresError', () => {
  it('picks the ERROR line out of psql output', () => {
    expect(firstPostgresError('BEGIN\npsql:-:2: ERROR:  relation "x" already exists\n')).toBe(
      'psql:-:2: ERROR:  relation "x" already exists',
    );
  });

  it('falls back to the first line when nothing matches', () => {
    expect(firstPostgresError('could not connect\n')).toBe('could not connect');
  });
});

describe('MIGRATE_DEPLOY_SCRIPT', () => {
  it('runs the same prisma CLI entry and schema path the boot sequence uses', () => {
    expect(MIGRATE_DEPLOY_SCRIPT).toContain("require.resolve('prisma/build/index.js'");
    expect(MIGRATE_DEPLOY_SCRIPT).toContain("'migrate', 'deploy', '--schema'");
    expect(MIGRATE_DEPLOY_SCRIPT).toContain('/app/apps/api/prisma/schema.prisma');
    expect(MIGRATE_DEPLOY_SCRIPT).toContain('process.exit(');
  });
});

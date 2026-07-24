import { describe, expect, it } from 'vitest';
import {
  evaluatePendingMigrations,
  type MigrationDirLister,
  readAppliedMigrations,
  readLocalMigrations,
} from './migration-status';

function dirent(name: string, directory: boolean): { name: string; isDirectory(): boolean } {
  return { name, isDirectory: () => directory };
}

describe('readLocalMigrations', () => {
  it('returns sorted migration directory names, ignoring files like migration_lock.toml', () => {
    const readDir: MigrationDirLister = () => [
      dirent('20260102000000_b', true),
      dirent('20260101000000_a', true),
      dirent('migration_lock.toml', false),
    ];
    expect(readLocalMigrations('/app/apps/api', readDir)).toEqual([
      '20260101000000_a',
      '20260102000000_b',
    ]);
  });

  it('returns an empty list when the migrations directory is unreadable', () => {
    const readDir: MigrationDirLister = () => {
      throw new Error('ENOENT');
    };
    expect(readLocalMigrations('/nope', readDir)).toEqual([]);
  });
});

describe('evaluatePendingMigrations', () => {
  it('treats a missing migrations table as a fresh install', () => {
    expect(evaluatePendingMigrations(['a', 'b'], null)).toEqual({
      isFreshInstall: true,
      pending: ['a', 'b'],
    });
  });

  it('treats an empty applied history as a fresh install', () => {
    expect(evaluatePendingMigrations(['a'], [])).toEqual({ isFreshInstall: true, pending: ['a'] });
  });

  it('reports the committed migrations not yet applied on an existing instance', () => {
    expect(evaluatePendingMigrations(['a', 'b', 'c'], ['a'])).toEqual({
      isFreshInstall: false,
      pending: ['b', 'c'],
    });
  });

  it('reports no pending migrations when the applied set is current', () => {
    expect(evaluatePendingMigrations(['a', 'b'], ['a', 'b'])).toEqual({
      isFreshInstall: false,
      pending: [],
    });
  });
});

describe('readAppliedMigrations', () => {
  it('maps rows to migration names', async () => {
    const rows = await readAppliedMigrations(() =>
      Promise.resolve([{ migration_name: 'a' }, { migration_name: 'b' }]),
    );
    expect(rows).toEqual(['a', 'b']);
  });

  it('returns null when the migrations table does not exist (Prisma P2021)', async () => {
    const result = await readAppliedMigrations(() =>
      Promise.reject(Object.assign(new Error('missing'), { code: 'P2021' })),
    );
    expect(result).toBeNull();
  });

  it('returns null on a raw undefined-table error (SQLSTATE 42P01)', async () => {
    const result = await readAppliedMigrations(() =>
      Promise.reject(new Error('relation "_prisma_migrations" does not exist')),
    );
    expect(result).toBeNull();
  });

  it('propagates unrelated query failures', async () => {
    await expect(
      readAppliedMigrations(() => Promise.reject(new Error('connection reset'))),
    ).rejects.toThrow('connection reset');
  });
});

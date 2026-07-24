import { describe, expect, it } from 'vitest';
import {
  PgDatabaseBackupEngine,
  libpqConnectionString,
  runProcess,
  type RunCommand,
} from './backup-pg';

describe('libpqConnectionString', () => {
  it('strips Prisma-only query parameters and keeps libpq ones', () => {
    expect(
      libpqConnectionString('postgresql://coda:pw@db:5432/coda?schema=public&sslmode=require'),
    ).toBe('postgresql://coda:pw@db:5432/coda?sslmode=require');
    expect(libpqConnectionString('postgresql://coda:pw@db:5432/coda?connection_limit=5')).toBe(
      'postgresql://coda:pw@db:5432/coda',
    );
  });

  it('returns an unparseable string unchanged', () => {
    expect(libpqConnectionString('not a url')).toBe('not a url');
  });
});

describe('PgDatabaseBackupEngine', () => {
  it('invokes pg_dump with the custom format and target file', async () => {
    const calls: { command: string; args: string[] }[] = [];
    const runCommand: RunCommand = (command, args) => {
      calls.push({ command, args });
      return Promise.resolve();
    };
    const engine = new PgDatabaseBackupEngine({
      databaseUrl: 'postgresql://coda:pw@db:5432/coda',
      isInitialized: () => Promise.resolve(false),
      runCommand,
    });
    await engine.dumpTo('/tmp/database.dump');
    expect(calls[0]?.command).toBe('pg_dump');
    expect(calls[0]?.args).toContain('--format=custom');
    expect(calls[0]?.args).toContain('--file=/tmp/database.dump');
    expect(calls[0]?.args).toContain('--dbname=postgresql://coda:pw@db:5432/coda');
  });

  it('invokes pg_restore with a schema-replacing single transaction', async () => {
    const calls: { command: string; args: string[] }[] = [];
    const runCommand: RunCommand = (command, args) => {
      calls.push({ command, args });
      return Promise.resolve();
    };
    const engine = new PgDatabaseBackupEngine({
      databaseUrl: 'postgresql://coda:pw@db:5432/coda',
      isInitialized: () => Promise.resolve(true),
      runCommand,
    });
    await engine.restoreFrom('/tmp/database.dump');
    expect(calls[0]?.command).toBe('pg_restore');
    expect(calls[0]?.args).toEqual(
      expect.arrayContaining(['--clean', '--if-exists', '--single-transaction', '--exit-on-error']),
    );
    expect(await engine.isInitialized()).toBe(true);
  });
});

describe('runProcess', () => {
  it('resolves for a zero exit code', async () => {
    await expect(runProcess(process.execPath, ['-e', 'process.exit(0)'])).resolves.toBeUndefined();
  });

  it('rejects with captured stderr for a non-zero exit code', async () => {
    await expect(
      runProcess(process.execPath, ['-e', 'process.stderr.write("boom"); process.exit(2)']),
    ).rejects.toThrow(/boom/u);
  });

  it('rejects when the command cannot start', async () => {
    await expect(runProcess('definitely-not-a-real-binary-xyz', [])).rejects.toBeInstanceOf(Error);
  });
});

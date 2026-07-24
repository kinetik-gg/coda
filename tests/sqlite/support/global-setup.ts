import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Vitest 4 does not export the global-setup context type; the only member this lane uses is the
// typed `provide` channel (augmented below through the `ProvidedContext` interface).
interface SetupContext {
  provide: (key: 'sqliteDatabaseUrl', value: string) => void;
}

// Materialises the derived SQLite schema into a throwaway file database in a tmpdir, exactly as the
// desktop lane would at boot: `prisma db push` (NOT `migrate` — the canonical migrations are
// hand-written Postgres SQL with a pg-pinned lock, per the #73 spike). The database url is shared
// with the test workers through Vitest's `provide`/`inject` channel, and the tmpdir is removed on
// teardown. The SQLite Prisma client must already be generated (see `pnpm sqlite:client:generate`).

const SQLITE_SCHEMA = resolve('apps/api/prisma/schema.sqlite.prisma');

declare module 'vitest' {
  interface ProvidedContext {
    sqliteDatabaseUrl: string;
  }
}

export default function setup({ provide }: SetupContext): () => void {
  const directory = mkdtempSync(join(tmpdir(), 'coda-sqlite-lane-'));
  const databaseUrl = `file:${join(directory, 'lane.db')}`;

  execFileSync(
    'pnpm',
    [
      '--filter',
      '@coda/api',
      'exec',
      'prisma',
      'db',
      'push',
      '--schema',
      SQLITE_SCHEMA,
      '--skip-generate',
    ],
    { stdio: 'inherit', env: { ...process.env, DATABASE_URL: databaseUrl } },
  );

  provide('sqliteDatabaseUrl', databaseUrl);
  return () => rmSync(directory, { recursive: true, force: true });
}

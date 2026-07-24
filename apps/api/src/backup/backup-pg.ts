import { spawn } from 'node:child_process';
import type { DatabaseBackupEngine } from './backup-ports';

/** Runs a command to completion, rejecting with captured stderr on failure. */
export type RunCommand = (command: string, args: string[]) => Promise<void>;

export const runProcess: RunCommand = (command, args) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} failed: ${stderr.trim()}`)),
    );
  });

/** Query parameters Prisma understands but libpq (pg_dump/pg_restore) rejects. */
const PRISMA_ONLY_PARAMS = [
  'schema',
  'connection_limit',
  'pool_timeout',
  'pgbouncer',
  'socket_timeout',
];

/** Strips Prisma-only query parameters so libpq tools accept the connection URI. */
export function libpqConnectionString(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);
    for (const parameter of PRISMA_ONLY_PARAMS) url.searchParams.delete(parameter);
    return url.toString();
  } catch {
    return databaseUrl;
  }
}

export interface PgDatabaseBackupEngineOptions {
  databaseUrl: string;
  /** Resolves whether the instance already has an owner (blocks restore). */
  isInitialized: () => Promise<boolean>;
  runCommand?: RunCommand;
}

/**
 * PostgreSQL implementation of {@link DatabaseBackupEngine} using the
 * `pg_dump`/`pg_restore` custom format. Requires the `postgresql-client` package
 * present in the runtime image. Restore replaces the schema (`--clean --if-exists`
 * inside a single transaction) so an uninitialized instance whose entrypoint has
 * already applied migrations can be overwritten atomically.
 */
export class PgDatabaseBackupEngine implements DatabaseBackupEngine {
  private readonly databaseUrl: string;
  private readonly runCommand: RunCommand;
  private readonly initialized: () => Promise<boolean>;

  constructor(options: PgDatabaseBackupEngineOptions) {
    this.databaseUrl = libpqConnectionString(options.databaseUrl);
    this.runCommand = options.runCommand ?? runProcess;
    this.initialized = options.isInitialized;
  }

  isInitialized(): Promise<boolean> {
    return this.initialized();
  }

  async dumpTo(path: string): Promise<void> {
    await this.runCommand('pg_dump', [
      '--format=custom',
      '--no-owner',
      '--no-privileges',
      `--file=${path}`,
      `--dbname=${this.databaseUrl}`,
    ]);
  }

  async restoreFrom(path: string): Promise<void> {
    await this.runCommand('pg_restore', [
      '--no-owner',
      '--no-privileges',
      '--exit-on-error',
      '--single-transaction',
      '--clean',
      '--if-exists',
      `--dbname=${this.databaseUrl}`,
      path,
    ]);
  }
}

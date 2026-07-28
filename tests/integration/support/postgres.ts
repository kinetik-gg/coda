import { execFileSync } from 'node:child_process';

const COMPOSE_PROJECT = process.env.CODA_COLLAB_PROJECT ?? 'coda-test';
const COMPOSE_FILES = (process.env.CODA_COLLAB_COMPOSE_FILES ?? 'compose.yaml,compose.test.yaml')
  .split(',')
  .map((file) => file.trim())
  .filter(Boolean);
const POSTGRES_PASSWORD =
  process.env.CODA_COLLAB_POSTGRES_PASSWORD ?? process.env.POSTGRES_PASSWORD;

function runPsql(args: string[], input?: string): string {
  return execFileSync(
    'docker',
    [
      'compose',
      '--project-name',
      COMPOSE_PROJECT,
      ...COMPOSE_FILES.flatMap((file) => ['-f', file]),
      'exec',
      '-T',
      '-e',
      `PGPASSWORD=${POSTGRES_PASSWORD ?? ''}`,
      'postgres',
      'psql',
      '-U',
      'coda',
      '-d',
      'coda',
      '-v',
      'ON_ERROR_STOP=1',
      ...args,
    ],
    { encoding: 'utf8', ...(input === undefined ? {} : { input }) },
  ).trim();
}

/** Returns a single scalar value from the disposable system-test PostgreSQL. */
export function queryDatabase(sql: string): string {
  return runPsql(['-tAc', sql]);
}

/** Runs a multi-statement SQL script through stdin without splitting it in the test process. */
export function runDatabaseScript(sql: string): void {
  runPsql([], sql);
}

export function databaseReachable(): boolean {
  try {
    return queryDatabase('SELECT 1') === '1';
  } catch {
    return false;
  }
}

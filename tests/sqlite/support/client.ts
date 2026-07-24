import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PrismaService } from '../../../apps/api/src/prisma/prisma.service';
import { SqliteDatabaseCapabilities } from '../../../apps/api/src/database/sqlite-database-capabilities';

// The SQLite Prisma client is generated to a private path (apps/api/prisma/generated/sqlite) so it
// never overwrites the production Postgres client. It is imported dynamically by a computed path so
// the main `pnpm typecheck`/`pnpm lint` (which do not generate the SQLite client) never depend on
// its generated types; the narrow structural interfaces below capture only what these tests use.

interface Delegate<Row> {
  create(args: { data: Record<string, unknown> }): Promise<Row>;
  findFirst(args?: unknown): Promise<Row | null>;
  update(args: unknown): Promise<Row>;
  deleteMany(args?: unknown): Promise<{ count: number }>;
  count(args?: unknown): Promise<number>;
}

interface UserRow {
  id: string;
  email: string;
  status: string;
}

interface DeletionJobRow {
  id: string;
  objectKey: string;
  attempts: number;
  claimToken: string | null;
  claimedAt: Date | null;
}

export interface SqliteClient {
  user: Delegate<UserRow>;
  storageDeletionJob: Delegate<DeletionJobRow>;
  $transaction<Result>(fn: (tx: SqliteClient) => Promise<Result>): Promise<Result>;
  $disconnect(): Promise<void>;
}

const GENERATED_CLIENT = resolve('apps/api/prisma/generated/sqlite/index.js');

export async function createSqliteClient(url: string): Promise<SqliteClient> {
  const module = (await import(pathToFileURL(GENERATED_CLIENT).href)) as {
    PrismaClient: new (options: { datasources: { db: { url: string } } }) => SqliteClient;
  };
  return new module.PrismaClient({ datasources: { db: { url } } });
}

/**
 * Build the SQLite capability adapter under test against a live SQLite client. The adapter is typed
 * for the Postgres client in production; the structural SQLite client is compatible for the model
 * calls it makes, so the cross-dialect cast here is the seam the whole lane exercises.
 */
export function sqliteCapabilities(client: SqliteClient): SqliteDatabaseCapabilities {
  return new SqliteDatabaseCapabilities(client as unknown as PrismaService);
}

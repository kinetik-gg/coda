import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Narrow directory lister so the pure logic stays decoupled from Node's overloaded `readdirSync`. */
export type MigrationDirLister = (
  dir: string,
  options: { withFileTypes: true },
) => { name: string; isDirectory(): boolean }[];

/**
 * Result of comparing the committed migration set against the database's applied history.
 *
 * `isFreshInstall` distinguishes a brand-new database (no `_prisma_migrations` table, or an empty
 * one) from an existing instance being upgraded. A fresh install has "pending" migrations in the
 * trivial sense that none are applied yet, but there is no data worth protecting, so the pre-upgrade
 * safety backup is skipped for it.
 */
export interface PendingMigrationResult {
  isFreshInstall: boolean;
  pending: string[];
}

/**
 * List committed migration directory names (e.g. `20260101000000_init`). Prisma names each migration
 * after a directory holding its `migration.sql`; the `migration_lock.toml` sentinel file is ignored.
 */
export function readLocalMigrations(
  apiRoot: string,
  readDir: MigrationDirLister = (dir, options) => readdirSync(dir, options),
): string[] {
  const migrationsDir = join(apiRoot, 'prisma', 'migrations');
  let entries: { name: string; isDirectory(): boolean }[];
  try {
    entries = readDir(migrationsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * Pure comparison of committed migrations against the applied set. `applied` is `null` when the
 * `_prisma_migrations` table does not exist yet (a truly fresh database).
 */
export function evaluatePendingMigrations(
  local: string[],
  applied: string[] | null,
): PendingMigrationResult {
  if (applied === null || applied.length === 0) return { isFreshInstall: true, pending: local };
  const appliedSet = new Set(applied);
  return { isFreshInstall: false, pending: local.filter((name) => !appliedSet.has(name)) };
}

/** Row shape returned when reading the Prisma migration history table. */
export interface AppliedMigrationRow {
  migration_name: string;
}

/**
 * Read the applied (successfully finished, not rolled back) migration names from
 * `_prisma_migrations`, returning `null` when the table is absent so the caller can treat the
 * database as a fresh install. Any other query failure propagates.
 */
export async function readAppliedMigrations(
  queryRows: () => Promise<AppliedMigrationRow[]>,
): Promise<string[] | null> {
  try {
    const rows = await queryRows();
    return rows.map((row) => row.migration_name);
  } catch (error) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
}

function isMissingTableError(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  if (code === 'P2021' || code === '42P01') return true;
  const message = (error as { message?: string }).message?.toLowerCase() ?? '';
  return message.includes('does not exist') && message.includes('_prisma_migrations');
}

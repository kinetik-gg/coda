import type { PendingMigrationResult } from './migration-status';

export interface PreUpgradeLogger {
  log: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

export interface PreUpgradeBackupDeps {
  /** False when the operator has opted out with `PRE_UPGRADE_BACKUP=off`. */
  enabled: boolean;
  /** How many pre-upgrade archives to retain after a successful backup. */
  keep: number;
  /** Detect committed-but-unapplied migrations and whether this is a fresh install. */
  pendingMigrations: () => Promise<PendingMigrationResult>;
  /** Stream a signed backup archive to object storage under the given key. */
  createArchive: (key: string) => Promise<void>;
  /** Prune old pre-upgrade archives to the retention limit; returns the pruned keys. */
  prune: () => Promise<string[]>;
  /** Build the timestamped archive key for this run. */
  archiveKey: () => string;
  logger: PreUpgradeLogger;
}

/**
 * Boot-time safety hook: after the database probe succeeds but before pending migrations are applied,
 * capture an automatic backup so an upgrade always has a fresh restore point.
 *
 * It is deliberately conservative about when it acts. It skips entirely when opted out, skips a fresh
 * install (there is no data to protect and the "pending" set is just the full migration list on an
 * empty database), and skips when the applied history already matches the committed migrations. It
 * acts only when an existing, initialized instance has genuinely pending migrations.
 *
 * A failure to *create* the safety archive is fatal: it throws, and the boot sequence re-enters the
 * existing database-readiness diagnostic loop instead of applying migrations without a backup. A
 * failure to *prune* old archives is not fatal — the safety point already exists — so it is logged
 * and swallowed.
 */
export async function ensurePreUpgradeBackup(deps: PreUpgradeBackupDeps): Promise<void> {
  if (!deps.enabled) {
    deps.logger.warn(
      'Pre-upgrade backup is disabled (PRE_UPGRADE_BACKUP=off); applying migrations without a safety backup.',
    );
    return;
  }
  const status = await deps.pendingMigrations();
  if (status.isFreshInstall) {
    deps.logger.log('Fresh database detected; skipping the pre-upgrade safety backup.');
    return;
  }
  if (status.pending.length === 0) {
    deps.logger.log('No pending migrations; skipping the pre-upgrade safety backup.');
    return;
  }
  const key = deps.archiveKey();
  deps.logger.warn(
    `${status.pending.length} pending migration(s) detected; creating a pre-upgrade safety backup at ${key} before applying them.`,
  );
  await deps.createArchive(key);
  deps.logger.log(`Pre-upgrade safety backup written to ${key}.`);
  try {
    const pruned = await deps.prune();
    if (pruned.length > 0) {
      deps.logger.log(
        `Pruned ${pruned.length} old pre-upgrade backup(s) beyond the last ${deps.keep}.`,
      );
    }
  } catch (error) {
    deps.logger.error(
      `Pre-upgrade backup retention pruning failed (the fresh safety backup is intact): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

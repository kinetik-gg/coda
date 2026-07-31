import type { PendingMigrationResult } from './migration-status';

export interface PreUpgradeLogger {
  log: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

export interface PreUpgradeBackupDeps {
  /** False when the operator has opted out with `PRE_UPGRADE_BACKUP=off`. */
  enabled: boolean;
  /**
   * Whether CONFIG_ENCRYPTION_KEY is set; without it archives cannot be signed. An upgrade that
   * would apply migrations to real data refuses to proceed when this is false — see
   * {@link PreUpgradeBackupKeyMissingError}.
   */
  encryptionKeyConfigured: boolean;
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
 * Thrown when an initialized instance has pending migrations but no `CONFIG_ENCRYPTION_KEY`, so the
 * safety archive cannot be signed. Skipping the backup silently is the one outcome an operator can
 * neither see nor undo: the migrations apply to real data and the restore point they believed they
 * had never existed. `PRE_UPGRADE_BACKUP=off` is the supported way to upgrade without one, so
 * refusing here always leaves a deliberate route forward.
 *
 * The message deliberately avoids the string `openssl`, because the boot diagnostic page classifies
 * a failure by scanning its message and `ssl` would mislabel this as a TLS fault.
 */
export class PreUpgradeBackupKeyMissingError extends Error {
  constructor(pending: number) {
    super(
      `${pending} pending migration(s) detected, but CONFIG_ENCRYPTION_KEY is not configured, so ` +
        'the pre-upgrade safety backup cannot be signed. Migrations were NOT applied. Set ' +
        'CONFIG_ENCRYPTION_KEY to a base64 value of at least 32 bytes to capture the safety backup ' +
        '(recommended, and the same key the in-app backup and restore flows need), or set ' +
        'PRE_UPGRADE_BACKUP=off to apply migrations deliberately without a restore point.',
    );
    this.name = 'PreUpgradeBackupKeyMissingError';
  }
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
 * The missing-key check runs *after* those skips, not before, and is fatal rather than a warning.
 * Ordering it last is what keeps the change safe for deployments predating `CONFIG_ENCRYPTION_KEY`:
 * they boot unaffected until the moment they would otherwise migrate real data with no restore
 * point, which is exactly the moment the key stops being optional.
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
  if (!deps.encryptionKeyConfigured) {
    const error = new PreUpgradeBackupKeyMissingError(status.pending.length);
    deps.logger.error(error.message);
    throw error;
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

import { describe, expect, it, vi } from 'vitest';
import {
  ensurePreUpgradeBackup,
  PreUpgradeBackupKeyMissingError,
  type PreUpgradeBackupDeps,
} from './pre-upgrade-backup';

function baseDeps(overrides: Partial<PreUpgradeBackupDeps> = {}): PreUpgradeBackupDeps {
  return {
    enabled: true,
    encryptionKeyConfigured: true,
    keep: 3,
    pendingMigrations: vi
      .fn()
      .mockResolvedValue({ isFreshInstall: false, pending: ['20260101_a'] }),
    createArchive: vi.fn().mockResolvedValue(undefined),
    prune: vi.fn().mockResolvedValue([]),
    archiveKey: vi.fn().mockReturnValue('backups/pre-upgrade/2026.codabk'),
    logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...overrides,
  };
}

describe('ensurePreUpgradeBackup', () => {
  it('creates a safety backup and prunes when an existing instance has pending migrations', async () => {
    const deps = baseDeps({ prune: vi.fn().mockResolvedValue(['old-1']) });
    await ensurePreUpgradeBackup(deps);
    expect(deps.createArchive).toHaveBeenCalledWith('backups/pre-upgrade/2026.codabk');
    expect(deps.prune).toHaveBeenCalledTimes(1);
    expect(deps.logger.log).toHaveBeenCalledWith(expect.stringContaining('Pruned 1'));
  });

  it('skips entirely when opted out with PRE_UPGRADE_BACKUP=off', async () => {
    const deps = baseDeps({ enabled: false });
    await ensurePreUpgradeBackup(deps);
    expect(deps.pendingMigrations).not.toHaveBeenCalled();
    expect(deps.createArchive).not.toHaveBeenCalled();
    expect(deps.logger.warn).toHaveBeenCalledWith(expect.stringContaining('disabled'));
  });

  it('refuses to migrate real data when CONFIG_ENCRYPTION_KEY is not configured', async () => {
    const deps = baseDeps({ encryptionKeyConfigured: false });
    await expect(ensurePreUpgradeBackup(deps)).rejects.toBeInstanceOf(
      PreUpgradeBackupKeyMissingError,
    );
    expect(deps.createArchive).not.toHaveBeenCalled();
    expect(deps.logger.error).toHaveBeenCalledWith(expect.stringContaining('CONFIG_ENCRYPTION_KEY'));
  });

  it('names both supported ways forward when the key is missing', async () => {
    const deps = baseDeps({ encryptionKeyConfigured: false });
    await expect(ensurePreUpgradeBackup(deps)).rejects.toThrow(/PRE_UPGRADE_BACKUP=off/u);
    await expect(ensurePreUpgradeBackup(deps)).rejects.toThrow(/at least 32 bytes/u);
  });

  it('keeps the missing-key refusal out of the TLS bucket of the boot diagnostic classifier', async () => {
    // `classifyDatabaseError` scans the message text; `openssl` would match /ssl/ and render the
    // diagnostic page with TLS hints for what is a configuration problem.
    const deps = baseDeps({ encryptionKeyConfigured: false });
    await expect(ensurePreUpgradeBackup(deps)).rejects.toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('ssl') }) as Error,
    );
  });

  it('still boots a key-less legacy instance that has nothing pending', async () => {
    // Deployments predating CONFIG_ENCRYPTION_KEY keep upgrading untouched until the moment they
    // would migrate real data without a restore point.
    const deps = baseDeps({
      encryptionKeyConfigured: false,
      pendingMigrations: vi.fn().mockResolvedValue({ isFreshInstall: false, pending: [] }),
    });
    await expect(ensurePreUpgradeBackup(deps)).resolves.toBeUndefined();
    expect(deps.createArchive).not.toHaveBeenCalled();
  });

  it('still boots a key-less fresh install', async () => {
    const deps = baseDeps({
      encryptionKeyConfigured: false,
      pendingMigrations: vi.fn().mockResolvedValue({ isFreshInstall: true, pending: ['a'] }),
    });
    await expect(ensurePreUpgradeBackup(deps)).resolves.toBeUndefined();
    expect(deps.createArchive).not.toHaveBeenCalled();
  });

  it('respects the explicit opt-out even without the key', async () => {
    const deps = baseDeps({ enabled: false, encryptionKeyConfigured: false });
    await expect(ensurePreUpgradeBackup(deps)).resolves.toBeUndefined();
    expect(deps.pendingMigrations).not.toHaveBeenCalled();
  });

  it('skips a fresh install without touching object storage', async () => {
    const deps = baseDeps({
      pendingMigrations: vi.fn().mockResolvedValue({ isFreshInstall: true, pending: ['a'] }),
    });
    await ensurePreUpgradeBackup(deps);
    expect(deps.createArchive).not.toHaveBeenCalled();
  });

  it('skips when there are no pending migrations', async () => {
    const deps = baseDeps({
      pendingMigrations: vi.fn().mockResolvedValue({ isFreshInstall: false, pending: [] }),
    });
    await ensurePreUpgradeBackup(deps);
    expect(deps.createArchive).not.toHaveBeenCalled();
  });

  it('propagates a backup failure so boot re-enters the diagnostic loop', async () => {
    const deps = baseDeps({
      createArchive: vi.fn().mockRejectedValue(new Error('S3 unreachable')),
    });
    await expect(ensurePreUpgradeBackup(deps)).rejects.toThrow('S3 unreachable');
    expect(deps.prune).not.toHaveBeenCalled();
  });

  it('treats a pruning failure as non-fatal because the safety backup already exists', async () => {
    const deps = baseDeps({ prune: vi.fn().mockRejectedValue(new Error('delete denied')) });
    await expect(ensurePreUpgradeBackup(deps)).resolves.toBeUndefined();
    expect(deps.createArchive).toHaveBeenCalledTimes(1);
    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('retention pruning failed'),
    );
  });
});

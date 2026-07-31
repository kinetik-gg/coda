import { describe, expect, it } from 'vitest';
import {
  BACKUP_FORMAT_VERSION,
  BACKUP_IMPORT_MIN_VERSION,
  BACKUP_IMPORT_WINDOW,
  type BackupManifest,
  assertImportableFormatVersion,
  computeImportMinVersion,
  encodeBackupManifest,
  inventoryChecksum,
  objectArchivePath,
  objectKeyFromPath,
  validateBackupManifest,
} from './backup-format';

function baseManifest(): BackupManifest {
  const files = [
    {
      path: 'objects/project/a.pdf',
      bytes: 3,
      sha256: 'a'.repeat(64),
    },
  ];
  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    appVersion: '0.0.4',
    creationContext: { reason: 'manual', databaseName: 'coda', bucket: 'screenplays' },
    database: { path: 'database.dump', bytes: 10, sha256: 'b'.repeat(64) },
    authenticity: { algorithm: 'Ed25519', verificationKeySha256: 'c'.repeat(64) },
    objectStorage: { bucket: 'screenplays', files, inventorySha256: inventoryChecksum(files) },
  };
}

describe('backup format version window', () => {
  it('accepts the current version and refuses newer ones', () => {
    expect(() => assertImportableFormatVersion(BACKUP_FORMAT_VERSION)).not.toThrow();
    expect(() => assertImportableFormatVersion(BACKUP_FORMAT_VERSION + 1)).toThrow(
      /newer than this instance/u,
    );
  });

  it('accepts down to two versions back and refuses older', () => {
    expect(() => assertImportableFormatVersion(BACKUP_IMPORT_MIN_VERSION)).not.toThrow();
    expect(() => assertImportableFormatVersion(BACKUP_IMPORT_MIN_VERSION - 1)).toThrow(
      /older than the supported import window/u,
    );
  });

  it('rejects non-integer and out-of-window versions', () => {
    expect(() => assertImportableFormatVersion(0)).toThrow(
      /older than the supported import window/u,
    );
    expect(() => assertImportableFormatVersion(1.5)).toThrow(/invalid format version/u);
  });
});

describe('computeImportMinVersion', () => {
  it('is inert (clamps to 1) at every format version this codebase has actually shipped', () => {
    // BACKUP_FORMAT_VERSION has never exceeded BACKUP_IMPORT_WINDOW + 1 (3), so the
    // real BACKUP_IMPORT_MIN_VERSION has always been the clamp floor, not the
    // subtraction. This is what makes the "aged-out fixture" check currently dead
    // code in practice.
    expect(BACKUP_FORMAT_VERSION).toBeLessThanOrEqual(BACKUP_IMPORT_WINDOW + 1);
    expect(BACKUP_IMPORT_MIN_VERSION).toBe(1);
    for (let version = 1; version <= BACKUP_IMPORT_WINDOW + 1; version += 1) {
      expect(computeImportMinVersion(version, BACKUP_IMPORT_WINDOW)).toBe(1);
    }
  });

  it('starts biting once a hypothetical format version exceeds window + 1', () => {
    expect(computeImportMinVersion(4, 2)).toBe(2);
    expect(computeImportMinVersion(5, 2)).toBe(3);
    expect(computeImportMinVersion(10, 2)).toBe(8);
  });
});

describe('backup object path helpers', () => {
  it('round-trips a canonical key', () => {
    expect(objectArchivePath('project/uuid.pdf')).toBe('objects/project/uuid.pdf');
    expect(objectKeyFromPath('objects/project/uuid.pdf')).toBe('project/uuid.pdf');
  });

  it('rejects traversing, absolute, and backslash keys', () => {
    expect(() => objectArchivePath('../escape')).toThrow(/not canonical/u);
    expect(() => objectArchivePath('/absolute')).toThrow(/not canonical/u);
    expect(() => objectArchivePath('a\\b')).toThrow(/not canonical/u);
    expect(() => objectKeyFromPath('database.dump')).toThrow(/not canonical/u);
  });
});

describe('validateBackupManifest', () => {
  it('accepts a well-formed manifest', () => {
    const manifest = baseManifest();
    expect(validateBackupManifest(JSON.parse(encodeBackupManifest(manifest).toString()))).toEqual(
      manifest,
    );
  });

  it('rejects a bad inventory checksum', () => {
    const manifest = baseManifest();
    manifest.objectStorage.inventorySha256 = 'd'.repeat(64);
    expect(() => validateBackupManifest(manifest)).toThrow(/inventory checksum/u);
  });

  it('rejects a non-canonical object path', () => {
    const manifest = baseManifest();
    manifest.objectStorage.files = [{ path: 'objects/../evil', bytes: 1, sha256: 'a'.repeat(64) }];
    manifest.objectStorage.inventorySha256 = inventoryChecksum(manifest.objectStorage.files);
    expect(() => validateBackupManifest(manifest)).toThrow(/non-canonical/u);
  });

  it('rejects invalid metadata', () => {
    expect(() => validateBackupManifest(null)).toThrow(/must be an object/u);
    expect(() => validateBackupManifest({ ...baseManifest(), createdAt: 'nope' })).toThrow(
      /invalid timestamp/u,
    );
    expect(() => validateBackupManifest({ ...baseManifest(), appVersion: '' })).toThrow(
      /application version/u,
    );
    expect(() =>
      validateBackupManifest({ ...baseManifest(), authenticity: { algorithm: 'RSA' } }),
    ).toThrow(/authenticity/u);
    expect(() =>
      validateBackupManifest({ ...baseManifest(), database: { path: 'wrong.dump' } }),
    ).toThrow(/database record/u);
    expect(() =>
      validateBackupManifest({ ...baseManifest(), creationContext: { reason: 'x' } }),
    ).toThrow(/creation context/u);
  });
});

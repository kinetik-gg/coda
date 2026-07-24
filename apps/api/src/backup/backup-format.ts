import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { BACKUP_SIGNATURE_ALGORITHM } from './backup-signing';

/**
 * Current archive format version. Import accepts this version and the two previous
 * ones (see {@link BACKUP_IMPORT_MIN_VERSION}); newer archives are refused so an
 * older instance never silently ingests a format it cannot fully understand.
 */
export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_IMPORT_WINDOW = 2;
export const BACKUP_IMPORT_MIN_VERSION = Math.max(1, BACKUP_FORMAT_VERSION - BACKUP_IMPORT_WINDOW);

export const BACKUP_DATABASE_PATH = 'database.dump';
export const BACKUP_OBJECT_PREFIX = 'objects/';

export interface BackupChecksum {
  bytes: number;
  path: string;
  sha256: string;
}

export interface BackupManifest {
  formatVersion: number;
  createdAt: string;
  appVersion: string;
  creationContext: {
    reason: string;
    databaseName: string;
    bucket: string;
    composeProject?: string;
  };
  database: BackupChecksum;
  authenticity: {
    algorithm: typeof BACKUP_SIGNATURE_ALGORITHM;
    verificationKeySha256: string;
  };
  objectStorage: {
    bucket: string;
    files: BackupChecksum[];
    inventorySha256: string;
  };
}

export function inventoryChecksum(records: BackupChecksum[]): string {
  const canonical = records
    .map(({ bytes, path, sha256 }) => `${sha256}  ${bytes}  ${path}\n`)
    .join('');
  return createHash('sha256').update(canonical).digest('hex');
}

/** Maps a live object-storage key to its canonical in-archive path. */
export function objectArchivePath(key: string): string {
  if (
    !key ||
    key.includes('\\') ||
    posix.isAbsolute(key) ||
    posix.normalize(key) !== key ||
    key.split('/').includes('..')
  ) {
    throw new Error(`Backup object key is not canonical: ${key}`);
  }
  return `${BACKUP_OBJECT_PREFIX}${key}`;
}

/** Recovers the live object-storage key from a canonical in-archive path. */
export function objectKeyFromPath(path: string): string {
  if (!path.startsWith(BACKUP_OBJECT_PREFIX)) {
    throw new Error(`Backup object path is not canonical: ${path}`);
  }
  return path.slice(BACKUP_OBJECT_PREFIX.length);
}

/**
 * Enforces the N/N-1/N-2 import window before any archive payload is read. Newer
 * archives fail with an upgrade hint; archives older than the window fail because
 * the current instance no longer carries a migration path for them.
 */
export function assertImportableFormatVersion(version: number): void {
  if (!Number.isInteger(version)) {
    throw new Error('Backup manifest has an invalid format version');
  }
  if (version > BACKUP_FORMAT_VERSION) {
    throw new Error(
      `Backup archive format version ${version} is newer than this instance supports ` +
        `(${BACKUP_FORMAT_VERSION}); upgrade Coda before importing it`,
    );
  }
  if (version < BACKUP_IMPORT_MIN_VERSION) {
    throw new Error(
      `Backup archive format version ${version} is older than the supported import ` +
        `window (minimum ${BACKUP_IMPORT_MIN_VERSION})`,
    );
  }
}

function isChecksum(value: unknown, path?: string): value is BackupChecksum {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<BackupChecksum>;
  return (
    typeof record.path === 'string' &&
    (path === undefined || record.path === path) &&
    typeof record.bytes === 'number' &&
    Number.isInteger(record.bytes) &&
    record.bytes >= 0 &&
    typeof record.sha256 === 'string' &&
    /^[a-f0-9]{64}$/u.test(record.sha256)
  );
}

function assertCanonicalObjectPath(path: string): void {
  if (
    !path.startsWith(BACKUP_OBJECT_PREFIX) ||
    path.includes('\\') ||
    posix.isAbsolute(path) ||
    posix.normalize(path) !== path ||
    path === BACKUP_OBJECT_PREFIX
  ) {
    throw new Error(`Backup object has a non-canonical path: ${path}`);
  }
}

/**
 * Validates the structural integrity of a decoded manifest. Callers must have
 * already verified the manifest signature and format version before trusting the
 * returned value; this checks only shape, canonical paths, and the object
 * inventory checksum so that later streaming can rely on the recorded sizes.
 */
export function validateBackupManifest(value: unknown): BackupManifest {
  if (!value || typeof value !== 'object') throw new Error('Backup manifest must be an object');
  const manifest = value as Partial<BackupManifest>;
  assertImportableFormatVersion(manifest.formatVersion ?? Number.NaN);
  if (!manifest.createdAt || Number.isNaN(Date.parse(manifest.createdAt))) {
    throw new Error('Backup manifest has an invalid timestamp');
  }
  if (typeof manifest.appVersion !== 'string' || manifest.appVersion.length === 0) {
    throw new Error('Backup manifest is missing an application version');
  }
  const context = manifest.creationContext;
  if (
    !context ||
    typeof context.reason !== 'string' ||
    typeof context.databaseName !== 'string' ||
    typeof context.bucket !== 'string'
  ) {
    throw new Error('Backup manifest has an invalid creation context');
  }
  if (
    !manifest.authenticity ||
    manifest.authenticity.algorithm !== BACKUP_SIGNATURE_ALGORITHM ||
    !/^[a-f0-9]{64}$/u.test(manifest.authenticity.verificationKeySha256 ?? '')
  ) {
    throw new Error('Backup manifest has invalid authenticity metadata');
  }
  if (!isChecksum(manifest.database, BACKUP_DATABASE_PATH)) {
    throw new Error('Backup manifest has an invalid database record');
  }
  const storage = manifest.objectStorage;
  if (!storage || typeof storage.bucket !== 'string' || !Array.isArray(storage.files)) {
    throw new Error('Backup manifest has invalid object-storage metadata');
  }
  for (const record of storage.files) {
    if (!isChecksum(record)) throw new Error('Backup manifest has an invalid object record');
    assertCanonicalObjectPath(record.path);
  }
  if (inventoryChecksum(storage.files) !== storage.inventorySha256) {
    throw new Error('Backup object inventory checksum is invalid');
  }
  return manifest as BackupManifest;
}

/** Serializes a manifest to the canonical bytes that are signed and archived. */
export function encodeBackupManifest(manifest: BackupManifest): Buffer {
  return Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

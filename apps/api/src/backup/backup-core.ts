import { createHash } from 'node:crypto';
import {
  chmodSync,
  createReadStream,
  createWriteStream,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Writable } from 'node:stream';
import {
  ArchiveByteReader,
  readArchiveHeader,
  writeArchiveHeader,
  writeChunk,
} from './backup-archive';
import {
  BACKUP_DATABASE_PATH,
  BACKUP_FORMAT_VERSION,
  type BackupChecksum,
  type BackupManifest,
  assertImportableFormatVersion,
  encodeBackupManifest,
  inventoryChecksum,
  objectArchivePath,
  objectKeyFromPath,
  validateBackupManifest,
} from './backup-format';
import type {
  BackupProgressListener,
  DatabaseBackupEngine,
  ObjectBackupStore,
} from './backup-ports';
import {
  backupSigningKeyFingerprint,
  backupVerificationKeySha256,
  signBackupManifest,
  verifyBackupManifestSignature,
} from './backup-signing';

const READ_BUFFER_BYTES = 64 * 1024;

export interface CreateBackupInput {
  database: DatabaseBackupEngine;
  objects: ObjectBackupStore;
  sink: Writable;
  signingKey: Buffer | string;
  context: { reason: string; appVersion: string; databaseName: string; composeProject?: string };
  onProgress?: BackupProgressListener;
  workDir?: string;
}

export interface RestoreBackupInput {
  database: DatabaseBackupEngine;
  objects: ObjectBackupStore;
  source: AsyncIterable<Buffer>;
  verificationKey: Buffer | string;
  onProgress?: BackupProgressListener;
  workDir?: string;
}

function createStagingDir(workDir: string | undefined): string {
  const directory = mkdtempSync(join(workDir ?? tmpdir(), 'coda-backup-'));
  chmodSync(directory, 0o700);
  return directory;
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path, { highWaterMark: READ_BUFFER_BYTES })) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}

async function checksumRecord(path: string, archivePath: string): Promise<BackupChecksum> {
  return { bytes: statSync(path).size, path: archivePath, sha256: await sha256File(path) };
}

async function streamFileToSink(sink: Writable, path: string): Promise<void> {
  for await (const chunk of createReadStream(path, { highWaterMark: READ_BUFFER_BYTES })) {
    await writeChunk(sink, chunk as Buffer);
  }
}

async function stageEntry(
  reader: ArchiveByteReader,
  destination: string,
  record: BackupChecksum,
): Promise<void> {
  const hash = createHash('sha256');
  const out = createWriteStream(destination, { mode: 0o600, flags: 'wx' });
  try {
    await reader.pipeExactly(record.bytes, async (chunk) => {
      hash.update(chunk);
      await new Promise<void>((resolve, reject) => {
        out.write(chunk, (error) => (error ? reject(error) : resolve()));
      });
    });
    await new Promise<void>((resolve, reject) => {
      out.once('error', reject);
      out.end(resolve);
    });
  } catch (error) {
    out.destroy();
    throw error;
  }
  if (hash.digest('hex') !== record.sha256) {
    throw new Error(`Backup entry failed checksum verification: ${record.path}`);
  }
}

interface StagedObject {
  record: BackupChecksum;
  path: string;
}

async function collectObjects(input: CreateBackupInput, staging: string): Promise<StagedObject[]> {
  const entries = await input.objects.list();
  const staged: StagedObject[] = [];
  let index = 0;
  for (const entry of entries) {
    index += 1;
    const archivePath = objectArchivePath(entry.key);
    const destination = join(staging, ...archivePath.split('/'));
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    input.onProgress?.({
      phase: 'collect-object',
      key: entry.key,
      index,
      total: entries.length,
    });
    await input.objects.downloadTo(entry.key, destination);
    staged.push({ record: await checksumRecord(destination, archivePath), path: destination });
  }
  return staged;
}

function buildManifest(
  input: CreateBackupInput,
  database: BackupChecksum,
  files: BackupChecksum[],
): BackupManifest {
  const bucket = input.objects.bucket();
  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    appVersion: input.context.appVersion,
    creationContext: {
      reason: input.context.reason,
      databaseName: input.context.databaseName,
      bucket,
      ...(input.context.composeProject ? { composeProject: input.context.composeProject } : {}),
    },
    database,
    authenticity: {
      algorithm: 'Ed25519',
      verificationKeySha256: backupSigningKeyFingerprint(input.signingKey),
    },
    objectStorage: { bucket, files, inventorySha256: inventoryChecksum(files) },
  };
}

/**
 * Produces a signed, streamed backup archive. The database dump and every object
 * are staged under {@link CreateBackupInput.workDir} (the container tmpfs) so the
 * read-only rootfs is never written and the full archive is never held in memory;
 * the caller owns the sink lifecycle and is responsible for ending it.
 */
export async function createBackupArchive(input: CreateBackupInput): Promise<BackupManifest> {
  const staging = createStagingDir(input.workDir);
  try {
    const dumpPath = join(staging, BACKUP_DATABASE_PATH);
    input.onProgress?.({ phase: 'dump-database' });
    await input.database.dumpTo(dumpPath);
    const staged = await collectObjects(input, staging);
    const database = await checksumRecord(dumpPath, BACKUP_DATABASE_PATH);
    const manifest = buildManifest(
      input,
      database,
      staged.map((entry) => entry.record),
    );
    const manifestBytes = encodeBackupManifest(manifest);
    const signature = signBackupManifest(manifestBytes, input.signingKey);
    input.onProgress?.({ phase: 'write-archive', key: BACKUP_DATABASE_PATH });
    await writeArchiveHeader(input.sink, manifestBytes, signature);
    await streamFileToSink(input.sink, dumpPath);
    let index = 0;
    for (const entry of staged) {
      index += 1;
      input.onProgress?.({
        phase: 'write-archive',
        key: objectKeyFromPath(entry.record.path),
        index,
        total: staged.length,
      });
      await streamFileToSink(input.sink, entry.path);
    }
    input.onProgress?.({ phase: 'complete' });
    return manifest;
  } finally {
    rmSync(staging, { force: true, recursive: true });
  }
}

async function authenticateArchive(
  input: RestoreBackupInput,
  reader: ArchiveByteReader,
): Promise<BackupManifest> {
  const header = await readArchiveHeader(reader);
  const fingerprint = verifyBackupManifestSignature(
    header.manifestBytes,
    header.signatureText,
    input.verificationKey,
  );
  const manifest = validateBackupManifest(JSON.parse(header.manifestBytes.toString('utf8')));
  assertImportableFormatVersion(manifest.formatVersion);
  if (
    manifest.authenticity.verificationKeySha256 !== fingerprint ||
    backupVerificationKeySha256(input.verificationKey) !== fingerprint
  ) {
    throw new Error('Backup verification key does not match the signed manifest');
  }
  return manifest;
}

async function assertRestoreTarget(input: RestoreBackupInput): Promise<void> {
  if (await input.database.isInitialized()) {
    throw new Error('Restore refused: the target instance is already initialized');
  }
  if (!(await input.objects.isEmpty())) {
    throw new Error('Restore refused: the target object storage is not empty');
  }
}

async function stageArchivePayload(
  input: RestoreBackupInput,
  reader: ArchiveByteReader,
  manifest: BackupManifest,
  staging: string,
): Promise<{ key: string; path: string; size: number }[]> {
  await stageEntry(reader, join(staging, BACKUP_DATABASE_PATH), manifest.database);
  const staged: { key: string; path: string; size: number }[] = [];
  let index = 0;
  for (const record of manifest.objectStorage.files) {
    index += 1;
    const key = objectKeyFromPath(record.path);
    const destination = join(staging, ...record.path.split('/'));
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    input.onProgress?.({
      phase: 'verify-archive',
      key,
      index,
      total: manifest.objectStorage.files.length,
    });
    await stageEntry(reader, destination, record);
    staged.push({ key, path: destination, size: record.bytes });
  }
  return staged;
}

/**
 * Verifies, stages, and applies a signed backup archive into an uninitialized
 * instance. The signature, format-version window, and empty-target guards are all
 * enforced before any database or object write occurs; every staged entry is
 * checksum-verified before it is applied.
 */
export async function restoreBackupArchive(input: RestoreBackupInput): Promise<BackupManifest> {
  const reader = new ArchiveByteReader(input.source);
  const manifest = await authenticateArchive(input, reader);
  input.onProgress?.({ phase: 'verify-archive', key: BACKUP_DATABASE_PATH });
  await assertRestoreTarget(input);
  const staging = createStagingDir(input.workDir);
  try {
    const staged = await stageArchivePayload(input, reader, manifest, staging);
    input.onProgress?.({ phase: 'restore-database' });
    await input.database.restoreFrom(join(staging, BACKUP_DATABASE_PATH));
    let index = 0;
    for (const object of staged) {
      index += 1;
      input.onProgress?.({
        phase: 'restore-object',
        key: object.key,
        index,
        total: staged.length,
      });
      await input.objects.upload(object.key, object.path, object.size);
    }
    input.onProgress?.({ phase: 'complete' });
    return manifest;
  } finally {
    rmSync(staging, { force: true, recursive: true });
  }
}

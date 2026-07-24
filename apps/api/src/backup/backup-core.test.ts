import { generateKeyPairSync } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { Readable, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { BACKUP_ARCHIVE_MAGIC } from './backup-archive';
import { createBackupArchive, restoreBackupArchive } from './backup-core';
import {
  BACKUP_FORMAT_VERSION,
  type BackupManifest,
  encodeBackupManifest,
  inventoryChecksum,
} from './backup-format';
import type {
  BackupProgress,
  DatabaseBackupEngine,
  ObjectBackupStore,
  ObjectStoreEntry,
} from './backup-ports';
import { backupSigningKeyFingerprint, signBackupManifest } from './backup-signing';

export interface KeyPair {
  privateKey: string;
  publicKey: string;
}

export function ed25519KeyPair(): KeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKey: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    publicKey: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
  };
}

export class FakeDatabase implements DatabaseBackupEngine {
  initialized = false;
  restored: Buffer | undefined;

  constructor(private readonly dumpContent = Buffer.alloc(0)) {}

  isInitialized(): Promise<boolean> {
    return Promise.resolve(this.initialized);
  }

  dumpTo(path: string): Promise<void> {
    writeFileSync(path, this.dumpContent);
    return Promise.resolve();
  }

  restoreFrom(path: string): Promise<void> {
    this.restored = readFileSync(path);
    return Promise.resolve();
  }
}

export class FakeObjectStore implements ObjectBackupStore {
  readonly data = new Map<string, Buffer>();

  constructor(private readonly name = 'screenplays') {}

  bucket(): string {
    return this.name;
  }

  isEmpty(): Promise<boolean> {
    return Promise.resolve(this.data.size === 0);
  }

  list(): Promise<ObjectStoreEntry[]> {
    return Promise.resolve(
      [...this.data.entries()]
        .map(([key, value]) => ({ key, size: value.length }))
        .sort((left, right) => left.key.localeCompare(right.key)),
    );
  }

  downloadTo(key: string, path: string): Promise<void> {
    const value = this.data.get(key);
    if (!value) throw new Error(`missing object ${key}`);
    writeFileSync(path, value);
    return Promise.resolve();
  }

  upload(key: string, path: string): Promise<void> {
    this.data.set(key, readFileSync(path));
    return Promise.resolve();
  }
}

export class BufferSink extends Writable {
  private readonly chunks: Buffer[] = [];

  _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(Buffer.from(chunk));
    callback();
  }

  bytes(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

/** Yields the buffer in small chunks to exercise the streaming reader boundaries. */
function chunked(buffer: Buffer, size = 7): Readable {
  const parts: Buffer[] = [];
  for (let offset = 0; offset < buffer.length; offset += size) {
    parts.push(buffer.subarray(offset, offset + size));
  }
  return Readable.from(parts);
}

async function createFixtureArchive(keys: KeyPair): Promise<{
  archive: Buffer;
  manifest: BackupManifest;
  source: { database: FakeDatabase; objects: FakeObjectStore };
}> {
  const database = new FakeDatabase(Buffer.from('PGDMP-custom-format-body'));
  const objects = new FakeObjectStore('screenplays');
  objects.data.set('project-a/main.pdf', Buffer.from('the-pdf-bytes'));
  objects.data.set('project-b/plate.png', Buffer.from('the-image-bytes-larger'));
  const sink = new BufferSink();
  const manifest = await createBackupArchive({
    database,
    objects,
    sink,
    signingKey: keys.privateKey,
    context: { reason: 'manual', appVersion: '0.0.4', databaseName: 'coda' },
  });
  return { archive: sink.bytes(), manifest, source: { database, objects } };
}

function frameHeaderOnly(manifest: BackupManifest, signingKey: string): Buffer {
  const manifestBytes = encodeBackupManifest(manifest);
  const signature = Buffer.from(signBackupManifest(manifestBytes, signingKey), 'utf8');
  const manifestLength = Buffer.allocUnsafe(4);
  manifestLength.writeUInt32BE(manifestBytes.length, 0);
  const signatureLength = Buffer.allocUnsafe(4);
  signatureLength.writeUInt32BE(signature.length, 0);
  return Buffer.concat([
    BACKUP_ARCHIVE_MAGIC,
    manifestLength,
    manifestBytes,
    signatureLength,
    signature,
  ]);
}

describe('backup engine round-trip', () => {
  it('restores byte-consistent data on a fresh instance', async () => {
    const keys = ed25519KeyPair();
    const { archive, manifest } = await createFixtureArchive(keys);
    expect(manifest.formatVersion).toBe(BACKUP_FORMAT_VERSION);
    expect(manifest.objectStorage.files).toHaveLength(2);

    const database = new FakeDatabase();
    const objects = new FakeObjectStore('screenplays');
    const progress: BackupProgress[] = [];
    const restored = await restoreBackupArchive({
      database,
      objects,
      source: chunked(archive),
      verificationKey: keys.publicKey,
      onProgress: (event) => progress.push(event),
    });

    expect(database.restored).toEqual(Buffer.from('PGDMP-custom-format-body'));
    expect(objects.data.get('project-a/main.pdf')).toEqual(Buffer.from('the-pdf-bytes'));
    expect(objects.data.get('project-b/plate.png')).toEqual(Buffer.from('the-image-bytes-larger'));
    expect(restored.objectStorage.inventorySha256).toBe(manifest.objectStorage.inventorySha256);
    expect(progress.at(-1)?.phase).toBe('complete');
    expect(progress.some((event) => event.phase === 'restore-database')).toBe(true);
  });

  it('reports creation progress for each phase', async () => {
    const keys = ed25519KeyPair();
    const database = new FakeDatabase(Buffer.from('dump'));
    const objects = new FakeObjectStore();
    objects.data.set('p/a.bin', Buffer.from('x'));
    const phases: string[] = [];
    await createBackupArchive({
      database,
      objects,
      sink: new BufferSink(),
      signingKey: keys.privateKey,
      context: {
        reason: 'scheduled',
        appVersion: '0.0.4',
        databaseName: 'coda',
        composeProject: 'coda',
      },
      onProgress: (event) => phases.push(event.phase),
    });
    expect(phases).toContain('dump-database');
    expect(phases).toContain('collect-object');
    expect(phases).toContain('write-archive');
    expect(phases).toContain('complete');
  });
});

describe('backup engine rejection guards', () => {
  it('rejects a tampered manifest before any write', async () => {
    const keys = ed25519KeyPair();
    const { archive } = await createFixtureArchive(keys);
    const tampered = Buffer.from(archive);
    tampered[20] = (tampered[20] ?? 0) ^ 0xff; // flip a byte inside the manifest JSON
    const database = new FakeDatabase();
    const objects = new FakeObjectStore();
    await expect(
      restoreBackupArchive({
        database,
        objects,
        source: chunked(tampered),
        verificationKey: keys.publicKey,
      }),
    ).rejects.toThrow(/signature is invalid|invalid|manifest/u);
    expect(database.restored).toBeUndefined();
    expect(objects.data.size).toBe(0);
  });

  it('rejects tampered entry content by checksum before applying it', async () => {
    const keys = ed25519KeyPair();
    const { archive } = await createFixtureArchive(keys);
    const tampered = Buffer.from(archive);
    const last = tampered.length - 1;
    tampered[last] = (tampered[last] ?? 0) ^ 0xff; // corrupt the final object payload byte
    const database = new FakeDatabase();
    const objects = new FakeObjectStore();
    await expect(
      restoreBackupArchive({
        database,
        objects,
        source: chunked(tampered),
        verificationKey: keys.publicKey,
      }),
    ).rejects.toThrow(/checksum/u);
  });

  it('rejects a differently keyed verification key', async () => {
    const keys = ed25519KeyPair();
    const { archive } = await createFixtureArchive(keys);
    const other = ed25519KeyPair();
    await expect(
      restoreBackupArchive({
        database: new FakeDatabase(),
        objects: new FakeObjectStore(),
        source: chunked(archive),
        verificationKey: other.publicKey,
      }),
    ).rejects.toThrow(/signature is invalid/u);
  });

  it('refuses a future format version before any write', async () => {
    const keys = ed25519KeyPair();
    const manifest: BackupManifest = {
      formatVersion: BACKUP_FORMAT_VERSION + 1,
      createdAt: new Date().toISOString(),
      appVersion: '9.9.9',
      creationContext: { reason: 'manual', databaseName: 'coda', bucket: 'screenplays' },
      database: {
        path: 'database.dump',
        bytes: 0,
        sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      },
      authenticity: {
        algorithm: 'Ed25519',
        verificationKeySha256: backupSigningKeyFingerprint(keys.privateKey),
      },
      objectStorage: { bucket: 'screenplays', files: [], inventorySha256: inventoryChecksum([]) },
    };
    const database = new FakeDatabase();
    const objects = new FakeObjectStore();
    await expect(
      restoreBackupArchive({
        database,
        objects,
        source: chunked(frameHeaderOnly(manifest, keys.privateKey)),
        verificationKey: keys.publicKey,
      }),
    ).rejects.toThrow(/newer than this instance/u);
    expect(database.restored).toBeUndefined();
  });

  it('refuses to restore into an initialized instance', async () => {
    const keys = ed25519KeyPair();
    const { archive } = await createFixtureArchive(keys);
    const database = new FakeDatabase();
    database.initialized = true;
    const objects = new FakeObjectStore();
    await expect(
      restoreBackupArchive({
        database,
        objects,
        source: chunked(archive),
        verificationKey: keys.publicKey,
      }),
    ).rejects.toThrow(/already initialized/u);
    expect(database.restored).toBeUndefined();
  });

  it('refuses to restore into a non-empty object store', async () => {
    const keys = ed25519KeyPair();
    const { archive } = await createFixtureArchive(keys);
    const database = new FakeDatabase();
    const objects = new FakeObjectStore();
    objects.data.set('existing/file', Buffer.from('present'));
    await expect(
      restoreBackupArchive({
        database,
        objects,
        source: chunked(archive),
        verificationKey: keys.publicKey,
      }),
    ).rejects.toThrow(/not empty/u);
    expect(database.restored).toBeUndefined();
  });
});

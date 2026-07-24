import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StorageProbeResult } from '@coda/contracts';

import { StorageMigrationService } from './storage-migration.service';
import { BlobNotFoundError, type BlobStore } from './blob/blob-store';
import type { StorageMigrationState } from '../config/instance-config-codecs';

const OWNER = 'owner-1';
const SOURCE_BUCKET = 'source-bucket';
const TARGET_BUCKET = 'target-bucket';

const target = {
  provider: 'minio' as const,
  endpoint: 'http://minio2:9000',
  publicEndpoint: 'http://localhost:59100',
  region: 'us-east-1',
  bucket: TARGET_BUCKET,
  accessKeyId: 'access',
  secretAccessKey: 'x'.repeat(24),
  forcePathStyle: true,
};

const okProbe: StorageProbeResult = {
  ok: true,
  checks: [{ name: 'write', ok: true, detail: 'ok' }],
};
const badProbe: StorageProbeResult = {
  ok: false,
  checks: [{ name: 'write', ok: false, detail: 'denied' }],
};

async function readAll(body: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

interface Seed {
  id: string;
  objectKey: string;
  mimeType: string;
  bytes: Buffer;
}

function build(
  options: {
    objects?: Seed[];
    owner?: string | null;
    probe?: StorageProbeResult;
    lockAcquired?: boolean;
    initialState?: StorageMigrationState;
    sourceContent?: Map<string, Buffer>;
    targetContent?: Map<string, Buffer>;
  } = {},
) {
  const objects = options.objects ?? [];
  const sourceStore = options.sourceContent ?? new Map<string, Buffer>();
  const targetStore = options.targetContent ?? new Map<string, Buffer>();
  if (!options.sourceContent)
    for (const object of objects) sourceStore.set(object.objectKey, object.bytes);

  const makeStore = (map: Map<string, Buffer>): BlobStore =>
    ({
      get: vi.fn((key: string) => {
        const buffer = map.get(key);
        if (!buffer) return Promise.reject(new BlobNotFoundError(key));
        return Promise.resolve({ stream: Readable.from([buffer]) });
      }),
      put: vi.fn(async (key: string, body: Readable) => {
        map.set(key, await readAll(body));
      }),
      dispose: vi.fn(),
    }) as unknown as BlobStore;
  const sourceBlob = makeStore(sourceStore);
  const targetBlob = makeStore(targetStore);

  const configStore = new Map<string, unknown>();
  if (options.initialState) configStore.set('storage.migration', options.initialState);

  const instanceConfig = {
    getConfig: vi.fn((key: string) => Promise.resolve(configStore.get(key))),
    setConfig: vi.fn((key: string, value: unknown) => {
      configStore.set(key, value);
      return Promise.resolve();
    }),
    hasConfig: vi.fn((key: string) => Promise.resolve(configStore.has(key))),
    deleteConfig: vi.fn((key: string) => {
      configStore.delete(key);
      return Promise.resolve();
    }),
  };

  const prisma = {
    instanceSettings: {
      findFirst: vi
        .fn()
        .mockResolvedValue(options.owner === null ? null : { ownerUserId: options.owner ?? OWNER }),
    },
    storageObject: {
      aggregate: vi.fn().mockResolvedValue({
        _count: { id: objects.length },
        _sum: {
          sizeBytes: BigInt(objects.reduce((total, object) => total + object.bytes.length, 0)),
        },
      }),
      findMany: vi.fn(({ where, take }: { where: { id?: { gt: string } }; take: number }) => {
        const cursor = where.id?.gt;
        const eligible = objects
          .filter((object) => (cursor ? object.id > cursor : true))
          .sort((a, b) => (a.id < b.id ? -1 : 1))
          .slice(0, take)
          .map((object) => ({
            id: object.id,
            objectKey: object.objectKey,
            mimeType: object.mimeType,
            sizeBytes: BigInt(object.bytes.length),
          }));
        return Promise.resolve(eligible);
      }),
    },
  };

  const blobs = {
    activeBucket: vi.fn().mockReturnValue(SOURCE_BUCKET),
    active: vi.fn().mockReturnValue(sourceBlob),
    forConnection: vi.fn().mockReturnValue(targetBlob),
    swap: vi.fn(),
  };
  const validation = { probe: vi.fn().mockResolvedValue(options.probe ?? okProbe) };
  const lock = {
    runExclusively: vi.fn(async (_key: string, handler: (tx: unknown) => Promise<unknown>) => {
      if (options.lockAcquired === false) return { acquired: false };
      return { acquired: true, value: await handler({}) };
    }),
  };

  const service = new StorageMigrationService(
    prisma as never,
    instanceConfig as never,
    blobs as never,
    validation as never,
    lock as never,
  );
  return {
    service,
    instanceConfig,
    prisma,
    blobs,
    validation,
    lock,
    configStore,
    sourceStore,
    targetStore,
  };
}

function seed(count: number): Seed[] {
  return Array.from({ length: count }, (_unused, index) => ({
    id: `object-${index}`,
    objectKey: `project/key-${index}`,
    mimeType: 'application/octet-stream',
    bytes: Buffer.from(`payload-${index}-${'x'.repeat(index)}`),
  }));
}

function copyingState(overrides: Partial<StorageMigrationState> = {}): StorageMigrationState {
  return verifyingState({ phase: 'copying', ...overrides });
}

function verifyingState(overrides: Partial<StorageMigrationState> = {}): StorageMigrationState {
  return {
    phase: 'verifying',
    target,
    sourceBucket: SOURCE_BUCKET,
    copyCursor: null,
    verifyCursor: null,
    copiedObjects: 0,
    copiedBytes: 0,
    verifiedObjects: 0,
    totalObjects: 1,
    totalBytes: 0,
    mismatches: [],
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    reportGeneratedAt: null,
    error: null,
    ...overrides,
  };
}

describe('StorageMigrationService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects non-administrators and uninitialised instances', async () => {
    await expect(build({ owner: 'someone' }).service.status(OWNER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(build({ owner: null }).service.status(OWNER)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('reports the idle state when no migration exists', async () => {
    const status = await build().service.status(OWNER);
    expect(status.phase).toBe('idle');
    expect(status.canCutover).toBe(false);
    expect(status.report).toBeNull();
  });

  it('persists nothing when the target probe fails', async () => {
    const { service, instanceConfig } = build({ probe: badProbe });
    const result = await service.start(OWNER, target);
    expect(result.status).toBe('invalid');
    expect(result.probe).toBe(badProbe);
    expect(instanceConfig.setConfig).not.toHaveBeenCalled();
  });

  it('records a fresh copying migration with the object totals', async () => {
    const objects = seed(3);
    const { service, configStore } = build({ objects });
    const result = await service.start(OWNER, target);
    expect(result.status).toBe('started');
    expect(result.migration?.phase).toBe('copying');
    expect(result.migration?.totalObjects).toBe(3);
    const stored = configStore.get('storage.migration') as StorageMigrationState;
    expect(stored.phase).toBe('copying');
    expect(stored.sourceBucket).toBe(SOURCE_BUCKET);
    expect(stored.target.bucket).toBe(TARGET_BUCKET);
  });

  it('copies and verifies every object, then allows cutover', async () => {
    const objects = seed(3);
    const { service, targetStore, sourceStore, instanceConfig, blobs, configStore } = build({
      objects,
      initialState: copyingState({ totalObjects: 3, totalBytes: 99 }),
    });
    // Drive the whole copy → verify → verified run in one deterministic tick.
    await service.tick();

    for (const object of objects) {
      expect(targetStore.get(object.objectKey)).toEqual(sourceStore.get(object.objectKey));
    }
    const status = await service.status(OWNER);
    expect(status.phase).toBe('verified');
    expect(status.verifiedObjects).toBe(3);
    expect(status.report?.mismatches).toHaveLength(0);
    expect(status.canCutover).toBe(true);

    const afterCutover = await service.cutover(OWNER);
    expect(instanceConfig.setConfig).toHaveBeenCalledWith('storage.connection', target, OWNER);
    expect(blobs.swap).toHaveBeenCalledWith(target);
    expect(afterCutover.phase).toBe('cutover');
    expect((configStore.get('storage.migration') as StorageMigrationState).phase).toBe('cutover');
  });

  it('flags a checksum mismatch and blocks cutover', async () => {
    const object = seed(1)[0]!;
    // Same length so the size check passes and the checksum comparison is exercised.
    const sourceStore = new Map([[object.objectKey, Buffer.from('the-real-bytes')]]);
    const targetStore = new Map([[object.objectKey, Buffer.from('tampered-bytes')]]);
    const { service } = build({
      objects: [{ ...object, bytes: Buffer.from('the-real-bytes') }],
      sourceContent: sourceStore,
      targetContent: targetStore,
      initialState: verifyingState(),
    });
    await service.tick();
    const status = await service.status(OWNER);
    expect(status.phase).toBe('verified');
    expect(status.report?.mismatches).toEqual([
      { objectKey: object.objectKey, kind: 'checksum', detail: 'Checksum differs from source' },
    ]);
    expect(status.canCutover).toBe(false);
    await expect(service.cutover(OWNER)).rejects.toBeInstanceOf(ConflictException);
  });

  it('flags an object missing from the target', async () => {
    const object = seed(1)[0]!;
    const { service } = build({
      objects: [object],
      sourceContent: new Map([[object.objectKey, object.bytes]]),
      targetContent: new Map(),
      initialState: verifyingState(),
    });
    await service.tick();
    const status = await service.status(OWNER);
    expect(status.report?.mismatches[0]?.kind).toBe('missing');
  });

  it('flags a size mismatch against the database record', async () => {
    const object = seed(1)[0]!;
    const { service } = build({
      objects: [object],
      sourceContent: new Map([[object.objectKey, object.bytes]]),
      targetContent: new Map([[object.objectKey, Buffer.from('a-different-length')]]),
      initialState: verifyingState(),
    });
    await service.tick();
    expect((await service.status(OWNER)).report?.mismatches[0]?.kind).toBe('size');
  });

  it('flags an object unreadable at the source', async () => {
    const object = seed(1)[0]!;
    const { service } = build({
      objects: [object],
      sourceContent: new Map(),
      targetContent: new Map([[object.objectKey, object.bytes]]),
      initialState: verifyingState(),
    });
    await service.tick();
    expect((await service.status(OWNER)).report?.mismatches[0]?.kind).toBe('error');
  });

  it('fails the migration and leaves the source active when a copy errors', async () => {
    const object = seed(1)[0]!;
    const { service } = build({
      objects: [object],
      sourceContent: new Map(), // GetObject at the source will throw NoSuchKey mid-copy
      initialState: {
        ...verifyingState(),
        phase: 'copying',
      },
    });
    // Copy of a source object that cannot be read surfaces as a failure.
    await service.tick();
    const status = await service.status(OWNER);
    expect(status.phase).toBe('failed');
    expect(status.error).toBeTruthy();
  });

  it('is a no-op tick when no migration exists', async () => {
    const { service, lock } = build();
    expect(await service.tick()).toBe('idle');
    expect(lock.runExclusively).not.toHaveBeenCalled();
  });

  it('reports contention when another replica holds the lock', async () => {
    const { service } = build({
      objects: seed(1),
      lockAcquired: false,
      initialState: verifyingState(),
    });
    expect(await service.tick()).toBe('contended');
  });

  it('refuses cutover when no migration is in progress', async () => {
    await expect(build().service.cutover(OWNER)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('cancels a migration by discarding its record', async () => {
    const { service, instanceConfig, blobs } = build({ initialState: verifyingState() });
    const status = await service.cancel(OWNER);
    expect(instanceConfig.deleteConfig).toHaveBeenCalledWith('storage.migration');
    expect(status.phase).toBe('idle');
    // The active backend is never touched by a cancel.
    expect(blobs.swap).not.toHaveBeenCalled();
  });

  it('resumes verification from the persisted cursor', async () => {
    const objects = seed(2);
    const sourceStore = new Map(objects.map((object) => [object.objectKey, object.bytes]));
    const targetStore = new Map(objects.map((object) => [object.objectKey, object.bytes]));
    // Cursor already past the first object: only the second is verified this run.
    const { service } = build({
      objects,
      sourceContent: sourceStore,
      targetContent: targetStore,
      initialState: verifyingState({
        verifyCursor: 'object-0',
        verifiedObjects: 1,
        totalObjects: 2,
      }),
    });
    await service.tick();
    const status = await service.status(OWNER);
    expect(status.verifiedObjects).toBe(2);
    expect(status.canCutover).toBe(true);
  });

  it('wires and tears down the bootstrap driver timer without work when idle', async () => {
    const { service } = build();
    service.onApplicationBootstrap();
    // Let the fire-and-forget bootstrap tick settle before probing a fresh one.
    await new Promise((resolve) => setTimeout(resolve, 0));
    // No migration exists, so a driven tick is a cheap no-op.
    expect(await service.tick()).toBe('idle');
    service.onApplicationShutdown();
  });
});

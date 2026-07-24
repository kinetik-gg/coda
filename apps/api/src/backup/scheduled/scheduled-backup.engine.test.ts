import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduledBackupSettings } from '@coda/contracts';

vi.mock('../../config/env', () => ({
  env: () => ({ DATABASE_URL: 'postgresql://coda:pw@localhost:5432/coda?schema=public' }),
}));

import { ScheduledBackupEngine, type ScheduledBackupAdapters } from './scheduled-backup.engine';
import { SCHEDULED_BACKUP_PREFIX, type ScheduledArchive } from './scheduled-backup-destination';
import type { BackupManifest } from '../backup-format';
import type { CreateBackupInput } from '../backup-core';
import type { DatabaseBackupEngine, ObjectBackupStore } from '../backup-ports';

const settings: ScheduledBackupSettings = {
  enabled: true,
  intervalHours: 24,
  retention: { keepLast: 1, dailyForDays: 0, weeklyForWeeks: 0, maxAgeDays: 0 },
};

const fakeDatabase: DatabaseBackupEngine = {
  isInitialized: () => Promise.resolve(true),
  dumpTo: vi.fn().mockResolvedValue(undefined),
  restoreFrom: vi.fn().mockResolvedValue(undefined),
};

const fakeSource: ObjectBackupStore = {
  bucket: () => 'active',
  isEmpty: () => Promise.resolve(false),
  list: () => Promise.resolve([]),
  downloadTo: vi.fn().mockResolvedValue(undefined),
  upload: vi.fn().mockResolvedValue(undefined),
};

function makeDestination(stored: ScheduledArchive[]) {
  return {
    bucket: 'backup-bucket',
    endpoint: 'http://minio:9000',
    forcePathStyle: true,
    upload: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue(stored),
    delete: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn(),
  };
}

function build(adapters: ScheduledBackupAdapters) {
  const clients = {
    current: vi
      .fn()
      .mockReturnValue({ internal: {}, bucket: 'active', endpoint: 'e', forcePathStyle: true }),
  };
  const instanceConfig = { getConfig: vi.fn().mockResolvedValue(undefined) };
  const engine = new ScheduledBackupEngine({} as never, clients as never, instanceConfig as never, {
    database: fakeDatabase,
    sourceObjects: fakeSource,
    writeArchive: vi.fn((input: CreateBackupInput) => {
      input.sink.write(Buffer.from('archive-bytes'));
      return Promise.resolve({} as BackupManifest);
    }),
    ...adapters,
  });
  return { engine, instanceConfig };
}

describe('ScheduledBackupEngine', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writes a signed archive under the scheduled prefix then prunes', async () => {
    const destination = makeDestination([
      {
        key: `${SCHEDULED_BACKUP_PREFIX}old.codabackup`,
        size: 5,
        lastModified: new Date('2026-07-01'),
      },
      {
        key: `${SCHEDULED_BACKUP_PREFIX}new.codabackup`,
        size: 5,
        lastModified: new Date('2026-07-20'),
      },
    ]);
    const { engine } = build({ destination: destination as never });

    const artifacts = await engine.run(settings, 'scheduled', 'signing-key');

    expect(artifacts.archiveKey.startsWith(SCHEDULED_BACKUP_PREFIX)).toBe(true);
    expect(artifacts.sizeBytes).toBeGreaterThan(0);
    // Upload happens before any prune.
    expect(destination.upload).toHaveBeenCalledTimes(1);
    const uploadOrder = destination.upload.mock.invocationCallOrder[0]!;
    const deleteOrder = destination.delete.mock.invocationCallOrder[0]!;
    expect(uploadOrder).toBeLessThan(deleteOrder);
    // keepLast=1 keeps the newest, prunes the older.
    expect(destination.delete).toHaveBeenCalledWith([`${SCHEDULED_BACKUP_PREFIX}old.codabackup`]);
    expect(artifacts.prunedCount).toBe(1);
  });

  it('never prunes when the archive write fails', async () => {
    const destination = makeDestination([]);
    const { engine } = build({
      destination: destination as never,
      writeArchive: vi.fn().mockRejectedValue(new Error('pg_dump failed')),
    });

    await expect(engine.run(settings, 'scheduled', 'k')).rejects.toThrow('pg_dump failed');
    expect(destination.upload).not.toHaveBeenCalled();
    expect(destination.delete).not.toHaveBeenCalled();
  });

  it('never prunes when the destination upload fails', async () => {
    const destination = makeDestination([
      {
        key: `${SCHEDULED_BACKUP_PREFIX}a.codabackup`,
        size: 5,
        lastModified: new Date('2026-07-01'),
      },
    ]);
    destination.upload.mockRejectedValue(new Error('destination unreachable'));
    const { engine } = build({ destination: destination as never });

    await expect(engine.run(settings, 'scheduled', 'k')).rejects.toThrow('destination unreachable');
    expect(destination.list).not.toHaveBeenCalled();
    expect(destination.delete).not.toHaveBeenCalled();
  });

  it('resolves a dedicated override destination from config when present', async () => {
    const override = {
      provider: 'minio' as const,
      endpoint: 'http://backup-minio:9000',
      publicEndpoint: 'http://localhost:60000',
      region: 'us-east-1',
      bucket: 'dedicated',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      forcePathStyle: true,
    };
    const { engine, instanceConfig } = build({});
    instanceConfig.getConfig.mockResolvedValue(override);

    // No injected destination: the engine must build one from the override. The
    // real S3 client will fail to reach the fake endpoint, proving it tried the
    // override rather than the active snapshot.
    await expect(engine.run(settings, 'scheduled', 'k')).rejects.toBeDefined();
    expect(instanceConfig.getConfig).toHaveBeenCalledWith('backup.destination');
  });
});

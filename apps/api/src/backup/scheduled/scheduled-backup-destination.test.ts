import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import type { ObjectBackupStore, ObjectStoreEntry } from '../backup-ports';
import {
  BackupExcludingObjectStore,
  ScheduledBackupDestination,
  SCHEDULED_BACKUP_PREFIX,
  destinationFromConnection,
  destinationFromSnapshot,
  scheduledArchiveKey,
} from './scheduled-backup-destination';

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { force: true, recursive: true });
});

function tempFile(bytes: number): { path: string; size: number } {
  const dir = mkdtempSync(join(tmpdir(), 'coda-dest-test-'));
  scratch.push(dir);
  const path = join(dir, 'archive.bin');
  writeFileSync(path, Buffer.alloc(bytes, 1));
  return { path, size: bytes };
}

describe('scheduledArchiveKey', () => {
  it('produces a sortable, unique key under the scheduled prefix', () => {
    const now = new Date('2026-07-24T10:15:00.000Z');
    const key = scheduledArchiveKey(now);
    expect(key.startsWith(SCHEDULED_BACKUP_PREFIX)).toBe(true);
    expect(key.endsWith('.codabackup')).toBe(true);
    expect(key).not.toContain(':');
    expect(scheduledArchiveKey(now)).not.toBe(key);
  });
});

describe('ScheduledBackupDestination', () => {
  it('uploads an archive under the scheduled prefix with an explicit length', async () => {
    const send = vi.fn(async (command: PutObjectCommand) => {
      const body = command.input.Body as NodeJS.ReadableStream | undefined;
      if (body && typeof body.on === 'function') {
        await new Promise<void>((resolve, reject) => {
          body.on('end', resolve).on('error', reject).resume();
        });
      }
      return {};
    });
    const destination = new ScheduledBackupDestination(
      { send } as unknown as S3Client,
      'backup-bucket',
      'http://minio:9000',
      true,
    );
    const file = tempFile(64);
    const key = `${SCHEDULED_BACKUP_PREFIX}archive.codabackup`;

    await destination.upload(key, file.path, file.size);

    const command = send.mock.calls[0]![0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input.Bucket).toBe('backup-bucket');
    expect(command.input.Key).toBe(key);
    expect(command.input.ContentLength).toBe(64);
  });

  it('lists paginated archives filtering out folder placeholders', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        Contents: [
          { Key: `${SCHEDULED_BACKUP_PREFIX}`, Size: 0 },
          {
            Key: `${SCHEDULED_BACKUP_PREFIX}a.codabackup`,
            Size: 10,
            LastModified: new Date('2026-07-01'),
          },
        ],
        IsTruncated: true,
        NextContinuationToken: 'next',
      })
      .mockResolvedValueOnce({
        Contents: [
          {
            Key: `${SCHEDULED_BACKUP_PREFIX}b.codabackup`,
            Size: 20,
            LastModified: new Date('2026-07-02'),
          },
        ],
        IsTruncated: false,
      });
    const destination = new ScheduledBackupDestination(
      { send } as unknown as S3Client,
      'backup-bucket',
      'http://minio:9000',
      true,
    );

    const archives = await destination.list();

    expect(send.mock.calls[0]![0]).toBeInstanceOf(ListObjectsV2Command);
    expect((send.mock.calls[0]![0] as ListObjectsV2Command).input.Prefix).toBe(
      SCHEDULED_BACKUP_PREFIX,
    );
    expect(archives.map((archive) => archive.key)).toEqual([
      `${SCHEDULED_BACKUP_PREFIX}a.codabackup`,
      `${SCHEDULED_BACKUP_PREFIX}b.codabackup`,
    ]);
  });

  it('deletes keys in batched requests and skips an empty list', async () => {
    const send = vi.fn().mockResolvedValue({});
    const destination = new ScheduledBackupDestination(
      { send } as unknown as S3Client,
      'backup-bucket',
      'http://minio:9000',
      true,
    );

    await destination.delete([]);
    expect(send).not.toHaveBeenCalled();

    await destination.delete(['k1', 'k2']);
    const command = send.mock.calls[0]![0] as DeleteObjectsCommand;
    expect(command).toBeInstanceOf(DeleteObjectsCommand);
    expect(command.input.Delete?.Objects).toEqual([{ Key: 'k1' }, { Key: 'k2' }]);
  });
});

describe('destination factories', () => {
  it('builds from an active storage snapshot without owning the client', () => {
    const snapshot = {
      internal: { send: vi.fn() },
      bucket: 'active-bucket',
      endpoint: 'http://minio:9000',
      forcePathStyle: true,
    };
    const destination = destinationFromSnapshot(snapshot as never);
    expect(destination.bucket).toBe('active-bucket');
    expect(destination.endpoint).toBe('http://minio:9000');
  });

  it('builds a dedicated client from an override connection', () => {
    const destination = destinationFromConnection({
      provider: 'minio',
      endpoint: 'http://backup-minio:9000',
      publicEndpoint: 'http://localhost:60000',
      region: 'us-east-1',
      bucket: 'dedicated-backup',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      forcePathStyle: true,
    });
    expect(destination.bucket).toBe('dedicated-backup');
    destination.destroy();
  });
});

describe('BackupExcludingObjectStore', () => {
  const downloadTo = vi.fn().mockResolvedValue(undefined);
  const upload = vi.fn().mockResolvedValue(undefined);
  const inner: ObjectBackupStore = {
    bucket: () => 'active-bucket',
    isEmpty: () => Promise.resolve(false),
    list: (): Promise<ObjectStoreEntry[]> =>
      Promise.resolve([
        { key: 'project/a.pdf', size: 1 },
        { key: `${SCHEDULED_BACKUP_PREFIX}old.codabackup`, size: 2 },
        { key: 'project/b.pdf', size: 3 },
      ]),
    downloadTo,
    upload,
  };

  it('excludes stored scheduled archives from enumeration', async () => {
    const store = new BackupExcludingObjectStore(inner);
    const entries = await store.list();
    expect(entries.map((entry) => entry.key)).toEqual(['project/a.pdf', 'project/b.pdf']);
    expect(store.bucket()).toBe('active-bucket');
    expect(await store.isEmpty()).toBe(false);
  });

  it('delegates object access unchanged', async () => {
    const store = new BackupExcludingObjectStore(inner);
    await store.downloadTo('project/a.pdf', '/tmp/x');
    await store.upload('project/a.pdf', '/tmp/x', 1);
    expect(downloadTo).toHaveBeenCalledWith('project/a.pdf', '/tmp/x');
    expect(upload).toHaveBeenCalledWith('project/a.pdf', '/tmp/x', 1);
  });
});

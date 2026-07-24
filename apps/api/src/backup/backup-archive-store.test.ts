import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { afterEach, describe, expect, it } from 'vitest';
import { PRE_UPGRADE_BACKUP_PREFIX, S3BackupArchiveStore } from './backup-archive-store';

interface ListPage {
  Contents?: { Key: string }[];
  IsTruncated?: boolean;
  NextContinuationToken?: string;
}

class FakeS3Client {
  listPages: ListPage[] = [];
  put: { key?: string; body: Buffer; length?: number } = { body: Buffer.alloc(0) };
  deleted: string[] = [];
  private listIndex = 0;

  async send(command: unknown): Promise<unknown> {
    if (command instanceof ListObjectsV2Command) return this.listPages[this.listIndex++] ?? {};
    if (command instanceof PutObjectCommand) {
      const chunks: Buffer[] = [];
      for await (const chunk of command.input.Body as AsyncIterable<Buffer>) {
        chunks.push(Buffer.from(chunk));
      }
      this.put = {
        key: command.input.Key,
        body: Buffer.concat(chunks),
        length: command.input.ContentLength,
      };
      return {};
    }
    if (command instanceof DeleteObjectsCommand) {
      this.deleted = (command.input.Delete?.Objects ?? []).map((entry) => entry.Key ?? '');
      return {};
    }
    throw new Error('unexpected command');
  }
}

function store(fake: FakeS3Client): S3BackupArchiveStore {
  return new S3BackupArchiveStore(fake as unknown as S3Client, 'screenplays');
}

describe('S3BackupArchiveStore', () => {
  const temporary: string[] = [];
  afterEach(() => {
    for (const path of temporary.splice(0)) rmSync(path, { force: true, recursive: true });
  });

  it('uploads a staged archive with a content length', async () => {
    const fake = new FakeS3Client();
    const dir = mkdtempSync(join(tmpdir(), 'coda-archive-test-'));
    temporary.push(dir);
    const path = join(dir, 'archive.codabk');
    writeFileSync(path, Buffer.from('signed-archive'));
    await store(fake).put(`${PRE_UPGRADE_BACKUP_PREFIX}2026.codabk`, path, 14);
    expect(fake.put.key).toBe(`${PRE_UPGRADE_BACKUP_PREFIX}2026.codabk`);
    expect(fake.put.body).toEqual(Buffer.from('signed-archive'));
    expect(fake.put.length).toBe(14);
    expect(readFileSync(path)).toEqual(Buffer.from('signed-archive'));
  });

  it('lists archive keys under a prefix across pagination, sorted oldest-first', async () => {
    const fake = new FakeS3Client();
    fake.listPages = [
      {
        Contents: [{ Key: 'backups/pre-upgrade/b' }],
        IsTruncated: true,
        NextContinuationToken: 'p',
      },
      { Contents: [{ Key: 'backups/pre-upgrade/a' }] },
    ];
    expect(await store(fake).list(PRE_UPGRADE_BACKUP_PREFIX)).toEqual([
      'backups/pre-upgrade/a',
      'backups/pre-upgrade/b',
    ]);
  });

  it('keeps the newest N archives and deletes the rest', async () => {
    const fake = new FakeS3Client();
    fake.listPages = [
      {
        Contents: [
          { Key: 'backups/pre-upgrade/1' },
          { Key: 'backups/pre-upgrade/2' },
          { Key: 'backups/pre-upgrade/3' },
          { Key: 'backups/pre-upgrade/4' },
        ],
      },
    ];
    const pruned = await store(fake).pruneToLast(PRE_UPGRADE_BACKUP_PREFIX, 2);
    expect(pruned).toEqual(['backups/pre-upgrade/1', 'backups/pre-upgrade/2']);
    expect(fake.deleted).toEqual(['backups/pre-upgrade/1', 'backups/pre-upgrade/2']);
  });

  it('deletes nothing when the archive count is within the retention limit', async () => {
    const fake = new FakeS3Client();
    fake.listPages = [{ Contents: [{ Key: 'backups/pre-upgrade/1' }] }];
    expect(await store(fake).pruneToLast(PRE_UPGRADE_BACKUP_PREFIX, 3)).toEqual([]);
    expect(fake.deleted).toEqual([]);
  });
});

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { afterEach, describe, expect, it } from 'vitest';
import { S3ObjectBackupStore } from './backup-s3';

interface ListPage {
  Contents?: { Key: string; Size: number }[];
  IsTruncated?: boolean;
  NextContinuationToken?: string;
}

class FakeS3Client {
  listPages: ListPage[] = [];
  getBody = Buffer.alloc(0);
  put: { key?: string; body: Buffer; length?: number } = { body: Buffer.alloc(0) };
  private listIndex = 0;

  async send(command: unknown): Promise<unknown> {
    if (command instanceof ListObjectsV2Command) {
      return this.listPages[this.listIndex++] ?? {};
    }
    if (command instanceof GetObjectCommand) {
      return { Body: Readable.from([this.getBody]) };
    }
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
    throw new Error('unexpected command');
  }
}

function store(fake: FakeS3Client): S3ObjectBackupStore {
  return new S3ObjectBackupStore(fake as unknown as S3Client, 'screenplays');
}

describe('S3ObjectBackupStore', () => {
  const temporary: string[] = [];
  afterEach(() => {
    for (const path of temporary.splice(0)) rmSync(path, { force: true, recursive: true });
  });

  it('reports the configured bucket', () => {
    expect(store(new FakeS3Client()).bucket()).toBe('screenplays');
  });

  it('detects an empty and a populated bucket', async () => {
    const empty = new FakeS3Client();
    empty.listPages = [{ Contents: [] }];
    expect(await store(empty).isEmpty()).toBe(true);
    const populated = new FakeS3Client();
    populated.listPages = [{ Contents: [{ Key: 'a', Size: 1 }] }];
    expect(await store(populated).isEmpty()).toBe(false);
  });

  it('lists across pagination and sorts by key', async () => {
    const fake = new FakeS3Client();
    fake.listPages = [
      { Contents: [{ Key: 'b/2', Size: 2 }], IsTruncated: true, NextContinuationToken: 'p2' },
      { Contents: [{ Key: 'a/1', Size: 1 }], IsTruncated: false },
    ];
    expect(await store(fake).list()).toEqual([
      { key: 'a/1', size: 1 },
      { key: 'b/2', size: 2 },
    ]);
  });

  it('hides the reserved backups/ prefix from enumeration and emptiness checks', async () => {
    const onlyBackups = new FakeS3Client();
    onlyBackups.listPages = [{ Contents: [{ Key: 'backups/pre-upgrade/x.codabk', Size: 9 }] }];
    expect(await store(onlyBackups).isEmpty()).toBe(true);

    const mixed = new FakeS3Client();
    mixed.listPages = [
      {
        Contents: [
          { Key: 'backups/pre-upgrade/x.codabk', Size: 9 },
          { Key: 'project/a.pdf', Size: 3 },
        ],
      },
    ];
    expect(await store(mixed).isEmpty()).toBe(false);
    const listed = new FakeS3Client();
    listed.listPages = [
      {
        Contents: [
          { Key: 'backups/pre-upgrade/x.codabk', Size: 9 },
          { Key: 'project/a.pdf', Size: 3 },
        ],
      },
    ];
    expect(await store(listed).list()).toEqual([{ key: 'project/a.pdf', size: 3 }]);
  });

  it('streams a download to a file', async () => {
    const fake = new FakeS3Client();
    fake.getBody = Buffer.from('object-payload');
    const dir = mkdtempSync(join(tmpdir(), 'coda-s3-test-'));
    temporary.push(dir);
    const path = join(dir, 'out.bin');
    await store(fake).downloadTo('project/a.pdf', path);
    expect(readFileSync(path)).toEqual(Buffer.from('object-payload'));
  });

  it('streams an upload from a file with a content length', async () => {
    const fake = new FakeS3Client();
    const dir = mkdtempSync(join(tmpdir(), 'coda-s3-test-'));
    temporary.push(dir);
    const path = join(dir, 'in.bin');
    writeFileSync(path, Buffer.from('upload-payload'));
    await store(fake).upload('project/a.pdf', path, 14);
    expect(fake.put.key).toBe('project/a.pdf');
    expect(fake.put.body).toEqual(Buffer.from('upload-payload'));
    expect(fake.put.length).toBe(14);
  });
});

import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectStream } from '../collect-stream';
import { BlobNotFoundError } from '../blob-store';
import { BlobProxySigner } from './blob-proxy-signer';
import {
  BlobAlreadyExistsError,
  BlobKeyError,
  BlobTooLargeError,
  FsBlobStore,
} from './fs-blob-store';

let root: string;
let signer: BlobProxySigner;
let store: FsBlobStore;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'coda-fs-blob-'));
  signer = new BlobProxySigner();
  store = new FsBlobStore({
    root,
    signer,
    appOrigin: 'http://app.test',
    uploadTtlSeconds: 900,
    readTtlSeconds: 300,
  });
  await store.init();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function put(
  key: string,
  body: string,
  options: Record<string, unknown> = {},
): Promise<void> {
  await store.put(key, Readable.from([Buffer.from(body)]), {
    contentType: 'application/octet-stream',
    ...options,
  });
}

async function tmpEntries(): Promise<string[]> {
  return readdir(join(root, 'tmp'));
}

describe('FsBlobStore transfers', () => {
  it('writes an object and reads it back with a metadata sidecar', async () => {
    await put('project-1/object-1', 'hello world', { contentType: 'text/plain' });
    const stat = await store.stat('project-1/object-1');
    expect(stat).toEqual({ size: 11, contentType: 'text/plain' });
    const { stream } = await store.get('project-1/object-1');
    expect((await collectStream(stream)).toString()).toBe('hello world');
  });

  it('serves ranged reads with S3-inclusive end semantics', async () => {
    await put('project-1/object-1', 'hello world');
    const head = await store.get('project-1/object-1', { range: { start: 0, end: 4 } });
    expect((await collectStream(head.stream)).toString()).toBe('hello');
    const tail = await store.get('project-1/object-1', { range: { start: 6 } });
    expect((await collectStream(tail.stream)).toString()).toBe('world');
  });

  it('returns an empty stream when the range starts at or past the end', async () => {
    await put('project-1/object-1', 'hi');
    const { stream } = await store.get('project-1/object-1', { range: { start: 5, end: 9 } });
    expect((await collectStream(stream)).toString()).toBe('');
  });

  it('throws BlobNotFoundError for a missing object on get and stat', async () => {
    await expect(store.get('project-1/missing')).rejects.toBeInstanceOf(BlobNotFoundError);
    await expect(store.stat('project-1/missing')).rejects.toBeInstanceOf(BlobNotFoundError);
  });

  it('reports a stray object with no sidecar as absent', async () => {
    await put('project-1/object-1', 'data');
    await rm(join(root, 'objects', 'project-1', 'object-1.meta.json'));
    await expect(store.stat('project-1/object-1')).rejects.toBeInstanceOf(BlobNotFoundError);
  });

  it('deletes object and sidecar and is idempotent', async () => {
    await put('project-1/object-1', 'data');
    await store.delete('project-1/object-1');
    await expect(store.stat('project-1/object-1')).rejects.toBeInstanceOf(BlobNotFoundError);
    await expect(store.delete('project-1/object-1')).resolves.toBeUndefined();
  });

  it('lists objects sorted by key, excluding sidecars', async () => {
    await put('project-1/b', 'bb');
    await put('project-1/a', 'a');
    await put('project-2/c', 'ccc');
    expect(await store.list()).toEqual([
      { key: 'project-1/a', size: 1 },
      { key: 'project-1/b', size: 2 },
      { key: 'project-2/c', size: 3 },
    ]);
    expect(await store.list({ prefix: 'project-1/' })).toHaveLength(2);
  });
});

describe('FsBlobStore conditional create and size ceilings', () => {
  it('rejects a conditional create when the key already exists, without truncating it', async () => {
    await put('project-1/object-1', 'original');
    await expect(
      put('project-1/object-1', 'replacement', { ifNoneMatch: true }),
    ).rejects.toBeInstanceOf(BlobAlreadyExistsError);
    const { stream } = await store.get('project-1/object-1');
    expect((await collectStream(stream)).toString()).toBe('original');
    expect(await tmpEntries()).toHaveLength(0);
  });

  it('aborts mid-stream when maxBytes is exceeded and never writes the object', async () => {
    const body = Readable.from([Buffer.from('a'.repeat(4)), Buffer.from('b'.repeat(4))]);
    await expect(
      store.put('project-1/object-1', body, {
        contentType: 'application/octet-stream',
        maxBytes: 5,
      }),
    ).rejects.toBeInstanceOf(BlobTooLargeError);
    await expect(store.stat('project-1/object-1')).rejects.toBeInstanceOf(BlobNotFoundError);
    expect(await tmpEntries()).toHaveLength(0);
  });

  it('leaves no object or staged file when the source stream errors', async () => {
    const body = new Readable({
      read() {
        this.push(Buffer.from('partial'));
        this.destroy(new Error('source failed'));
      },
    });
    await expect(
      store.put('project-1/object-1', body, { contentType: 'application/octet-stream' }),
    ).rejects.toThrow('source failed');
    await expect(store.stat('project-1/object-1')).rejects.toBeInstanceOf(BlobNotFoundError);
    expect(await tmpEntries()).toHaveLength(0);
  });
});

describe('FsBlobStore key safety', () => {
  const unsafe = [
    '../escape',
    'a/../../b',
    '/absolute',
    'foo/../bar',
    'back\\slash',
    'trailing/',
    'double//slash',
    '',
    'has\0null',
    '.',
    'a/..',
    'object.meta.json',
  ];

  for (const key of unsafe) {
    it(`refuses to write outside the root for key ${JSON.stringify(key)}`, async () => {
      await expect(put(key, 'x')).rejects.toBeInstanceOf(BlobKeyError);
      await expect(store.get(key)).rejects.toBeInstanceOf(BlobKeyError);
    });
  }

  it('does not create files outside the configured root under traversal attempts', async () => {
    const sentinel = join(root, '..', 'coda-escape-sentinel');
    await expect(put('../coda-escape-sentinel', 'x')).rejects.toBeInstanceOf(BlobKeyError);
    await expect(readFile(sentinel)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('FsBlobStore proxy targets', () => {
  it('mints an app-origin upload URL bound to the key and declared length', async () => {
    const target = await store.createUpload('project-1/object-1', {
      contentType: 'application/pdf',
      contentLength: 2_048,
    });
    expect(target.expiresIn).toBe(900);
    const token = target.url.replace('http://app.test/api/v1/blob/upload/', '');
    const grant = signer.verifyUpload(token);
    expect(grant).toMatchObject({
      key: 'project-1/object-1',
      contentType: 'application/pdf',
      contentLength: 2_048,
      maxBytes: 2_048,
    });
  });

  it('mints an app-origin download URL carrying the response headers', async () => {
    const target = await store.createReadUrl('project-1/object-1', {
      disposition: 'inline; filename="x.pdf"',
      contentType: 'application/pdf',
    });
    expect(target.expiresIn).toBe(300);
    const token = target.url.replace('http://app.test/api/v1/blob/download/', '');
    expect(signer.verifyDownload(token).disposition).toBe('inline; filename="x.pdf"');
  });

  it('capabilities advertise a proxied backend', () => {
    expect(store.capabilities).toEqual({ directUpload: false, presignedRead: false });
    store.dispose();
  });
});

describe('FsBlobStore healthcheck', () => {
  it('creates the layout and confirms the objects directory is writable', async () => {
    const fresh = await mkdtemp(join(tmpdir(), 'coda-fs-health-'));
    const healthStore = new FsBlobStore({
      root: fresh,
      signer,
      appOrigin: 'http://app.test',
      uploadTtlSeconds: 900,
      readTtlSeconds: 300,
    });
    await expect(healthStore.healthcheck()).resolves.toBeUndefined();
    await writeFile(join(fresh, 'objects', 'probe'), 'ok');
    await rm(fresh, { recursive: true, force: true });
  });
});

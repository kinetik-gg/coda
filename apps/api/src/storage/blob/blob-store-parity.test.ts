import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { S3Client } from '@aws-sdk/client-s3';
import { BlobNotFoundError, type BlobStore } from './blob-store';
import { collectStream } from './collect-stream';
import { BlobProxySigner } from './fs/blob-proxy-signer';
import { FsBlobStore } from './fs/fs-blob-store';
import { S3BlobStore, type S3BlobStoreSnapshot } from './s3/s3-blob-store';

/**
 * The driver-parity proof: one behavioural contract exercised against the FS
 * driver (a real tmpdir, always) and the S3 driver (a real object store from the
 * compose stack, when `CODA_PARITY_S3=1`). Both must answer the BlobStore seam
 * identically for the transfer path to be backend-agnostic. FS-only fault
 * injection (mid-stream maxBytes, no-truncate) lives in fs-blob-store.test.ts.
 */
interface Harness {
  store: BlobStore;
  keyFor(name: string): string;
  teardown(): Promise<void>;
}

function contract(name: string, makeHarness: () => Promise<Harness>): void {
  describe(`BlobStore contract: ${name}`, () => {
    let harness: Harness;

    beforeAll(async () => {
      harness = await makeHarness();
    });

    afterAll(async () => {
      await harness.teardown();
    });

    async function put(key: string, body: string, contentType = 'text/plain'): Promise<void> {
      await harness.store.put(key, Readable.from([Buffer.from(body)]), {
        contentType,
        contentLength: Buffer.byteLength(body),
        ifNoneMatch: true,
      });
    }

    it('stat returns size and content type after a put', async () => {
      const key = harness.keyFor('stat');
      await put(key, 'hello world', 'application/pdf');
      expect(await harness.store.stat(key)).toEqual({ size: 11, contentType: 'application/pdf' });
    });

    it('get streams the full object', async () => {
      const key = harness.keyFor('get-full');
      await put(key, 'full-object-body');
      const { stream } = await harness.store.get(key);
      expect((await collectStream(stream)).toString()).toBe('full-object-body');
    });

    it('get honours an inclusive byte range', async () => {
      const key = harness.keyFor('get-range');
      await put(key, 'hello world');
      const { stream } = await harness.store.get(key, { range: { start: 0, end: 4 } });
      expect((await collectStream(stream)).toString()).toBe('hello');
    });

    it('conditional create rejects a duplicate key', async () => {
      const key = harness.keyFor('conditional');
      await put(key, 'original');
      await expect(put(key, 'replacement')).rejects.toBeDefined();
      const { stream } = await harness.store.get(key);
      expect((await collectStream(stream)).toString()).toBe('original');
    });

    it('stat and get throw BlobNotFoundError for a missing key', async () => {
      const key = harness.keyFor('missing');
      await expect(harness.store.stat(key)).rejects.toBeInstanceOf(BlobNotFoundError);
      await expect(harness.store.get(key)).rejects.toBeInstanceOf(BlobNotFoundError);
    });

    it('delete removes the object and is idempotent', async () => {
      const key = harness.keyFor('delete');
      await put(key, 'to-remove');
      await harness.store.delete(key);
      await expect(harness.store.stat(key)).rejects.toBeInstanceOf(BlobNotFoundError);
      await expect(harness.store.delete(key)).resolves.toBeUndefined();
    });

    it('list enumerates objects under a prefix sorted by key', async () => {
      const prefix = `${harness.keyFor('list')}/`;
      await put(`${prefix}b`, 'bb');
      await put(`${prefix}a`, 'a');
      const listed = await harness.store.list({ prefix });
      expect(listed.map((entry) => entry.key)).toEqual([`${prefix}a`, `${prefix}b`]);
      expect(listed.find((entry) => entry.key === `${prefix}a`)?.size).toBe(1);
    });
  });
}

contract('filesystem driver (tmpdir)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coda-parity-fs-'));
  const store = new FsBlobStore({
    root,
    signer: new BlobProxySigner(),
    appOrigin: 'http://app.test',
    uploadTtlSeconds: 900,
    readTtlSeconds: 300,
  });
  await store.init();
  const run = randomUUID();
  return {
    store,
    keyFor: (name) => `parity/${run}/${name}`,
    teardown: () => rm(root, { recursive: true, force: true }),
  };
});

// The S3 side runs only when the compose stack (or a local MinIO) is reachable
// and CODA_PARITY_S3=1 is set; otherwise it is not registered at all, so the
// unit run never depends on a live object store. CI's integration stage sets it.
const s3Enabled = process.env.CODA_PARITY_S3 === '1';

if (s3Enabled) {
  contract('s3 driver (compose stack)', async () => {
    const common = {
      region: process.env.S3_REGION ?? 'us-east-1',
      forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') !== 'false',
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY ?? '',
        secretAccessKey: process.env.S3_SECRET_KEY ?? '',
      },
    };
    const endpoint = process.env.S3_ENDPOINT ?? 'http://127.0.0.1:59000';
    const snapshot: S3BlobStoreSnapshot = {
      internal: new S3Client({ ...common, endpoint }),
      publicClient: new S3Client({ ...common, endpoint }),
      bucket: process.env.S3_BUCKET ?? 'coda',
      endpoint,
      publicEndpoint: endpoint,
      forcePathStyle: common.forcePathStyle,
    };
    const store = new S3BlobStore(snapshot, true);
    await store.init();
    const run = randomUUID();
    return {
      store,
      keyFor: (name) => `parity/${run}/${name}`,
      teardown: () => Promise.resolve(store.dispose()),
    };
  });
}

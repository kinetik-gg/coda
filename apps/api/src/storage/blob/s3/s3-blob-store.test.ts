import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  destroy: vi.fn(),
  signedUrl: vi.fn(),
}));

vi.mock('../../../config/env', () => ({
  env: () => ({
    APP_ORIGIN: 'http://app.test',
    SIGNED_UPLOAD_TTL_SECONDS: 900,
    SIGNED_READ_TTL_SECONDS: 300,
  }),
}));

vi.mock('@aws-sdk/client-s3', () => {
  class Command {
    constructor(readonly input: Record<string, unknown>) {}
  }
  const named = (kind: string) =>
    class extends Command {
      readonly kind = kind;
    };
  return {
    S3Client: class {
      send = mocks.send;
      destroy = mocks.destroy;
    },
    CreateBucketCommand: named('createBucket'),
    DeleteObjectCommand: named('delete'),
    GetObjectCommand: named('get'),
    HeadBucketCommand: named('headBucket'),
    HeadObjectCommand: named('head'),
    ListObjectsV2Command: named('list'),
    PutObjectCommand: named('put'),
  };
});

vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: mocks.signedUrl }));

import { S3Client } from '@aws-sdk/client-s3';
import { BlobNotFoundError } from '../blob-store';
import { S3BlobStore, type S3BlobStoreSnapshot } from './s3-blob-store';

function snapshot(overrides: Partial<S3BlobStoreSnapshot> = {}): S3BlobStoreSnapshot {
  return {
    internal: new S3Client({}) as never,
    publicClient: new S3Client({}) as never,
    bucket: 'probe-bucket',
    endpoint: 'http://storage.internal',
    publicEndpoint: 'http://objects.test',
    forcePathStyle: true,
    ...overrides,
  };
}

function sentKinds(): string[] {
  return (mocks.send.mock.calls as [{ kind: string }][]).map(([command]) => command.kind);
}

function commandOf(kind: string): Record<string, unknown> {
  const call = (mocks.send.mock.calls as [{ kind: string; input: Record<string, unknown> }][]).find(
    ([command]) => command.kind === kind,
  );
  return call![0].input;
}

function signedInput(index = 0): Record<string, unknown> {
  return (mocks.signedUrl.mock.calls as [unknown, { input: Record<string, unknown> }][])[index]![1]
    .input;
}

describe('S3BlobStore', () => {
  beforeEach(() => {
    mocks.send.mockReset().mockResolvedValue({});
    mocks.destroy.mockReset();
    mocks.signedUrl
      .mockReset()
      .mockResolvedValue('http://objects.test/probe-bucket/key?X-Amz-Signature=abc');
  });

  afterEach(() => vi.unstubAllGlobals());

  it('creates the bucket only when the HEAD probe fails', async () => {
    mocks.send.mockRejectedValueOnce(new Error('missing')).mockResolvedValue({});
    await new S3BlobStore(snapshot(), false).init();
    expect(sentKinds()).toEqual(['headBucket', 'createBucket']);
  });

  it('leaves the bucket alone when HEAD succeeds', async () => {
    await new S3BlobStore(snapshot(), false).init();
    expect(sentKinds()).toEqual(['headBucket']);
  });

  it('presigns an upload with conditional create and the upload TTL', async () => {
    const target = await new S3BlobStore(snapshot(), false).createUpload('k', {
      contentType: 'application/pdf',
      contentLength: 10,
    });
    expect(typeof target.url).toBe('string');
    expect(target.expiresIn).toBe(900);
    expect(signedInput()).toMatchObject({
      Bucket: 'probe-bucket',
      Key: 'k',
      ContentType: 'application/pdf',
      ContentLength: 10,
      IfNoneMatch: '*',
    });
  });

  it('presigns a read with the disposition, content type, and read TTL', async () => {
    const target = await new S3BlobStore(snapshot(), false).createReadUrl('k', {
      disposition: 'inline; filename="a.pdf"',
      contentType: 'application/pdf',
    });
    expect(target.expiresIn).toBe(300);
    expect(signedInput()).toMatchObject({
      ResponseContentDisposition: 'inline; filename="a.pdf"',
      ResponseContentType: 'application/pdf',
    });
  });

  it('streams a put with the declared content type and length', async () => {
    await new S3BlobStore(snapshot(), false).put('k', Readable.from(Buffer.from('x')), {
      contentType: 'text/plain',
      contentLength: 1,
      ifNoneMatch: true,
    });
    expect(commandOf('put')).toMatchObject({
      Key: 'k',
      ContentType: 'text/plain',
      ContentLength: 1,
      IfNoneMatch: '*',
    });
  });

  it('reads a ranged stream', async () => {
    mocks.send.mockResolvedValue({ Body: Readable.from([Buffer.from('%PDF-')]) });
    const { stream } = await new S3BlobStore(snapshot(), false).get('k', {
      range: { start: 0, end: 4 },
    });
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe('%PDF-');
    expect(commandOf('get').Range).toBe('bytes=0-4');
  });

  it('maps a missing object to BlobNotFoundError on get and stat', async () => {
    mocks.send.mockRejectedValue({ name: 'NoSuchKey' });
    const store = new S3BlobStore(snapshot(), false);
    await expect(store.get('k')).rejects.toBeInstanceOf(BlobNotFoundError);
    await expect(store.stat('k')).rejects.toBeInstanceOf(BlobNotFoundError);
  });

  it('rethrows non-missing errors from get', async () => {
    mocks.send.mockRejectedValue(new Error('boom'));
    await expect(new S3BlobStore(snapshot(), false).get('k')).rejects.toThrow('boom');
  });

  it('stats size and content type', async () => {
    mocks.send.mockResolvedValue({ ContentLength: 42, ContentType: 'application/pdf' });
    const stat = await new S3BlobStore(snapshot(), false).stat('k');
    expect(stat).toEqual({ size: 42, contentType: 'application/pdf' });
  });

  it('deletes an object', async () => {
    await new S3BlobStore(snapshot(), false).delete('k');
    expect(sentKinds()).toEqual(['delete']);
  });

  it('lists across pages, sorted, skipping empty keys', async () => {
    mocks.send
      .mockResolvedValueOnce({
        Contents: [{ Key: 'b', Size: 2 }, { Key: undefined }],
        IsTruncated: true,
        NextContinuationToken: 't',
      })
      .mockResolvedValueOnce({ Contents: [{ Key: 'a', Size: 1 }], IsTruncated: false });
    const entries = await new S3BlobStore(snapshot(), false).list({ prefix: 'p/' });
    expect(entries).toEqual([
      { key: 'a', size: 1 },
      { key: 'b', size: 2 },
    ]);
    expect(commandOf('list').Prefix).toBe('p/');
  });

  it('passes the direct-access probe on a signed URL and allowed CORS', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        headers: { get: () => 'http://app.test' },
      }) as unknown as typeof fetch,
    );
    const checks = await new S3BlobStore(snapshot(), false).probeDirectAccess(
      'k',
      AbortSignal.timeout(1000),
    );
    expect(checks.map((check) => check.name)).toEqual(['presign', 'cors']);
    expect(checks.every((check) => check.ok)).toBe(true);
  });

  it('fails the presign check when the URL is not signed against the public endpoint', async () => {
    mocks.signedUrl.mockResolvedValue('http://objects.test/probe-bucket/key');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ headers: { get: () => '*' } }) as unknown as typeof fetch,
    );
    const [presign] = await new S3BlobStore(snapshot(), false).probeDirectAccess(
      'k',
      AbortSignal.timeout(1000),
    );
    expect(presign!.ok).toBe(false);
  });

  it('fails the CORS check when the origin is not allowed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        headers: { get: () => 'http://evil.test' },
      }) as unknown as typeof fetch,
    );
    const checks = await new S3BlobStore(snapshot(), false).probeDirectAccess(
      'k',
      AbortSignal.timeout(1000),
    );
    expect(checks.find((check) => check.name === 'cors')?.ok).toBe(false);
  });

  it('builds a virtual-hosted CORS target when path style is disabled', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ headers: { get: () => 'http://app.test' } });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    await new S3BlobStore(snapshot({ forcePathStyle: false }), false).probeDirectAccess(
      'k',
      AbortSignal.timeout(1000),
    );
    const [target] = fetchMock.mock.calls[0] as [string];
    expect(target).toContain('probe-bucket.storage.internal');
  });

  it('surfaces a CORS network failure as a failed check', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('refused')) as unknown as typeof fetch,
    );
    const checks = await new S3BlobStore(snapshot(), false).probeDirectAccess(
      'k',
      AbortSignal.timeout(1000),
    );
    expect(checks.find((check) => check.name === 'cors')?.ok).toBe(false);
  });

  it('destroys clients only when it owns them', () => {
    new S3BlobStore(snapshot(), false).dispose();
    expect(mocks.destroy).not.toHaveBeenCalled();
    new S3BlobStore(snapshot(), true).dispose();
    expect(mocks.destroy).toHaveBeenCalledTimes(2);
  });
});

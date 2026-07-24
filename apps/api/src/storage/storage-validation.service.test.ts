import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StorageConnectionInput } from '@coda/contracts';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  signedUrl: vi.fn(),
  destroy: vi.fn(),
}));

vi.mock('../config/env', () => ({ env: () => ({ APP_ORIGIN: 'http://app.test' }) }));

vi.mock('@aws-sdk/client-s3', () => {
  class Command {
    constructor(readonly input: unknown) {}
  }
  return {
    S3Client: class {
      send = mocks.send;
      destroy = mocks.destroy;
    },
    PutObjectCommand: class extends Command {
      readonly kind = 'put';
    },
    GetObjectCommand: class extends Command {
      readonly kind = 'get';
    },
    DeleteObjectCommand: class extends Command {
      readonly kind = 'delete';
    },
  };
});

vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: mocks.signedUrl }));

import { StorageValidationService } from './storage-validation.service';

const connection: StorageConnectionInput = {
  provider: 'minio',
  endpoint: 'http://storage.internal',
  publicEndpoint: 'http://objects.test',
  region: 'us-east-1',
  bucket: 'probe-bucket',
  accessKeyId: 'access',
  secretAccessKey: 'secret',
  forcePathStyle: true,
};

const probePayload = Buffer.from('coda-storage-probe');

function byName(checks: { name: string; ok: boolean; detail: string }[], name: string) {
  return checks.find((check) => check.name === name);
}

function sentKinds(): string[] {
  return (mocks.send.mock.calls as [{ kind: string }][]).map(([command]) => command.kind);
}

function happyFetch(allowOrigin: string | null): typeof fetch {
  return vi.fn().mockResolvedValue({
    headers: {
      get: (header: string) =>
        header.toLowerCase() === 'access-control-allow-origin' ? allowOrigin : null,
    },
  }) as unknown as typeof fetch;
}

describe('StorageValidationService', () => {
  const service = new StorageValidationService();

  beforeEach(() => {
    mocks.send.mockReset();
    mocks.destroy.mockReset();
    mocks.signedUrl
      .mockReset()
      .mockResolvedValue('http://objects.test/probe-bucket/key?X-Amz-Signature=abc');
    mocks.send.mockImplementation((command: { kind: string }) => {
      if (command.kind === 'get') {
        return Promise.resolve({
          Body: { transformToByteArray: () => Promise.resolve(probePayload) },
        });
      }
      return Promise.resolve({});
    });
    vi.stubGlobal('fetch', happyFetch('http://app.test'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('passes every check and leaves no residue on a healthy backend', async () => {
    const result = await service.probe(connection);
    expect(result.ok).toBe(true);
    expect(result.checks.map((check) => check.name).sort()).toEqual([
      'cors',
      'delete',
      'presign',
      'read',
      'write',
    ]);
    // The probe object is written then deleted: cleanup always runs.
    expect(sentKinds()).toContain('delete');
    expect(mocks.destroy).toHaveBeenCalledTimes(2);
  });

  it('reports a write failure and skips read and delete without residue', async () => {
    mocks.send.mockImplementation((command: { kind: string }) => {
      if (command.kind === 'put') return Promise.reject(new Error('access denied'));
      return Promise.resolve({});
    });
    const result = await service.probe(connection);
    expect(result.ok).toBe(false);
    expect(byName(result.checks, 'write')?.ok).toBe(false);
    expect(byName(result.checks, 'read')).toBeUndefined();
    expect(byName(result.checks, 'delete')).toBeUndefined();
    expect(sentKinds()).not.toContain('delete');
  });

  it('flags a content mismatch on read', async () => {
    mocks.send.mockImplementation((command: { kind: string }) => {
      if (command.kind === 'get') {
        return Promise.resolve({
          Body: { transformToByteArray: () => Promise.resolve(Buffer.from('tampered')) },
        });
      }
      return Promise.resolve({});
    });
    const result = await service.probe(connection);
    expect(byName(result.checks, 'read')?.ok).toBe(false);
    expect(result.ok).toBe(false);
  });

  it('fails the presign check when the URL is not signed against the public endpoint', async () => {
    mocks.signedUrl.mockResolvedValue('http://objects.test/probe-bucket/key');
    const result = await service.probe(connection);
    expect(byName(result.checks, 'presign')?.ok).toBe(false);
  });

  it('fails the CORS check when the origin is not allowed', async () => {
    vi.stubGlobal('fetch', happyFetch('http://evil.test'));
    const result = await service.probe(connection);
    const cors = byName(result.checks, 'cors');
    expect(cors?.ok).toBe(false);
    expect(cors?.detail).toContain('http://app.test');
  });

  it('accepts a wildcard CORS policy', async () => {
    vi.stubGlobal('fetch', happyFetch('*'));
    const result = await service.probe(connection);
    expect(byName(result.checks, 'cors')?.ok).toBe(true);
  });

  it('reports residue when the probe object cannot be deleted', async () => {
    mocks.send.mockImplementation((command: { kind: string }) => {
      if (command.kind === 'get') {
        return Promise.resolve({
          Body: { transformToByteArray: () => Promise.resolve(probePayload) },
        });
      }
      if (command.kind === 'delete') return Promise.reject(new Error('no delete'));
      return Promise.resolve({});
    });
    const result = await service.probe(connection);
    expect(byName(result.checks, 'delete')?.ok).toBe(false);
    expect(result.ok).toBe(false);
  });

  it('surfaces a CORS network failure as a failed check', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('connection refused')) as unknown as typeof fetch,
    );
    const result = await service.probe(connection);
    expect(byName(result.checks, 'cors')?.ok).toBe(false);
  });

  it('builds a virtual-hosted CORS target when path style is disabled', async () => {
    const fetchMock = happyFetch('http://app.test');
    vi.stubGlobal('fetch', fetchMock);
    await service.probe({ ...connection, forcePathStyle: false });
    const [target] = (fetchMock as unknown as { mock: { calls: [string][] } }).mock.calls[0]!;
    expect(target).toContain('probe-bucket.storage.internal');
  });
});

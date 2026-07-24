import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StorageConnectionInput, StorageProbeCheck } from '@coda/contracts';
import type { BlobStore } from './blob/blob-store';
import { StorageValidationService } from './storage-validation.service';

const connection: StorageConnectionInput = {
  provider: 'minio',
  endpoint: 'http://storage.internal',
  publicEndpoint: 'http://objects.test',
  region: 'us-east-1',
  bucket: 'probe-bucket',
  accessKeyId: 'access',
  secretAccessKey: 'not-a-real-secret',
  forcePathStyle: true,
};

const probePayload = Buffer.from('coda-storage-probe');

function byName(checks: StorageProbeCheck[], name: string): StorageProbeCheck | undefined {
  return checks.find((check) => check.name === name);
}

interface FakeBehaviour {
  put?: () => Promise<void>;
  read?: Buffer;
  get?: () => Promise<{ stream: Readable }>;
  delete?: () => Promise<void>;
  directChecks?: StorageProbeCheck[];
}

/** A configurable in-memory BlobStore that records the operations the probe drives. */
class FakeBlobStore implements Partial<BlobStore> {
  readonly capabilities = { directUpload: true, presignedRead: true };
  readonly calls: string[] = [];
  disposed = false;

  constructor(private readonly behaviour: FakeBehaviour) {}

  async put(): Promise<void> {
    this.calls.push('put');
    if (this.behaviour.put) await this.behaviour.put();
  }

  async get(): Promise<{ stream: Readable }> {
    this.calls.push('get');
    if (this.behaviour.get) return this.behaviour.get();
    return { stream: Readable.from([this.behaviour.read ?? probePayload]) };
  }

  async delete(): Promise<void> {
    this.calls.push('delete');
    if (this.behaviour.delete) await this.behaviour.delete();
  }

  probeDirectAccess = vi.fn((): Promise<StorageProbeCheck[]> => {
    this.calls.push('probeDirectAccess');
    return Promise.resolve(
      this.behaviour.directChecks ?? [
        { name: 'presign', ok: true, detail: 'signed' },
        { name: 'cors', ok: true, detail: 'allowed' },
      ],
    );
  });

  dispose(): void {
    this.disposed = true;
  }
}

function serviceWith(store: FakeBlobStore): StorageValidationService {
  const provider = { forConnection: vi.fn().mockReturnValue(store) };
  return new StorageValidationService(provider as never);
}

describe('StorageValidationService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('runs write, read, direct-access, then delete and disposes the store', async () => {
    const store = new FakeBlobStore({});
    const result = await serviceWith(store).probe(connection);
    expect(result.ok).toBe(true);
    expect(store.calls).toEqual(['put', 'get', 'probeDirectAccess', 'delete']);
    expect(result.checks.map((check) => check.name)).toEqual([
      'write',
      'read',
      'presign',
      'cors',
      'delete',
    ]);
    expect(store.disposed).toBe(true);
  });

  it('skips read and delete when the write fails, but still disposes', async () => {
    const store = new FakeBlobStore({ put: () => Promise.reject(new Error('access denied')) });
    const result = await serviceWith(store).probe(connection);
    expect(result.ok).toBe(false);
    expect(byName(result.checks, 'write')?.ok).toBe(false);
    expect(byName(result.checks, 'read')).toBeUndefined();
    expect(byName(result.checks, 'delete')).toBeUndefined();
    expect(store.calls).toEqual(['put', 'probeDirectAccess']);
    expect(store.disposed).toBe(true);
  });

  it('flags a content mismatch on read', async () => {
    const store = new FakeBlobStore({ read: Buffer.from('tampered') });
    const result = await serviceWith(store).probe(connection);
    expect(byName(result.checks, 'read')?.ok).toBe(false);
    expect(result.ok).toBe(false);
  });

  it('reports a read failure when the object cannot be fetched', async () => {
    const store = new FakeBlobStore({ get: () => Promise.reject(new Error('no read')) });
    const result = await serviceWith(store).probe(connection);
    expect(byName(result.checks, 'read')?.ok).toBe(false);
  });

  it('splices the driver direct-access checks in order', async () => {
    const store = new FakeBlobStore({
      directChecks: [
        { name: 'presign', ok: false, detail: 'unsigned' },
        { name: 'cors', ok: true, detail: 'allowed' },
      ],
    });
    const result = await serviceWith(store).probe(connection);
    expect(byName(result.checks, 'presign')?.ok).toBe(false);
    expect(result.ok).toBe(false);
  });

  it('reports residue when the probe object cannot be deleted', async () => {
    const store = new FakeBlobStore({ delete: () => Promise.reject(new Error('no delete')) });
    const result = await serviceWith(store).probe(connection);
    expect(byName(result.checks, 'delete')?.ok).toBe(false);
    expect(result.ok).toBe(false);
  });
});

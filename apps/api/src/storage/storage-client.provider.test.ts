import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const instances: Array<{ endpoint: string; destroyed: boolean }> = [];

vi.mock('../config/env', () => ({
  env: () => ({
    S3_ENDPOINT: 'http://storage.internal',
    S3_PUBLIC_ENDPOINT: 'http://objects.test',
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'env-bucket',
    S3_ACCESS_KEY: 'env-access',
    S3_SECRET_KEY: 'env-secret',
    S3_FORCE_PATH_STYLE: true,
  }),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    destroyed = false;
    constructor(readonly config: { endpoint: string }) {
      instances.push(this as never);
    }
    get endpoint() {
      return this.config.endpoint;
    }
    destroy() {
      this.destroyed = true;
    }
  },
}));

import { StorageClientProvider } from './storage-client.provider';
import type { StorageConnection } from '../config/instance-config-codecs';

const override: StorageConnection = {
  provider: 'r2',
  endpoint: 'https://account.r2.cloudflarestorage.com',
  publicEndpoint: 'https://cdn.example.test',
  region: 'auto',
  bucket: 'override-bucket',
  accessKeyId: 'override-access',
  secretAccessKey: 'override-secret',
  forcePathStyle: false,
};

function providerWith(stored: StorageConnection | undefined) {
  const instanceConfig = { getConfig: vi.fn().mockResolvedValue(stored) };
  return { instanceConfig, provider: new StorageClientProvider(instanceConfig as never) };
}

describe('StorageClientProvider', () => {
  beforeEach(() => {
    instances.length = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('boots from the environment as the env-sourced snapshot', () => {
    const { provider } = providerWith(undefined);
    const snapshot = provider.current();
    expect(snapshot.source).toBe('env');
    expect(snapshot.bucket).toBe('env-bucket');
    expect(snapshot.provider).toBeNull();
    expect(snapshot.endpoint).toBe('http://storage.internal');
    expect(snapshot.publicEndpoint).toBe('http://objects.test');
  });

  it('adopts a stored connection on init', async () => {
    const { provider } = providerWith(override);
    await provider.onModuleInit();
    const snapshot = provider.current();
    expect(snapshot.source).toBe('config');
    expect(snapshot.bucket).toBe('override-bucket');
    expect(snapshot.provider).toBe('r2');
    expect(snapshot.forcePathStyle).toBe(false);
  });

  it('keeps the env snapshot when no row is stored', async () => {
    const { provider } = providerWith(undefined);
    await provider.onModuleInit();
    expect(provider.current().source).toBe('env');
  });

  it('hot-swaps to a new backend and retires the previous clients after a grace period', () => {
    const { provider } = providerWith(undefined);
    const previous = provider.current();
    const next = provider.swap(override);
    expect(next.bucket).toBe('override-bucket');
    expect(provider.current().bucket).toBe('override-bucket');
    // Old clients still alive during in-flight grace window.
    expect((previous.internal as unknown as { destroyed: boolean }).destroyed).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect((previous.internal as unknown as { destroyed: boolean }).destroyed).toBe(true);
    expect((previous.publicClient as unknown as { destroyed: boolean }).destroyed).toBe(true);
  });

  it('reverts to the environment backend and retires the override', () => {
    const { provider } = providerWith(undefined);
    const override1 = provider.swap(override);
    const reverted = provider.revertToEnv();
    expect(reverted.source).toBe('env');
    expect(reverted.bucket).toBe('env-bucket');
    vi.advanceTimersByTime(60_000);
    expect((override1.internal as unknown as { destroyed: boolean }).destroyed).toBe(true);
  });

  it('destroys the active snapshot and clears timers on shutdown', () => {
    const { provider } = providerWith(undefined);
    const active = provider.current();
    provider.swap(override);
    provider.onModuleDestroy();
    expect((active.internal as unknown as { destroyed: boolean }).destroyed).toBe(false);
    expect((provider.current().internal as unknown as { destroyed: boolean }).destroyed).toBe(true);
  });
});

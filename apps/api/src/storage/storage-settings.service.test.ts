import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApplyStorageConfig, StorageProbeResult } from '@coda/contracts';

vi.mock('../config/env', () => ({ env: () => ({ APP_ORIGIN: 'http://app.test' }) }));

import { StorageSettingsService } from './storage-settings.service';

const OWNER = 'owner-1';

const connection = {
  provider: 'minio' as const,
  endpoint: 'http://minio-2:9000',
  publicEndpoint: 'http://localhost:59100',
  region: 'us-east-1',
  bucket: 'coda-two',
  accessKeyId: 'access',
  secretAccessKey: 'secret',
  forcePathStyle: true,
};

const okProbe: StorageProbeResult = {
  ok: true,
  checks: [{ name: 'write', ok: true, detail: 'ok' }],
};
const badProbe: StorageProbeResult = {
  ok: false,
  checks: [{ name: 'write', ok: false, detail: 'denied' }],
};

function build(
  options: { objectCount?: number; owner?: string | null; probe?: StorageProbeResult } = {},
) {
  const snapshot = {
    internal: {},
    publicClient: {},
    bucket: 'coda-two',
    region: 'us-east-1',
    endpoint: 'http://minio-2:9000',
    publicEndpoint: 'http://localhost:59100',
    forcePathStyle: true,
    accessKeyId: 'access',
    provider: 'minio' as const,
    source: 'config' as const,
  };
  const prisma = {
    instanceSettings: {
      findFirst: vi
        .fn()
        .mockResolvedValue(
          options.owner === undefined
            ? { ownerUserId: OWNER }
            : options.owner === null
              ? null
              : { ownerUserId: options.owner },
        ),
    },
    storageObject: { count: vi.fn().mockResolvedValue(options.objectCount ?? 0) },
  };
  const instanceConfig = {
    setConfig: vi.fn().mockResolvedValue(undefined),
    deleteConfig: vi.fn().mockResolvedValue(undefined),
  };
  const validation = { probe: vi.fn().mockResolvedValue(options.probe ?? okProbe) };
  const clients = {
    current: vi.fn().mockReturnValue(snapshot),
    swap: vi.fn(),
    revertToEnv: vi.fn(),
  };
  const storage = { ensureBucket: vi.fn().mockResolvedValue(undefined) };
  const service = new StorageSettingsService(
    prisma as never,
    instanceConfig as never,
    validation as never,
    clients as never,
    storage as never,
  );
  return { service, prisma, instanceConfig, validation, clients, storage };
}

describe('StorageSettingsService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('describes the active backend with provenance and object count', async () => {
    const { service } = build({ objectCount: 3 });
    const view = await service.describe(OWNER);
    expect(view).toMatchObject({
      source: 'config',
      provider: 'minio',
      bucket: 'coda-two',
      accessKeyId: 'access',
      existingObjectCount: 3,
      appOrigin: 'http://app.test',
    });
    expect(view).not.toHaveProperty('secretAccessKey');
  });

  it('rejects non-administrators', async () => {
    const { service } = build({ owner: 'someone-else' });
    await expect(service.describe(OWNER)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects an uninitialised instance', async () => {
    const { service } = build({ owner: null });
    await expect(service.describe(OWNER)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('validates without persisting', async () => {
    const { service, validation, instanceConfig, clients } = build();
    const result = await service.validate(OWNER, connection);
    expect(result).toBe(okProbe);
    expect(validation.probe).toHaveBeenCalledWith(connection);
    expect(instanceConfig.setConfig).not.toHaveBeenCalled();
    expect(clients.swap).not.toHaveBeenCalled();
  });

  it('applies and hot-swaps when the probe passes and no objects exist', async () => {
    const { service, instanceConfig, clients, storage } = build({ objectCount: 0 });
    const result = await service.apply(OWNER, connection);
    expect(result.status).toBe('applied');
    expect(instanceConfig.setConfig).toHaveBeenCalledWith('storage.connection', connection, OWNER);
    expect(clients.swap).toHaveBeenCalledWith(connection);
    expect(storage.ensureBucket).toHaveBeenCalled();
    expect(result.config?.bucket).toBe('coda-two');
  });

  it('never persists when the probe fails', async () => {
    const { service, instanceConfig, clients } = build({ probe: badProbe });
    const result = await service.apply(OWNER, connection);
    expect(result.status).toBe('invalid');
    expect(result.probe).toBe(badProbe);
    expect(instanceConfig.setConfig).not.toHaveBeenCalled();
    expect(clients.swap).not.toHaveBeenCalled();
  });

  it('requires an explicit choice when live objects exist', async () => {
    const { service, clients } = build({ objectCount: 5 });
    const result = await service.apply(OWNER, connection);
    expect(result.status).toBe('needs_choice');
    expect(result.existingObjectCount).toBe(5);
    expect(clients.swap).not.toHaveBeenCalled();
  });

  it('never silently cuts over on the migrate choice; the migration job owns it', async () => {
    const { service, instanceConfig, clients } = build({ objectCount: 5 });
    const input: ApplyStorageConfig = { ...connection, existingObjects: 'migrate' };
    const result = await service.apply(OWNER, input);
    // apply only cuts over for start_empty; migrate is re-prompted so the UI routes
    // it to the dedicated verified-migration endpoint instead.
    expect(result.status).toBe('needs_choice');
    expect(result.existingObjectCount).toBe(5);
    expect(instanceConfig.setConfig).not.toHaveBeenCalled();
    expect(clients.swap).not.toHaveBeenCalled();
  });

  it('cuts over when the operator acknowledges starting empty', async () => {
    const { service, clients } = build({ objectCount: 5 });
    const input: ApplyStorageConfig = { ...connection, existingObjects: 'start_empty' };
    const result = await service.apply(OWNER, input);
    expect(result.status).toBe('applied');
    expect(clients.swap).toHaveBeenCalledWith(connection);
  });

  it('reverts to the environment backend', async () => {
    const { service, instanceConfig, clients, storage } = build();
    await service.revert(OWNER);
    expect(instanceConfig.deleteConfig).toHaveBeenCalledWith('storage.connection');
    expect(clients.revertToEnv).toHaveBeenCalled();
    expect(storage.ensureBucket).toHaveBeenCalled();
  });
});

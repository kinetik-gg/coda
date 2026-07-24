import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { StorageSettingsController } from './storage-settings.controller';

const connection = {
  provider: 'minio',
  endpoint: 'http://minio-2:9000',
  publicEndpoint: 'http://localhost:59100',
  region: 'us-east-1',
  bucket: 'coda-two',
  accessKeyId: 'access',
  secretAccessKey: 'secret',
  forcePathStyle: true,
};

function controllerWith() {
  const settings = {
    describe: vi.fn().mockResolvedValue({ source: 'env' }),
    validate: vi.fn().mockResolvedValue({ ok: true, checks: [] }),
    apply: vi.fn().mockResolvedValue({ status: 'applied', probe: { ok: true, checks: [] } }),
    revert: vi.fn().mockResolvedValue({ source: 'env' }),
  };
  return { settings, controller: new StorageSettingsController(settings as never) };
}

const request = { user: { id: 'user-1' } } as Request;

describe('StorageSettingsController', () => {
  it('describes the active configuration', async () => {
    const { controller, settings } = controllerWith();
    const result = await controller.describe(request);
    expect(result).toEqual({ data: { source: 'env' } });
    expect(settings.describe).toHaveBeenCalledWith('user-1');
  });

  it('validates a parsed connection payload', async () => {
    const { controller, settings } = controllerWith();
    const result = await controller.validate(request, connection);
    expect(result.data).toEqual({ ok: true, checks: [] });
    expect(settings.validate).toHaveBeenCalledWith('user-1', connection);
  });

  it('applies a parsed connection payload with the optional choice', async () => {
    const { controller, settings } = controllerWith();
    await controller.apply(request, { ...connection, existingObjects: 'start_empty' });
    expect(settings.apply).toHaveBeenCalledWith('user-1', {
      ...connection,
      existingObjects: 'start_empty',
    });
  });

  it('reverts to the environment configuration', async () => {
    const { controller, settings } = controllerWith();
    await controller.revert(request);
    expect(settings.revert).toHaveBeenCalledWith('user-1');
  });

  it('rejects malformed payloads before touching the service', async () => {
    const { controller, settings } = controllerWith();
    await expect(controller.validate(request, { provider: 'bogus' })).rejects.toBeInstanceOf(
      ZodError,
    );
    expect(settings.validate).not.toHaveBeenCalled();
  });
});

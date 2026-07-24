import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { StorageMigrationController } from './storage-migration.controller';

const connection = {
  provider: 'minio',
  endpoint: 'http://minio2:9000',
  publicEndpoint: 'http://localhost:59100',
  region: 'us-east-1',
  bucket: 'coda-second',
  accessKeyId: 'access',
  secretAccessKey: 'x'.repeat(24),
  forcePathStyle: true,
};

function controllerWith() {
  const migration = {
    status: vi.fn().mockResolvedValue({ phase: 'idle' }),
    start: vi.fn().mockResolvedValue({ status: 'started', probe: { ok: true, checks: [] } }),
    cutover: vi.fn().mockResolvedValue({ phase: 'cutover' }),
    cancel: vi.fn().mockResolvedValue({ phase: 'idle' }),
  };
  return { migration, controller: new StorageMigrationController(migration as never) };
}

const request = { user: { id: 'user-1' } } as Request;

describe('StorageMigrationController', () => {
  it('returns the current migration status', async () => {
    const { controller, migration } = controllerWith();
    const result = await controller.status(request);
    expect(result).toEqual({ data: { phase: 'idle' } });
    expect(migration.status).toHaveBeenCalledWith('user-1');
  });

  it('starts a migration from a parsed target connection', async () => {
    const { controller, migration } = controllerWith();
    const result = await controller.start(request, connection);
    expect(result.data.status).toBe('started');
    expect(migration.start).toHaveBeenCalledWith('user-1', connection);
  });

  it('rejects a malformed target before touching the service', async () => {
    const { controller, migration } = controllerWith();
    await expect(controller.start(request, { provider: 'bogus' })).rejects.toBeInstanceOf(ZodError);
    expect(migration.start).not.toHaveBeenCalled();
  });

  it('confirms cutover', async () => {
    const { controller, migration } = controllerWith();
    const result = await controller.cutover(request);
    expect(result.data.phase).toBe('cutover');
    expect(migration.cutover).toHaveBeenCalledWith('user-1');
  });

  it('cancels a migration', async () => {
    const { controller, migration } = controllerWith();
    await controller.cancel(request);
    expect(migration.cancel).toHaveBeenCalledWith('user-1');
  });
});

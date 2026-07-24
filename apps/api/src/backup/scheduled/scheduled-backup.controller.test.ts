import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { ScheduledBackupController } from './scheduled-backup.controller';

const settings = {
  enabled: true,
  intervalHours: 24,
  retention: { keepLast: 7, dailyForDays: 7, weeklyForWeeks: 4, maxAgeDays: 90 },
};

const connection = {
  provider: 'minio',
  endpoint: 'http://backup-minio:9000',
  publicEndpoint: 'http://localhost:60000',
  region: 'us-east-1',
  bucket: 'dedicated-backup',
  accessKeyId: 'access',
  secretAccessKey: 'secret',
  forcePathStyle: true,
};

function controllerWith() {
  const service = {
    describe: vi.fn().mockResolvedValue({ settings }),
    updateSettings: vi.fn().mockResolvedValue({ settings }),
    validateDestination: vi.fn().mockResolvedValue({ ok: true, checks: [] }),
    setDestination: vi
      .fn()
      .mockResolvedValue({ status: 'applied', probe: { ok: true, checks: [] } }),
    clearDestination: vi.fn().mockResolvedValue({ settings }),
    runNow: vi.fn().mockResolvedValue({ outcome: 'SUCCESS', entry: {} }),
  };
  return { service, controller: new ScheduledBackupController(service as never) };
}

const request = { user: { id: 'user-1' } } as Request;

describe('ScheduledBackupController', () => {
  it('describes the section state', async () => {
    const { controller, service } = controllerWith();
    const result = await controller.describe(request);
    expect(result).toEqual({ data: { settings } });
    expect(service.describe).toHaveBeenCalledWith('user-1');
  });

  it('updates parsed settings', async () => {
    const { controller, service } = controllerWith();
    await controller.updateSettings(request, settings);
    expect(service.updateSettings).toHaveBeenCalledWith('user-1', settings);
  });

  it('rejects malformed settings before touching the service', async () => {
    const { controller, service } = controllerWith();
    await expect(
      controller.updateSettings(request, { enabled: true, intervalHours: 0 }),
    ).rejects.toBeInstanceOf(ZodError);
    expect(service.updateSettings).not.toHaveBeenCalled();
  });

  it('validates a destination connection', async () => {
    const { controller, service } = controllerWith();
    await controller.validateDestination(request, connection);
    expect(service.validateDestination).toHaveBeenCalledWith('user-1', connection);
  });

  it('sets a destination connection', async () => {
    const { controller, service } = controllerWith();
    await controller.setDestination(request, connection);
    expect(service.setDestination).toHaveBeenCalledWith('user-1', connection);
  });

  it('rejects a malformed destination payload', async () => {
    const { controller, service } = controllerWith();
    await expect(controller.setDestination(request, { provider: 'bogus' })).rejects.toBeInstanceOf(
      ZodError,
    );
    expect(service.setDestination).not.toHaveBeenCalled();
  });

  it('clears the destination override', async () => {
    const { controller, service } = controllerWith();
    await controller.clearDestination(request);
    expect(service.clearDestination).toHaveBeenCalledWith('user-1');
  });

  it('runs a backup now', async () => {
    const { controller, service } = controllerWith();
    const result = await controller.run(request);
    expect(result.data).toEqual({ outcome: 'SUCCESS', entry: {} });
    expect(service.runNow).toHaveBeenCalledWith('user-1');
  });
});

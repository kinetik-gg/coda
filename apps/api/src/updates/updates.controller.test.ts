import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { UpdatesController } from './updates.controller';

const request = { user: { id: 'owner-1' } } as Request;

describe('UpdatesController route behavior', () => {
  it('delegates status and check to the service using the authenticated user', async () => {
    const status = { current: '1.2.3', latest: null };
    const updates = {
      status: vi.fn().mockResolvedValue(status),
      check: vi.fn().mockResolvedValue(status),
      setPollingPreference: vi.fn(),
      dismissRelease: vi.fn(),
    };
    const controller = new UpdatesController(updates as never);

    await expect(controller.status(request)).resolves.toEqual({ data: status });
    await expect(controller.check(request)).resolves.toEqual({ data: status });
    expect(updates.status).toHaveBeenCalledWith('owner-1');
    expect(updates.check).toHaveBeenCalledWith('owner-1');
  });

  it('parses and forwards the polling-preference body', async () => {
    const updated = { polling: { overrideHours: 6 } };
    const updates = {
      status: vi.fn(),
      check: vi.fn(),
      setPollingPreference: vi.fn().mockResolvedValue(updated),
      dismissRelease: vi.fn(),
    };
    const controller = new UpdatesController(updates as never);

    await expect(controller.setPollingPreference(request, { intervalHours: 6 })).resolves.toEqual({
      data: updated,
    });
    expect(updates.setPollingPreference).toHaveBeenCalledWith('owner-1', 6);
  });

  it('rejects an out-of-range polling-preference body', async () => {
    const updates = {
      status: vi.fn(),
      check: vi.fn(),
      setPollingPreference: vi.fn(),
      dismissRelease: vi.fn(),
    };
    const controller = new UpdatesController(updates as never);

    await expect(controller.setPollingPreference(request, { intervalHours: -1 })).rejects.toThrow();
    expect(updates.setPollingPreference).not.toHaveBeenCalled();
  });

  it('parses and forwards the dismiss body', async () => {
    const dismissed = { dismissedVersion: '1.3.0' };
    const updates = {
      status: vi.fn(),
      check: vi.fn(),
      setPollingPreference: vi.fn(),
      dismissRelease: vi.fn().mockResolvedValue(dismissed),
    };
    const controller = new UpdatesController(updates as never);

    await expect(controller.dismiss(request, { version: '1.3.0' })).resolves.toEqual({
      data: dismissed,
    });
    expect(updates.dismissRelease).toHaveBeenCalledWith('owner-1', '1.3.0');
  });

  it('rejects an empty dismiss version', async () => {
    const updates = {
      status: vi.fn(),
      check: vi.fn(),
      setPollingPreference: vi.fn(),
      dismissRelease: vi.fn(),
    };
    const controller = new UpdatesController(updates as never);

    await expect(controller.dismiss(request, { version: '' })).rejects.toThrow();
    expect(updates.dismissRelease).not.toHaveBeenCalled();
  });
});

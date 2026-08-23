import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { TrackersController } from './trackers.controller';
import { TrackersService } from './trackers.service';

function request(): Request {
  return { user: { id: 'owner-id' } } as unknown as Request;
}

function setup() {
  const trackers = {
    list: vi.fn().mockResolvedValue([{ id: 'tracker-id' }]),
    create: vi.fn().mockResolvedValue({ id: 'created-id', name: 'New' }),
    get: vi.fn().mockResolvedValue({ id: 'tracker-id', access: { permissions: [] } }),
    update: vi.fn().mockResolvedValue({ id: 'tracker-id', name: 'Renamed' }),
    remove: vi.fn().mockResolvedValue({ id: 'tracker-id', deletedAt: new Date() }),
  };
  const realtime = {
    invalidateTracker: vi.fn().mockResolvedValue(undefined),
  };
  const controller = new TrackersController(trackers as never, realtime as never);
  return { controller, trackers, realtime };
}

describe('TrackersController', () => {
  it('parses the list query and returns the data envelope', async () => {
    const { controller, trackers } = setup();

    const result = await controller.list(request(), {});

    expect(trackers.list).toHaveBeenCalledWith('owner-id', {});
    expect(result).toEqual({ data: [{ id: 'tracker-id' }] });
  });

  it('emits a tracker invalidation after create', async () => {
    const { controller, trackers, realtime } = setup();

    await controller.create(request(), { name: 'New' });

    expect(trackers.create).toHaveBeenCalledWith('owner-id', { name: 'New' });
    expect(realtime.invalidateTracker).toHaveBeenCalledWith('created-id', 'tracker', [
      'created-id',
    ]);
  });

  it('emits invalidation after update and delete', async () => {
    const { controller, realtime } = setup();

    await controller.update(request(), 'tracker-id', { name: 'Renamed', version: 1 });
    await controller.remove(request(), 'tracker-id');

    expect(realtime.invalidateTracker).toHaveBeenCalledTimes(2);
    for (const call of realtime.invalidateTracker.mock.calls) {
      expect(call).toEqual(['tracker-id', 'tracker', ['tracker-id']]);
    }
  });

  it('returns the detail envelope without emitting on reads', async () => {
    const { controller, realtime } = setup();

    const result = await controller.get(request(), 'tracker-id');

    expect(result.data).toMatchObject({ id: 'tracker-id' });
    expect(realtime.invalidateTracker).not.toHaveBeenCalled();
  });
});

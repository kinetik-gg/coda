import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { TrackersController } from './trackers.controller';

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
  const activity = {
    activity: vi.fn().mockResolvedValue([{ id: 'event-id' }]),
  };
  const trash = {
    trash: vi.fn().mockResolvedValue({ id: 'tracker-id', deletedAt: new Date() }),
    restore: vi.fn().mockResolvedValue({ id: 'tracker-id', deletedAt: null }),
    purge: vi.fn().mockResolvedValue({ purged: true }),
    listTrashed: vi.fn().mockResolvedValue([{ id: 'trashed-id', canRestore: true }]),
  };
  const realtime = {
    invalidateTracker: vi.fn().mockResolvedValue(undefined),
  };
  const controller = new TrackersController(
    trackers as never,
    activity as never,
    trash as never,
    realtime as never,
  );
  return { controller, trackers, activity, trash, realtime };
}

describe('TrackersController', () => {
  it('parses the list query and returns the data envelope', async () => {
    const { controller, trackers } = setup();

    const result = await controller.list(request(), {});

    expect(trackers.list).toHaveBeenCalledWith('owner-id', {});
    expect(result).toEqual({ data: [{ id: 'tracker-id' }] });
  });

  it('serves the trashed listing through the trash service without emitting', async () => {
    const { controller, trash, realtime } = setup();

    const result = await controller.listTrash(request());

    expect(trash.listTrashed).toHaveBeenCalledWith('owner-id');
    expect(result).toEqual({ data: [{ id: 'trashed-id', canRestore: true }] });
    expect(realtime.invalidateTracker).not.toHaveBeenCalled();
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
    const { controller, trash, realtime } = setup();

    await controller.update(request(), 'tracker-id', { name: 'Renamed', version: 1 });
    await controller.remove(request(), 'tracker-id');

    expect(trash.trash).toHaveBeenCalledWith('owner-id', 'tracker-id');
    expect(realtime.invalidateTracker).toHaveBeenCalledTimes(2);
    for (const call of realtime.invalidateTracker.mock.calls) {
      expect(call).toEqual(['tracker-id', 'tracker', ['tracker-id']]);
    }
  });

  it('emits an invalidation after restore but not after purge', async () => {
    const { controller, trash, realtime } = setup();

    await controller.restore(request(), 'tracker-id');
    await controller.purge(request(), 'tracker-id');

    expect(trash.restore).toHaveBeenCalledWith('owner-id', 'tracker-id');
    expect(trash.purge).toHaveBeenCalledWith('owner-id', 'tracker-id');
    expect(realtime.invalidateTracker).toHaveBeenCalledTimes(1);
    expect(realtime.invalidateTracker).toHaveBeenCalledWith('tracker-id', 'tracker', [
      'tracker-id',
    ]);
  });

  it('returns the detail envelope without emitting on reads', async () => {
    const { controller, realtime } = setup();

    const result = await controller.get(request(), 'tracker-id');

    expect(result.data).toMatchObject({ id: 'tracker-id' });
    expect(realtime.invalidateTracker).not.toHaveBeenCalled();
  });

  it('serves the activity feed in the data envelope without emitting', async () => {
    const { controller, activity, realtime } = setup();

    const result = await controller.activity(request(), 'tracker-id', 'cursor-event');
    await controller.list(request(), {});

    expect(activity.activity).toHaveBeenCalledWith('owner-id', 'tracker-id', 'cursor-event');
    expect(result).toEqual({ data: [{ id: 'event-id' }] });
    expect(realtime.invalidateTracker).not.toHaveBeenCalled();
  });
});

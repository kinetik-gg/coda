import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { createTrackerDefaultWorkspaceLayout } from './default-tracker-workspace-layout';
import { TrackerWorkspaceLayoutsController } from './tracker-workspace-layouts.controller';

const TRACKER = '20000000-0000-4000-8000-000000000001';

function request(): Request {
  return { user: { id: 'owner-id' } } as unknown as Request;
}

function setup() {
  const layouts = {
    get: vi
      .fn()
      .mockResolvedValue({ personal: { revision: 0 }, default: { revision: 1 }, canPublish: true }),
    save: vi.fn().mockResolvedValue({ revision: 2 }),
    reset: vi.fn().mockResolvedValue({ revision: 3 }),
    publish: vi.fn().mockResolvedValue({ revision: 4 }),
  };
  const realtime = { invalidateTracker: vi.fn().mockResolvedValue(undefined) };
  const controller = new TrackerWorkspaceLayoutsController(layouts as never, realtime as never);
  return { controller, layouts, realtime };
}

describe('TrackerWorkspaceLayoutsController', () => {
  it('returns the layout state envelope and emits nothing on reads', async () => {
    const { controller, layouts, realtime } = setup();

    await expect(controller.get(request(), TRACKER)).resolves.toEqual({
      data: { personal: { revision: 0 }, default: { revision: 1 }, canPublish: true },
    });
    expect(layouts.get).toHaveBeenCalledWith('owner-id', TRACKER);
    expect(realtime.invalidateTracker).not.toHaveBeenCalled();
  });

  it('parses bodies through the layout contracts before reaching the service', async () => {
    const { controller, layouts } = setup();
    const layout = createTrackerDefaultWorkspaceLayout();

    await controller.save(request(), TRACKER, { layout, expectedRevision: 1 });
    expect(layouts.save).toHaveBeenCalledWith('owner-id', TRACKER, layout, 1);

    await controller.reset(request(), TRACKER, { expectedRevision: 2 });
    expect(layouts.reset).toHaveBeenCalledWith('owner-id', TRACKER, 2);

    await expect(controller.save(request(), TRACKER, { layout })).rejects.toBeTruthy();
    await expect(controller.reset(request(), TRACKER, {})).rejects.toBeTruthy();
    expect(layouts.save).toHaveBeenCalledOnce();
    expect(layouts.reset).toHaveBeenCalledOnce();
  });

  it('invalidates the tracker workspace-default resource only after a successful publish', async () => {
    const { controller, layouts, realtime } = setup();

    await controller.publish(request(), TRACKER, { personalRevision: 2, defaultRevision: 1 });
    expect(layouts.publish).toHaveBeenCalledWith('owner-id', TRACKER, 2, 1);
    expect(realtime.invalidateTracker).toHaveBeenCalledOnce();
    expect(realtime.invalidateTracker.mock.calls[0]).toEqual([
      TRACKER,
      'workspace-default',
      [TRACKER],
    ]);
  });
});

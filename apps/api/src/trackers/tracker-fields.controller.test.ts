import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { TrackerFieldsController } from './tracker-fields.controller';

const UUID = '10000000-0000-4000-8000-000000000001';

function request(): Request {
  return { user: { id: 'owner-id' } } as unknown as Request;
}

function setup() {
  const fields = {
    list: vi.fn().mockResolvedValue([{ id: 'field-1' }]),
    create: vi.fn().mockResolvedValue({ id: 'field-new' }),
    get: vi.fn().mockResolvedValue({ id: 'field-1', options: [] }),
    update: vi.fn().mockResolvedValue({ id: 'field-1' }),
    reorder: vi.fn().mockResolvedValue({ id: 'field-1' }),
    archive: vi.fn().mockResolvedValue({ id: 'field-1', archivedAt: new Date() }),
    createOption: vi.fn().mockResolvedValue({ id: 'opt-new' }),
    updateOption: vi.fn().mockResolvedValue({ id: 'opt-1' }),
    archiveOption: vi.fn().mockResolvedValue({ id: 'opt-1', archivedAt: new Date() }),
  };
  const realtime = { invalidateTracker: vi.fn().mockResolvedValue(undefined) };
  const controller = new TrackerFieldsController(fields as never, realtime as never);
  return { controller, fields, realtime };
}

describe('TrackerFieldsController', () => {
  it('returns list and detail envelopes without emitting on reads', async () => {
    const { controller, realtime } = setup();

    await controller.list(request(), UUID);
    await controller.get(request(), UUID, 'field-1');

    expect(realtime.invalidateTracker).not.toHaveBeenCalled();
  });

  it('invalidates the fields resource with the created field id', async () => {
    const { controller, fields, realtime } = setup();
    const body = {
      name: 'Status',
      key: 'status',
      type: 'enum' as const,
      options: [{ label: 'Open' }],
    };

    await controller.create(request(), UUID, body);

    expect(fields.create).toHaveBeenCalledWith(
      'owner-id',
      UUID,
      expect.objectContaining({ name: 'Status', key: 'status', type: 'enum', required: false }),
    );
    expect(realtime.invalidateTracker).toHaveBeenCalledWith(UUID, 'fields', ['field-new']);
  });

  it('parses update, reorder, and archive bodies and invalidates each time', async () => {
    const { controller, realtime } = setup();

    await controller.update(request(), UUID, 'field-1', { name: 'Renamed', version: 2 });
    await controller.reorder(request(), UUID, 'field-1', {
      afterId: '20000000-0000-4000-8000-000000000002',
      version: 2,
    });
    await controller.archive(request(), UUID, 'field-1', { version: 2 });

    expect(realtime.invalidateTracker).toHaveBeenCalledTimes(3);
    for (const call of realtime.invalidateTracker.mock.calls) {
      expect(call).toEqual([UUID, 'fields', ['field-1']]);
    }
  });

  it('routes option mutations through the owning field invalidation', async () => {
    const { controller, realtime } = setup();

    await controller.createOption(request(), UUID, 'field-1', { label: 'Blocked' });
    await controller.updateOption(request(), UUID, 'field-1', 'opt-1', { color: null });
    await controller.archiveOption(request(), UUID, 'field-1', 'opt-1');

    expect(realtime.invalidateTracker).toHaveBeenCalledTimes(3);
    for (const call of realtime.invalidateTracker.mock.calls) {
      expect(call).toEqual([UUID, 'fields', ['field-1']]);
    }
  });
});

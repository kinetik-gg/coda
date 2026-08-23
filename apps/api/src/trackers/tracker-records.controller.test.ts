import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { TrackerRecordsController } from './tracker-records.controller';

const UUID = '10000000-0000-4000-8000-000000000001';

function request(): Request {
  return { user: { id: 'owner-id' } } as unknown as Request;
}

const R1 = '30000000-0000-4000-8000-000000000001';
const R2 = '30000000-0000-4000-8000-000000000002';
const F1 = '20000000-0000-4000-8000-000000000009';

function record(id: string) {
  return { id, title: 'Row', values: [] };
}

function setup() {
  const records = {
    list: vi.fn().mockResolvedValue({ data: [record('r-1')], nextCursor: 'cursor-token' }),
    create: vi.fn().mockResolvedValue(record('r-new')),
    get: vi.fn().mockResolvedValue(record('r-1')),
    update: vi.fn().mockResolvedValue(record('r-1')),
    reorder: vi.fn().mockResolvedValue(record('r-1')),
    setValue: vi.fn().mockResolvedValue(record('r-1')),
    bulkSetValues: vi.fn().mockResolvedValue({ records: [record(R1), record(R2)] }),
    bulkDelete: vi.fn().mockResolvedValue({ deletedIds: ['r-1', 'r-2'], deletionBatchId: 'batch' }),
  };
  const realtime = { invalidateTracker: vi.fn().mockResolvedValue(undefined) };
  const controller = new TrackerRecordsController(records as never, realtime as never);
  return { controller, records, realtime };
}

describe('TrackerRecordsController', () => {
  it('returns the paginated envelope and emits nothing on reads', async () => {
    const { controller, realtime } = setup();

    await controller.list(request(), UUID, {});
    await controller.get(request(), UUID, 'r-1');

    expect(realtime.invalidateTracker).not.toHaveBeenCalled();
  });

  it('invalidates the records resource after single-record mutations', async () => {
    const { controller, realtime } = setup();

    await controller.create(request(), UUID, { title: 'New row' });
    await controller.update(request(), UUID, 'r-1', { title: 'Renamed', version: 2 });
    await controller.reorder(request(), UUID, 'r-1', { afterId: R2, version: 2 });
    await controller.setValue(request(), UUID, R1, F1, {
      value: { type: 'text', value: 'x' },
      recordVersion: 2,
    });

    expect(realtime.invalidateTracker).toHaveBeenCalledTimes(4);
    for (const call of realtime.invalidateTracker.mock.calls) {
      expect(call[0]).toBe(UUID);
      expect(call[1]).toBe('records');
    }
    expect(realtime.invalidateTracker.mock.calls[0]).toEqual([UUID, 'records', ['r-new']]);
  });

  it('reports every touched record id on bulk operations', async () => {
    const { controller, records, realtime } = setup();

    await controller.bulkSetValues(request(), UUID, {
      updates: [
        { recordId: R1, fieldId: F1, value: null },
        { recordId: R2, fieldId: F1, value: null },
      ],
    });
    expect(records.bulkSetValues).toHaveBeenCalledTimes(1);
    expect(realtime.invalidateTracker).toHaveBeenCalledWith(UUID, 'records', [R1, R2]);

    await controller.bulkDelete(request(), UUID, { ids: [R1] });
    expect(realtime.invalidateTracker).toHaveBeenLastCalledWith(UUID, 'records', ['r-1', 'r-2']);
  });
});

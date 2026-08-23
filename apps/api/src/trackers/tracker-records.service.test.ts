import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { ListTrackerRecordsQuery } from '@coda/contracts';
import { describe, expect, it, vi } from 'vitest';
import { TrackerRecordsService } from './tracker-records.service';

const TRACKER = '10000000-0000-4000-8000-000000000001';
const FIELD_ID = '20000000-0000-4000-8000-000000000002';
const RECORD_ID = '30000000-0000-4000-8000-000000000003';

function recordRow(overrides: Record<string, unknown> = {}) {
  return {
    id: RECORD_ID,
    trackerId: TRACKER,
    title: 'Scene 12 lock',
    position: '0000000000000004',
    version: 1,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    deletedAt: null,
    values: [],
    ...overrides,
  };
}

function fieldRow(overrides: Record<string, unknown> = {}) {
  return {
    id: FIELD_ID,
    trackerId: TRACKER,
    name: 'Status',
    key: 'status',
    type: 'ENUM',
    required: false,
    position: '0000000000000001',
    configuration: {},
    version: 1,
    deletedAt: null,
    options: [{ id: 'opt-1', label: 'Open', archivedAt: null }],
    ...overrides,
  };
}

function allowingPermissions() {
  return {
    assert: vi.fn().mockResolvedValue({ role: { permissions: [] } }),
  };
}

function service(prisma: object, permissions = allowingPermissions()) {
  const db = { acquireTransactionLock: vi.fn().mockResolvedValue(undefined) };
  return new TrackerRecordsService(prisma as never, permissions as never, db as never);
}

type MockFn = ReturnType<typeof vi.fn>;

interface TxShape {
  trackerRecord: {
    create: MockFn;
    findFirst: MockFn;
    findMany: MockFn;
    findUniqueOrThrow: MockFn;
    update: MockFn;
    updateMany: MockFn;
  };
  trackerField: { findFirst: MockFn; findMany: MockFn };
  trackerFieldValue: { deleteMany: MockFn; upsert: MockFn };
  storageObject: { findFirst: MockFn };
}

function txMock(overrides: (tx: TxShape) => void = () => undefined): TxShape {
  const tx: TxShape = {
    trackerRecord: {
      create: vi.fn().mockResolvedValue(recordRow()),
      findFirst: vi.fn().mockResolvedValue(recordRow()),
      findMany: vi.fn().mockResolvedValue([recordRow()]),
      findUniqueOrThrow: vi.fn().mockResolvedValue(recordRow()),
      update: vi.fn().mockResolvedValue(recordRow()),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    trackerField: {
      findFirst: vi.fn().mockResolvedValue(fieldRow()),
      findMany: vi.fn().mockResolvedValue([fieldRow()]),
    },
    trackerFieldValue: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      upsert: vi.fn().mockResolvedValue({}),
    },
    storageObject: {
      findFirst: vi.fn().mockResolvedValue({ id: 'so-1' }),
    },
  };
  overrides(tx);
  return tx;
}

function transactional(tx: TxShape) {
  return { $transaction: vi.fn((callback: (value: TxShape) => unknown) => callback(tx)) };
}

function nthCall(fn: { mock: { calls: unknown[][] } }, index: number): Record<string, unknown> {
  return fn.mock.calls[index]?.[0] as Record<string, unknown>;
}

describe('TrackerRecordsService', () => {
  it('appends into manual order and honours a named gap', async () => {
    const tx = txMock((t) => {
      t.trackerRecord.findMany.mockResolvedValue([
        { id: 'r1', position: '0000000000000002' },
        { id: 'r2', position: '0000000000000005' },
      ]);
    });
    await service(transactional(tx)).create('owner-id', TRACKER, { title: 'New row' });
    expect(
      (nthCall(tx.trackerRecord.create, 0) as { data: { position: string } }).data.position,
    ).toEqual(expect.any(String));

    await service(transactional(tx)).create('owner-id', TRACKER, {
      title: 'Between',
      beforeId: 'r2',
      afterId: 'r1',
    });
    const between = (
      nthCall(tx.trackerRecord.create, 1) as unknown as { data: { position: string } }
    ).data.position;
    expect(between > '0000000000000002' && between < '0000000000000005').toBe(true);

    const foreign = txMock();
    await expect(
      service(transactional(foreign)).create('owner-id', TRACKER, {
        title: 'X',
        afterId: 'ghost',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('searches titles case-insensitively and maps sort columns with stable tiebreaks', async () => {
    const findMany = vi.fn().mockResolvedValue([recordRow()]);
    const target = service({ trackerRecord: { findMany } } as never);
    const query: ListTrackerRecordsQuery = {
      limit: 50,
      sort: 'title',
      direction: 'desc',
      search: 'scene',
      filters: [],
    };
    const result = await target.list('owner-id', TRACKER, query);
    expect(result.nextCursor).toBeNull();
    const call = findMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
      orderBy: Array<Record<string, string>>;
    };
    expect(call.where).toMatchObject({
      trackerId: TRACKER,
      deletedAt: null,
      title: { contains: 'scene', mode: 'insensitive' },
    });
    expect(call.orderBy).toEqual([{ title: 'desc' }, { id: 'desc' }]);
  });

  it('pages by cursor and reports the next page', async () => {
    const rows = Array.from({ length: 3 }, (_, index) =>
      recordRow({ id: `r-${index}`, position: `000000000000000${index + 1}` }),
    );
    const findMany = vi.fn().mockResolvedValue(rows);
    const target = service({ trackerRecord: { findMany } } as never);
    const result = await target.list('owner-id', TRACKER, {
      limit: 2,
      sort: 'manual',
      direction: 'asc',
      filters: [],
    });
    expect(result.data).toHaveLength(2);
    expect(result.nextCursor).toBeTruthy();
    const call = findMany.mock.calls[0]?.[0] as {
      take: number;
      orderBy: Array<Record<string, string>>;
    };
    expect(call.take).toBe(3);
    expect(call.orderBy[0]).toEqual({ position: 'asc' });
  });

  it('applies typed filters only against fields of this tracker', async () => {
    const findField = vi.fn().mockResolvedValue([fieldRow({ type: 'INTEGER', options: [] })]);
    const findRecords = vi.fn().mockResolvedValue([]);
    const target = service({
      trackerField: { findMany: findField },
      trackerRecord: { findMany: findRecords },
    } as never);
    await target.list('owner-id', TRACKER, {
      limit: 10,
      sort: 'manual',
      direction: 'asc',
      filters: [{ fieldId: FIELD_ID, operator: 'greater_than', value: 4 }],
    });
    const call = findRecords.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(call.where.AND).toEqual([
      { values: { some: { fieldId: FIELD_ID, integerValue: { gt: 4 } } } },
    ]);

    const partial = vi.fn().mockResolvedValue([]);
    const rejecting = service({
      trackerField: { findMany: partial },
      trackerRecord: { findMany: vi.fn() },
    } as never);
    await expect(
      rejecting.list('owner-id', TRACKER, {
        limit: 10,
        sort: 'manual',
        direction: 'asc',
        filters: [
          { fieldId: FIELD_ID, operator: 'equals', value: 1 },
          { fieldId: '99999999-0000-4000-8000-000000000009', operator: 'is_empty' },
        ],
      }),
    ).rejects.toThrow('A filter field does not belong to this tracker');
  });

  it('refuses invalid typed filters before querying', async () => {
    const target = service({
      trackerField: {
        findMany: vi.fn().mockResolvedValue([fieldRow({ type: 'BOOLEAN', options: [] })]),
      },
      trackerRecord: { findMany: vi.fn() },
    } as never);
    await expect(
      target.list('owner-id', TRACKER, {
        limit: 10,
        sort: 'manual',
        direction: 'asc',
        filters: [{ fieldId: FIELD_ID, operator: 'contains', value: true }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reads one live record with its values and 404s missing or trashed ones', async () => {
    const findFirst = vi.fn().mockResolvedValue(recordRow());
    const target = service({ trackerRecord: { findFirst } } as never);
    await expect(target.get('owner-id', TRACKER, RECORD_ID)).resolves.toMatchObject({
      id: RECORD_ID,
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: RECORD_ID, trackerId: TRACKER, deletedAt: null },
      }),
    );
    const missing = service({
      trackerRecord: { findFirst: vi.fn().mockResolvedValue(null) },
    } as never);
    await expect(missing.get('owner-id', TRACKER, RECORD_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('renames under the optimistic guard and disambiguates stale from gone', async () => {
    const tx = txMock();
    const updated = await service(transactional(tx)).update('owner-id', TRACKER, RECORD_ID, {
      title: 'Renamed',
      version: 1,
    });
    expect(updated).toMatchObject({ id: RECORD_ID });
    const call = nthCall(tx.trackerRecord.updateMany, 0) as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(call.where).toEqual({ id: RECORD_ID, trackerId: TRACKER, deletedAt: null, version: 1 });
    expect(call.data.version).toEqual({ increment: 1 });

    const goneTx = txMock((t) => t.trackerRecord.findFirst.mockResolvedValue(null));
    await expect(
      service(transactional(goneTx)).update('owner-id', TRACKER, RECORD_ID, {
        title: 'Late',
        version: 9,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    const staleTx = txMock((t) =>
      t.trackerRecord.findFirst.mockResolvedValue(recordRow({ version: 8 })),
    );
    await expect(
      service(transactional(staleTx)).update('owner-id', TRACKER, RECORD_ID, {
        title: 'Late',
        version: 9,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('moves a record inside the ordering-group lock on reorder', async () => {
    const lock = vi.fn().mockResolvedValue(undefined);
    const tx = txMock((t) => {
      t.trackerRecord.findFirst.mockResolvedValue(recordRow({ version: 3 }));
      t.trackerRecord.findMany.mockResolvedValue([
        { id: 'r-sibling-a', position: '0000000000000001' },
        { id: 'r-sibling-b', position: '0000000000000009' },
      ]);
    });
    const db = { acquireTransactionLock: lock };
    const target = new TrackerRecordsService(
      transactional(tx) as never,
      allowingPermissions() as never,
      db as never,
    );
    await target.reorder('owner-id', TRACKER, RECORD_ID, {
      beforeId: 'r-sibling-b',
      afterId: 'r-sibling-a',
      version: 3,
    });
    expect(lock).toHaveBeenCalledWith(tx, `tracker-records:${TRACKER}`);
    expect(tx.trackerRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { trackerId: TRACKER, deletedAt: null, id: { not: RECORD_ID } },
      }),
    );
    const call = nthCall(tx.trackerRecord.updateMany, 0) as {
      data: Record<string, unknown>;
    };
    const position = call.data.position as string;
    expect(position > '0000000000000001' && position < '0000000000000009').toBe(true);
  });

  it('writes single-select cells through validated options and bumps the record version', async () => {
    const tx = txMock();
    await service(transactional(tx)).setValue('owner-id', TRACKER, RECORD_ID, FIELD_ID, {
      value: { type: 'enum', optionId: 'opt-1' },
      recordVersion: 1,
    });
    const upsert = nthCall(tx.trackerFieldValue.upsert, 0) as unknown as {
      update: { optionId: string };
    };
    expect(upsert.update.optionId).toBe('opt-1');
    expect(tx.trackerRecord.update).toHaveBeenCalledWith({
      where: { id: RECORD_ID },
      data: { version: { increment: 1 } },
    });

    const badOption = txMock();
    await expect(
      service(transactional(badOption)).setValue('owner-id', TRACKER, RECORD_ID, FIELD_ID, {
        value: { type: 'enum', optionId: 'foreign-option' },
        recordVersion: 1,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('fully replaces multi-select selections on every set', async () => {
    const tx = txMock((t) => {
      t.trackerField.findFirst.mockResolvedValue(fieldRow({ type: 'MULTI_ENUM' }));
    });
    await service(transactional(tx)).setValue('owner-id', TRACKER, RECORD_ID, FIELD_ID, {
      value: { type: 'multi_enum', optionIds: ['opt-1'] },
      recordVersion: 1,
    });
    const upsert = nthCall(tx.trackerFieldValue.upsert, 0) as unknown as {
      create: { options: { create: Array<{ optionId: string }> } };
      update: { options: { deleteMany: object } };
    };
    expect(upsert.create.options.create).toEqual([{ optionId: 'opt-1' }]);
    expect(upsert.update.options.deleteMany).toEqual({});
  });

  it('type-checks values, blocks clearing required cells, and validates storage objects', async () => {
    const mismatch = txMock();
    await expect(
      service(transactional(mismatch)).setValue('owner-id', TRACKER, RECORD_ID, FIELD_ID, {
        value: { type: 'text', value: 'nope' },
        recordVersion: 1,
      }),
    ).rejects.toThrow(new BadRequestException('Value type does not match field definition'));

    const required = txMock();
    await expect(
      service(transactional(required)).setValue('owner-id', TRACKER, RECORD_ID, FIELD_ID, {
        value: null,
        recordVersion: 1,
      }),
    ).resolves.toBeDefined(); // not required: clears

    const requiredField = txMock((t) => {
      t.trackerField.findFirst.mockResolvedValue(fieldRow({ required: true }));
    });
    await expect(
      service(transactional(requiredField)).setValue('owner-id', TRACKER, RECORD_ID, FIELD_ID, {
        value: null,
        recordVersion: 1,
      }),
    ).rejects.toThrow('This field is required');

    const storage = txMock((t) => {
      t.trackerField.findFirst.mockResolvedValue(fieldRow({ type: 'IMAGE' }));
      t.storageObject.findFirst.mockResolvedValue(null);
    });
    await expect(
      service(transactional(storage)).setValue('owner-id', TRACKER, RECORD_ID, FIELD_ID, {
        value: { type: 'image', storageObjectId: '00000000-0000-4000-8000-00000000abcd' },
        recordVersion: 1,
      }),
    ).rejects.toThrow('Storage object is unavailable or does not match the field type');

    const storageOk = txMock((t) => {
      t.trackerField.findFirst.mockResolvedValue(fieldRow({ type: 'IMAGE' }));
      t.storageObject.findFirst.mockResolvedValue({ id: 'so-1' });
    });
    await service(transactional(storageOk)).setValue('owner-id', TRACKER, RECORD_ID, FIELD_ID, {
      value: { type: 'image', storageObjectId: '00000000-0000-4000-8000-00000000abcd' },
      recordVersion: 1,
    });
    const upsert = nthCall(storageOk.trackerFieldValue.upsert, 0) as unknown as {
      create: { storageObjectId: string };
    };
    expect(upsert.create.storageObjectId).toBe('00000000-0000-4000-8000-00000000abcd');
  });

  it('refuses cells whose field belongs to another tracker or whose record is stale', async () => {
    const foreign = txMock((t) => t.trackerField.findFirst.mockResolvedValue(null));
    await expect(
      service(transactional(foreign)).setValue('owner-id', TRACKER, RECORD_ID, FIELD_ID, {
        value: { type: 'text', value: 'x' },
        recordVersion: 1,
      }),
    ).rejects.toThrow('Field does not belong to this tracker');

    const stale = txMock((t) =>
      t.trackerRecord.findFirst.mockResolvedValue(recordRow({ version: 5 })),
    );
    await expect(
      service(transactional(stale)).setValue('owner-id', TRACKER, RECORD_ID, FIELD_ID, {
        value: null,
        recordVersion: 1,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    const gone = txMock((t) => t.trackerRecord.findFirst.mockResolvedValue(null));
    await expect(
      service(transactional(gone)).setValue('owner-id', TRACKER, RECORD_ID, FIELD_ID, {
        value: null,
        recordVersion: 1,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('applies bulk cell writes atomically and bumps each touched record once', async () => {
    const otherRecord = '40000000-0000-4000-8000-000000000004';
    const tx = txMock((t) => {
      t.trackerRecord.findMany.mockImplementation(
        (args?: { where?: { id?: { in?: string[] } } }) => {
          const ids = args?.where?.id?.in ?? [];
          if (ids.includes(otherRecord)) {
            return [recordRow(), recordRow({ id: otherRecord })];
          }
          return [recordRow()];
        },
      );
      t.trackerField.findFirst.mockClear();
      t.trackerField.findMany.mockResolvedValue([
        fieldRow(),
        fieldRow({ id: 'f-text', type: 'TEXT', options: [] }),
      ]);
    });
    const target = service(transactional(tx));
    const result = await target.bulkSetValues('owner-id', TRACKER, {
      updates: [
        { recordId: RECORD_ID, fieldId: FIELD_ID, value: { type: 'enum', optionId: 'opt-1' } },
        { recordId: RECORD_ID, fieldId: 'f-text', value: { type: 'text', value: 'note' } },
        { recordId: otherRecord, fieldId: FIELD_ID, value: null },
      ],
    });
    expect(result.records.map((record) => record.id)).toContain(RECORD_ID);
    // Two distinct records -> one updateMany covering both, not per-cell bumps.
    expect(tx.trackerRecord.updateMany).toHaveBeenCalledTimes(1);
    const call = nthCall(tx.trackerRecord.updateMany, 0) as { where: Record<string, unknown> };
    expect(call.where.id).toEqual({ in: [RECORD_ID, otherRecord] });
    expect(tx.trackerFieldValue.upsert).toHaveBeenCalledTimes(2);
    expect(tx.trackerFieldValue.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('404s a bulk write naming an unknown record and 400s a foreign field', async () => {
    const missingRecord = txMock((t) => {
      t.trackerRecord.findMany.mockResolvedValue([]);
    });
    await expect(
      service(transactional(missingRecord)).bulkSetValues('owner-id', TRACKER, {
        updates: [{ recordId: RECORD_ID, fieldId: FIELD_ID, value: { type: 'text', value: 'x' } }],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    const foreignField = txMock((t) => {
      t.trackerField.findMany.mockResolvedValue([]);
    });
    await expect(
      service(transactional(foreignField)).bulkSetValues('owner-id', TRACKER, {
        updates: [{ recordId: RECORD_ID, fieldId: FIELD_ID, value: { type: 'text', value: 'x' } }],
      }),
    ).rejects.toThrow('Field does not belong to this tracker');
  });

  it('soft-deletes live records into a shared deletion batch and skips unknown ids', async () => {
    const alive = '50000000-0000-4000-8000-000000000005';
    const findMany = vi.fn().mockResolvedValue([{ id: RECORD_ID }, { id: alive }]);
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    const target = service({ trackerRecord: { findMany, updateMany } } as never);
    const result = await target.bulkDelete('owner-id', TRACKER, {
      ids: [RECORD_ID, alive, '60000000-0000-4000-8000-000000000006'],
    });
    expect(result.deletedIds).toEqual([RECORD_ID, alive]);
    expect(result.deletionBatchId).toEqual(expect.any(String));
    const call = updateMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(call.where).toMatchObject({ id: { in: [RECORD_ID, alive] }, deletedAt: null });
    expect(call.data.deletedAt).toBeInstanceOf(Date);
    expect(call.data.version).toEqual({ increment: 1 });

    const none = service({
      trackerRecord: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn() },
    } as never);
    await expect(none.bulkDelete('owner-id', TRACKER, { ids: [RECORD_ID] })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

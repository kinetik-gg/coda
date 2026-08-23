import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { CreateTrackerField } from '@coda/contracts';
import { describe, expect, it, vi } from 'vitest';
import { TrackerFieldsService } from './tracker-fields.service';

const UUID = '10000000-0000-4000-8000-000000000001';

function fieldRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'field-1',
    trackerId: UUID,
    name: 'Status',
    key: 'status',
    type: 'ENUM',
    required: false,
    position: '0000000000000001',
    configuration: {},
    version: 1,
    deletedAt: null,
    options: [
      { id: 'opt-1', label: 'Open', color: null, position: '0000000000000001', archivedAt: null },
    ],
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
  return new TrackerFieldsService(prisma as never, permissions as never, db as never);
}

function txMock(overrides: Record<string, unknown> = {}) {
  return {
    trackerField: {
      create: vi.fn().mockResolvedValue(fieldRow()),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      findUniqueOrThrow: vi.fn().mockResolvedValue(fieldRow()),
      update: vi.fn().mockResolvedValue(fieldRow()),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    trackerFieldOption: {
      create: vi.fn().mockResolvedValue({ id: 'opt-new' }),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({ id: 'opt-1' }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    ...overrides,
  };
}

function transactional(tx: ReturnType<typeof txMock>) {
  return { $transaction: vi.fn((callback: (value: typeof tx) => unknown) => callback(tx)) };
}

describe('TrackerFieldsService', () => {
  it('creates a field with enum-only options and ranks it after the last sibling', async () => {
    const tx = txMock({
      trackerField: {
        ...txMock().trackerField,
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(null) // key availability
          .mockResolvedValueOnce({ position: '0000000000000005' }), // last sibling
      },
    });
    const target = service(transactional(tx));

    const input: CreateTrackerField = {
      name: 'Status',
      key: 'status',
      type: 'enum',
      required: false,
      options: [{ label: 'Open' }, { label: 'Closed' }],
    };
    await target.create('owner-id', UUID, input);

    expect(tx.trackerField.create).toHaveBeenCalledTimes(1);
    const call = tx.trackerField.create.mock.calls[0]?.[0] as unknown as {
      data: Record<string, unknown>;
    };
    expect(call.data).toMatchObject({ trackerId: UUID, key: 'status', type: 'ENUM' });
    expect(call.data.position).toEqual(expect.any(String));
    const options = call.data.options as { create: Array<{ position: string }> };
    expect(options.create).toHaveLength(2);
    expect(options.create[0]!.position < options.create[1]!.position).toBe(true);
  });

  it('refuses options on non-enum fields at creation', async () => {
    const tx = txMock();
    const target = service(transactional(tx));
    await expect(
      target.create('owner-id', UUID, {
        name: 'Title',
        key: 'title',
        type: 'text',
        required: false,
        options: [{ label: 'nope' }],
      }),
    ).rejects.toThrow(BadRequestException);
    expect(tx.trackerField.create).not.toHaveBeenCalled();
  });

  it('reserves keys held by live fields and by fields in trash with distinct messages', async () => {
    const tx = txMock();
    (tx.trackerField.findFirst as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 'field-9', deletedAt: null })
      .mockResolvedValueOnce({ id: 'field-8', deletedAt: new Date() });
    const target = service(transactional(tx));

    await expect(
      target.create('owner-id', UUID, { name: 'S', key: 'status', type: 'text', required: false }),
    ).rejects.toThrow(
      new ConflictException('A field with that key already exists on this tracker'),
    );
    await expect(
      target.create('owner-id', UUID, { name: 'S', key: 'status', type: 'text', required: false }),
    ).rejects.toThrow('That key is reserved by a field in trash; restore or purge it first');
  });

  it('lists and reads active fields ordered by rank', async () => {
    const findMany = vi.fn().mockResolvedValue([fieldRow()]);
    const target = service({ trackerField: { findMany } } as never);
    await expect(target.list('owner-id', UUID)).resolves.toHaveLength(1);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { trackerId: UUID, deletedAt: null } }),
    );

    const findFirst = vi.fn().mockResolvedValue(fieldRow());
    await expect(
      service({ trackerField: { findFirst } } as never).get('owner-id', UUID, 'field-1'),
    ).resolves.toMatchObject({ id: 'field-1' });
  });

  it('reconciles options on update and bumps the version under an optimistic guard', async () => {
    const tx = txMock();
    (tx.trackerField.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(fieldRow());
    const target = service(transactional(tx));

    const result = await target.update('owner-id', UUID, 'field-1', {
      name: 'Renamed',
      version: 1,
      options: [{ id: 'opt-1', label: 'Open' }, { label: 'Blocked' }],
    });

    expect(result).toMatchObject({ id: 'field-1' });
    expect(tx.trackerFieldOption.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { fieldId: 'field-1', id: { notIn: ['opt-1'] }, archivedAt: null },
      }),
    );
    expect(tx.trackerFieldOption.update).toHaveBeenCalledTimes(1);
    expect(tx.trackerFieldOption.create).toHaveBeenCalledTimes(1);
    const updateCall = tx.trackerField.updateMany.mock.calls[0]?.[0] as unknown as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(updateCall.where).toMatchObject({ id: 'field-1', version: 1, deletedAt: null });
    expect(updateCall.data.version).toEqual({ increment: 1 });
  });

  it('404s a gone field but 409s a stale version on update', async () => {
    const missingTx = txMock();
    (missingTx.trackerField.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(
      service(transactional(missingTx)).update('owner-id', UUID, 'field-1', { version: 2 }),
    ).rejects.toBeInstanceOf(NotFoundException);

    const staleTx = txMock();
    (staleTx.trackerField.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      fieldRow({ version: 7 }),
    );
    await expect(
      service(transactional(staleTx)).update('owner-id', UUID, 'field-1', { version: 2 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses to retype a field into one that cannot hold its supplied options', async () => {
    const tx = txMock();
    (tx.trackerField.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      fieldRow({ type: 'TEXT' }),
    );
    const target = service(transactional(tx));
    await expect(
      target.update('owner-id', UUID, 'field-1', {
        version: 1,
        options: [{ label: 'nope' }],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('moves a field between siblings inside the ordering-group lock', async () => {
    const lock = vi.fn().mockResolvedValue(undefined);
    const tx = txMock();
    (tx.trackerField.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(fieldRow());
    (tx.trackerField.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'field-2', position: '0000000000000002' },
    ]);
    const db = { acquireTransactionLock: lock };
    const target = new TrackerFieldsService(
      transactional(tx) as never,
      allowingPermissions() as never,
      db as never,
    );

    await target.reorder('owner-id', UUID, 'field-1', { afterId: 'field-2', version: 1 });

    expect(lock).toHaveBeenCalledWith(tx, `tracker-fields:${UUID}`);
    const updateManyCall = tx.trackerField.updateMany.mock.calls[0]?.[0] as unknown as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(updateManyCall.where).toMatchObject({ id: 'field-1', version: 1 });
    expect(typeof updateManyCall.data.position).toBe('string');
  });

  it('archives with the soft-deletion triple and disambiguates stale from gone', async () => {
    const ok = { trackerField: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } };
    const result = await service(ok as never).archive('owner-id', UUID, 'field-1', 3);
    expect(result.id).toBe('field-1');
    expect(result.archivedAt).toBeInstanceOf(Date);
    const call = (ok.trackerField.updateMany as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(call.where).toMatchObject({ id: 'field-1', version: 3, deletedAt: null });
    expect(call.data.deletionBatchId).toEqual(expect.any(String));
    expect(call.data.deletedById).toBe('owner-id');

    const stale = {
      trackerField: {
        findFirst: vi.fn().mockResolvedValue({ id: 'field-1' }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };
    await expect(
      service(stale as never).archive('owner-id', UUID, 'field-1', 3),
    ).rejects.toBeInstanceOf(ConflictException);
    const gone = {
      trackerField: {
        findFirst: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };
    await expect(
      service(gone as never).archive('owner-id', UUID, 'field-1', 3),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('appends options only to enum-family fields and keeps labels unique', async () => {
    const textTx = txMock();
    (textTx.trackerField.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(
      fieldRow({ type: 'TEXT' }),
    );
    await expect(
      service(transactional(textTx)).createOption('owner-id', UUID, 'field-1', { label: 'X' }),
    ).rejects.toThrow(BadRequestException);

    const tx = txMock();
    (tx.trackerField.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(fieldRow());
    (tx.trackerFieldOption.findFirst as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 'opt-dup', label: 'open' }) // label clash probe
      .mockResolvedValueOnce(null); // last active option for ranking
    await expect(
      service(transactional(tx)).createOption('owner-id', UUID, 'field-1', { label: 'OPEN' }),
    ).rejects.toThrow(
      new ConflictException('An option with that label already exists on this field'),
    );

    const fresh = txMock();
    (fresh.trackerField.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(fieldRow());
    (fresh.trackerFieldOption.findFirst as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ position: '0000000000000009' });
    await service(transactional(fresh)).createOption('owner-id', UUID, 'field-1', { label: 'New' });
    expect(fresh.trackerFieldOption.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ label: 'New', color: null }) as Record<string, unknown>,
    });
  });

  it('updates only active options of this field and archives invisibly-active ones', async () => {
    const tx = txMock();
    (tx.trackerField.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(fieldRow());
    (tx.trackerFieldOption.findFirst as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 'opt-1', label: 'Open', archivedAt: null })
      .mockResolvedValueOnce(null); // no other option holds the new label
    await service(transactional(tx)).updateOption('owner-id', UUID, 'field-1', 'opt-1', {
      label: 'Reopened',
    });
    expect(tx.trackerFieldOption.update).toHaveBeenCalledWith({
      where: { id: 'opt-1' },
      data: { label: 'Reopened' },
    });

    const archived = txMock();
    (archived.trackerField.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(fieldRow());
    // The query filters `archivedAt: null`, so an archived option resolves to no row.
    (archived.trackerFieldOption.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(
      service(transactional(archived)).updateOption('owner-id', UUID, 'field-1', 'opt-0', {
        color: 'red',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    const archiveTx = txMock();
    (archiveTx.trackerField.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(fieldRow());
    (archiveTx.trackerFieldOption.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'opt-1',
      archivedAt: null,
    });
    const result = await service(transactional(archiveTx)).archiveOption(
      'owner-id',
      UUID,
      'field-1',
      'opt-1',
    );
    expect(result).toMatchObject({ id: 'opt-1' });
    expect(archiveTx.trackerFieldOption.update).toHaveBeenCalledWith({
      where: { id: 'opt-1' },
      data: { archivedAt: expect.any(Date) as Date },
    });
  });
});

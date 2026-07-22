import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { evenlySpacedRanks } from '../common/rank';
import { BreakdownService } from './breakdown.service';

const optionA = '11111111-1111-4111-8111-111111111111';
const optionB = '22222222-2222-4222-8222-222222222222';

function serviceWith(prisma: object, membership: object = {}) {
  const permissions = { assert: vi.fn().mockResolvedValue(membership) };
  return { service: new BreakdownService(prisma as never, permissions as never), permissions };
}

function transactionWith(tx: object) {
  return { $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)) };
}

function touchModels() {
  return {
    project: { update: vi.fn().mockResolvedValue({}) },
    activityEvent: { create: vi.fn().mockResolvedValue({}) },
  };
}

describe('BreakdownService hierarchy and items', () => {
  it('adds a child hierarchy level and records the activity', async () => {
    const parent = { id: 'parent-type', position: evenlySpacedRanks(1)[0] };
    const created = { id: 'child-type', level: 2 };
    const tx = {
      entityType: {
        findMany: vi.fn().mockResolvedValue([parent]),
        create: vi.fn().mockResolvedValue(created),
      },
      ...touchModels(),
    };
    const { service, permissions } = serviceWith(transactionWith(tx));

    await expect(
      service.addEntityType('user', 'project', {
        singularName: 'Scene',
        pluralName: 'Scenes',
        displayPrefix: 'SC',
      }),
    ).resolves.toBe(created);
    expect(permissions.assert).toHaveBeenCalledWith('user', 'project', 'manage_entity_types');
    const createCall = tx.entityType.create.mock.calls[0]?.[0] as unknown as {
      data: Record<string, unknown>;
    };
    expect(createCall.data).toMatchObject({
      projectId: 'project',
      parentTypeId: 'parent-type',
      level: 2,
      displayPrefix: 'SC',
    });
    const activityCall = tx.activityEvent.create.mock.calls[0]?.[0] as unknown as {
      data: Record<string, unknown>;
    };
    expect(activityCall.data).toMatchObject({ action: 'CREATED', resourceId: 'child-type' });
  });

  it('enforces the maximum hierarchy depth', async () => {
    const tx = {
      entityType: { findMany: vi.fn().mockResolvedValue([{ id: '1' }, { id: '2' }, { id: '3' }]) },
    };
    const { service } = serviceWith(transactionWith(tx));
    await expect(
      service.addEntityType('user', 'project', { singularName: 'Shot', pluralName: 'Shots' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('updates only supplied hierarchy metadata and rejects stale versions', async () => {
    const entityType = {
      updateMany: vi.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'type', version: 3 }),
    };
    const { service } = serviceWith({ entityType });

    await expect(
      service.updateEntityType('user', 'project', 'type', {
        pluralName: 'Sequences',
        displayPrefix: null,
        version: 2,
      }),
    ).resolves.toEqual({ id: 'type', version: 3 });
    expect(entityType.updateMany).toHaveBeenCalledWith({
      where: { id: 'type', projectId: 'project', version: 2 },
      data: { pluralName: 'Sequences', displayPrefix: null, version: { increment: 1 } },
    });
    await expect(
      service.updateEntityType('user', 'project', 'type', { version: 2 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('removes only an empty deepest hierarchy level', async () => {
    const tx = {
      entityType: {
        findMany: vi.fn().mockResolvedValue([{ id: 'root' }, { id: 'leaf' }]),
        delete: vi.fn().mockResolvedValue({}),
      },
      breakdownItem: { count: vi.fn().mockResolvedValue(0) },
      fieldDefinition: { count: vi.fn().mockResolvedValue(0) },
      ...touchModels(),
    };
    const { service } = serviceWith(transactionWith(tx));
    await expect(service.removeDeepestEntityType('user', 'project', 'leaf')).resolves.toEqual({
      removed: true,
    });
    expect(tx.entityType.delete).toHaveBeenCalledWith({ where: { id: 'leaf' } });
  });

  it.each([
    [[{ id: 'root' }], 'root'],
    [[{ id: 'root' }, { id: 'leaf' }], 'root'],
  ])('rejects removing a non-removable hierarchy level', async (levels, requestedId) => {
    const tx = { entityType: { findMany: vi.fn().mockResolvedValue(levels) } };
    const { service } = serviceWith(transactionWith(tx));
    await expect(
      service.removeDeepestEntityType('user', 'project', requestedId),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects removal while the deepest level still has trashed data', async () => {
    const tx = {
      entityType: { findMany: vi.fn().mockResolvedValue([{ id: 'root' }, { id: 'leaf' }]) },
      breakdownItem: { count: vi.fn().mockResolvedValue(1) },
      fieldDefinition: { count: vi.fn().mockResolvedValue(0) },
    };
    const { service } = serviceWith(transactionWith(tx));
    await expect(service.removeDeepestEntityType('user', 'project', 'leaf')).rejects.toThrow(
      'Clear active and trashed items and fields',
    );
  });

  it('lists a page with search, parent, filter, stable ordering, and cursor', async () => {
    const rows = [{ id: 'one' }, { id: 'two' }, { id: 'three' }];
    const fieldDefinition = {
      findMany: vi
        .fn()
        .mockResolvedValue([{ id: 'field', key: 'status', type: 'TEXT', options: [] }]),
    };
    const breakdownItem = { findMany: vi.fn().mockResolvedValue(rows) };
    const { service } = serviceWith({ fieldDefinition, breakdownItem });

    await expect(
      service.listItems('user', 'project', {
        entityTypeId: 'type',
        parentId: null,
        cursor: Buffer.from(JSON.stringify({ id: 'previous' })).toString('base64url'),
        limit: 2,
        sort: 'updated_at',
        direction: 'desc',
        search: 'needle',
        filters: [{ fieldId: 'field', operator: 'contains', value: 'red' }],
      }),
    ).resolves.toEqual({
      data: rows.slice(0, 2),
      nextCursor: Buffer.from(JSON.stringify({ id: 'two' })).toString('base64url'),
    });
    const listCall = breakdownItem.findMany.mock.calls[0]?.[0] as unknown as {
      cursor: object;
      skip: number;
      take: number;
      orderBy: object[];
      where: { parentId: string | null; OR: object[]; AND: object[] };
    };
    expect(listCall).toMatchObject({
      cursor: { id: 'previous' },
      skip: 1,
      take: 3,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });
    expect(listCall.where.parentId).toBeNull();
    expect(listCall.where.OR).toHaveLength(2);
    expect(listCall.where.AND).toHaveLength(1);
  });

  it('rejects invalid cursors and filters from another hierarchy level', async () => {
    const { service: badCursorService } = serviceWith({ breakdownItem: { findMany: vi.fn() } });
    await expect(
      badCursorService.listItems('user', 'project', {
        entityTypeId: 'type',
        cursor: 'not-json',
        limit: 10,
        sort: 'position',
        direction: 'asc',
        filters: [],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const { service: filterService } = serviceWith({
      fieldDefinition: { findMany: vi.fn().mockResolvedValue([]) },
    });
    await expect(
      filterService.listItems('user', 'project', {
        entityTypeId: 'type',
        limit: 10,
        sort: 'position',
        direction: 'asc',
        filters: [{ fieldId: 'foreign', operator: 'is_empty' }],
      }),
    ).rejects.toThrow('does not belong');
  });

  it('creates a top-level item at the end of its sibling order', async () => {
    const tx = {
      entityType: {
        findFirst: vi.fn().mockResolvedValue({ id: 'type', parentTypeId: null }),
      },
      breakdownItem: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: 'existing', position: evenlySpacedRanks(1)[0] }]),
        create: vi.fn().mockResolvedValue({ id: 'new-item' }),
        update: vi.fn(),
      },
      ...touchModels(),
    };
    const { service } = serviceWith(transactionWith(tx));
    await expect(
      service.createItem('user', 'project', {
        entityTypeId: 'type',
        title: 'New item',
        description: null,
      }),
    ).resolves.toEqual({ id: 'new-item' });
    const itemCreateCall = tx.breakdownItem.create.mock.calls[0]?.[0] as unknown as {
      data: { parentId: string | null; title: string; position: string };
    };
    expect(itemCreateCall.data).toMatchObject({ parentId: null, title: 'New item' });
    expect(itemCreateCall.data.position).toEqual(expect.any(String));
  });

  it('rejects item creation for an unavailable hierarchy level', async () => {
    const tx = { entityType: { findFirst: vi.fn().mockResolvedValue(null) } };
    const { service } = serviceWith(transactionWith(tx));
    await expect(
      service.createItem('user', 'project', { entityTypeId: 'missing', title: 'Nope' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('updates an item, validates its parent, and increments the project revision', async () => {
    const child = {
      id: 'child',
      entityTypeId: 'child-type',
      entityType: { parentTypeId: 'parent-type' },
    };
    const breakdownItem = {
      findFirst: vi.fn().mockResolvedValueOnce(child).mockResolvedValueOnce({ id: 'parent' }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ ...child, version: 2 }),
    };
    const project = { update: vi.fn().mockResolvedValue({}) };
    const { service } = serviceWith({ breakdownItem, project });

    await expect(
      service.updateItem('user', 'project', 'child', {
        title: 'Updated',
        displayCode: null,
        parentId: 'parent',
        version: 1,
      }),
    ).resolves.toMatchObject({ version: 2 });
    const itemUpdateCall = breakdownItem.updateMany.mock.calls[0]?.[0] as unknown as {
      where: object;
      data: object;
    };
    expect(itemUpdateCall.where).toEqual({ id: 'child', version: 1, deletedAt: null });
    expect(itemUpdateCall.data).toMatchObject({
      title: 'Updated',
      displayCode: null,
      parentId: 'parent',
    });
  });

  it('rejects a missing or concurrently changed item update', async () => {
    const missing = serviceWith({ breakdownItem: { findFirst: vi.fn().mockResolvedValue(null) } });
    await expect(
      missing.service.updateItem('user', 'project', 'missing', { version: 1 }),
    ).rejects.toBeInstanceOf(NotFoundException);

    const changed = serviceWith({
      breakdownItem: {
        findFirst: vi.fn().mockResolvedValue({ entityType: { parentTypeId: null } }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    });
    await expect(
      changed.service.updateItem('user', 'project', 'item', { version: 1 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('reorders an item into a validated sibling group', async () => {
    const tx = {
      breakdownItem: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'moving',
          version: 4,
          parentId: null,
          entityTypeId: 'type',
          entityType: { parentTypeId: null },
        }),
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'moving', version: 5 }),
        update: vi.fn(),
      },
      ...touchModels(),
    };
    const { service } = serviceWith(transactionWith(tx));
    await expect(
      service.reorderItem('user', 'project', 'moving', { parentId: null, version: 4 }),
    ).resolves.toMatchObject({ version: 5 });
  });
});

describe('BreakdownService field definitions and values', () => {
  it('creates an enum field with ranked options', async () => {
    const tx = {
      entityType: { findFirst: vi.fn().mockResolvedValue({ id: 'type' }) },
      fieldDefinition: {
        findFirst: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null),
        create: vi.fn().mockResolvedValue({ id: 'field' }),
      },
      ...touchModels(),
    };
    const { service } = serviceWith(transactionWith(tx));
    await expect(
      service.createField('user', 'project', {
        entityTypeId: 'type',
        name: 'Status',
        key: 'status',
        type: 'enum',
        required: true,
        options: [{ label: 'Open' }, { label: 'Done', color: '#0f0' }],
      }),
    ).resolves.toEqual({ id: 'field' });
    const fieldCreateCall = tx.fieldDefinition.create.mock.calls[0]?.[0] as unknown as {
      data: {
        type: string;
        configuration: object;
        options: { create: Array<{ label: string }> };
      };
    };
    expect(fieldCreateCall.data.type).toBe('ENUM');
    expect(fieldCreateCall.data.configuration).toEqual({});
    expect(fieldCreateCall.data.options.create.map(({ label }) => label)).toContain('Open');
  });

  it('rejects duplicate labels, non-enum options, missing levels, and reserved keys', async () => {
    const { service: duplicate } = serviceWith({});
    await expect(
      duplicate.createField('user', 'project', {
        entityTypeId: 'type',
        name: 'Status',
        key: 'status',
        type: 'enum',
        required: false,
        options: [{ label: 'Open' }, { label: 'open' }],
      }),
    ).rejects.toThrow('unique');
    await expect(
      duplicate.createField('user', 'project', {
        entityTypeId: 'type',
        name: 'Text',
        key: 'text',
        type: 'text',
        required: false,
        options: [{ label: 'Nope' }],
      }),
    ).rejects.toThrow('only supported');

    const missingTx = { entityType: { findFirst: vi.fn().mockResolvedValue(null) } };
    const { service: missing } = serviceWith(transactionWith(missingTx));
    await expect(
      missing.createField('user', 'project', {
        entityTypeId: 'missing',
        name: 'Text',
        key: 'text',
        type: 'text',
        required: false,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    const reservedTx = {
      entityType: { findFirst: vi.fn().mockResolvedValue({ id: 'type' }) },
      fieldDefinition: {
        findFirst: vi.fn().mockResolvedValue({ id: 'deleted', deletedAt: new Date() }),
      },
    };
    const { service: reserved } = serviceWith(transactionWith(reservedTx));
    await expect(
      reserved.createField('user', 'project', {
        entityTypeId: 'type',
        name: 'Text',
        key: 'reserved',
        type: 'text',
        required: false,
      }),
    ).rejects.toThrow('reserved by a field in trash');
  });

  it('lists fields and returns or rejects a single field', async () => {
    const fieldDefinition = {
      findMany: vi.fn().mockResolvedValue([{ id: 'field' }]),
      findFirst: vi.fn().mockResolvedValueOnce({ id: 'field' }).mockResolvedValueOnce(null),
    };
    const { service } = serviceWith({ fieldDefinition });
    await expect(service.listFields('user', 'project', 'type')).resolves.toEqual([{ id: 'field' }]);
    await expect(service.getField('user', 'project', 'field')).resolves.toEqual({ id: 'field' });
    await expect(service.getField('user', 'project', 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects duplicate or foreign option identifiers during reconciliation', async () => {
    const baseTx = () => ({
      fieldDefinition: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'field',
          entityTypeId: 'type',
          key: 'status',
          type: 'ENUM',
          version: 1,
          options: [{ id: optionA }],
        }),
      },
    });
    const duplicateTx = baseTx();
    const duplicate = serviceWith(transactionWith(duplicateTx));
    await expect(
      duplicate.service.updateField('user', 'project', 'field', {
        version: 1,
        options: [
          { id: optionA, label: 'A' },
          { id: optionA, label: 'Again' },
        ],
      }),
    ).rejects.toThrow('only appear once');

    const foreignTx = baseTx();
    const foreign = serviceWith(transactionWith(foreignTx));
    await expect(
      foreign.service.updateField('user', 'project', 'field', {
        version: 1,
        options: [{ id: optionB, label: 'Foreign' }],
      }),
    ).rejects.toThrow('does not belong');
  });

  it('reorders a field and rejects missing, stale, and concurrently changed records', async () => {
    const makeTx = (field: object | null, count = 1) => ({
      fieldDefinition: {
        findFirst: vi.fn().mockResolvedValue(field),
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn().mockResolvedValue({ count }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'field', version: 2 }),
        update: vi.fn(),
      },
      ...touchModels(),
    });
    const ok = serviceWith(
      transactionWith(makeTx({ id: 'field', version: 1, entityTypeId: 'type' })),
    );
    await expect(
      ok.service.reorderField('user', 'project', 'field', { version: 1 }),
    ).resolves.toMatchObject({ version: 2 });

    const missing = serviceWith(transactionWith(makeTx(null)));
    await expect(
      missing.service.reorderField('user', 'project', 'field', { version: 1 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    const stale = serviceWith(
      transactionWith(makeTx({ id: 'field', version: 2, entityTypeId: 'type' })),
    );
    await expect(
      stale.service.reorderField('user', 'project', 'field', { version: 1 }),
    ).rejects.toBeInstanceOf(ConflictException);
    const raced = serviceWith(
      transactionWith(makeTx({ id: 'field', version: 1, entityTypeId: 'type' }, 0)),
    );
    await expect(
      raced.service.reorderField('user', 'project', 'field', { version: 1 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it.each([
    ['text', 'TEXT', { type: 'text', value: 'hello' }, { textValue: 'hello' }],
    ['long text', 'LONG_TEXT', { type: 'long_text', value: 'long' }, { textValue: 'long' }],
    ['integer', 'INTEGER', { type: 'integer', value: 7 }, { integerValue: 7 }],
    ['float', 'FLOAT', { type: 'float', value: 1.25 }, { floatValue: 1.25 }],
    ['boolean', 'BOOLEAN', { type: 'boolean', value: false }, { booleanValue: false }],
    [
      'date',
      'DATE',
      { type: 'date', value: '2026-07-22' },
      { dateValue: new Date('2026-07-22T00:00:00.000Z') },
    ],
    ['enum', 'ENUM', { type: 'enum', optionId: optionA }, { optionId: optionA }],
    ['file', 'FILE', { type: 'file', storageObjectId: optionB }, { storageObjectId: optionB }],
  ] as const)('sets a valid %s field value', async (_label, fieldType, value, scalar) => {
    const tx = {
      breakdownItem: {
        findFirst: vi.fn().mockResolvedValue({ id: 'item', entityTypeId: 'type' }),
        update: vi.fn().mockResolvedValue({ id: 'item', version: 2 }),
      },
      fieldDefinition: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'field',
          entityTypeId: 'type',
          type: fieldType,
          required: false,
          options: [{ id: optionA }],
        }),
      },
      fieldValue: { upsert: vi.fn().mockResolvedValue({}) },
      storageObject: { findFirst: vi.fn().mockResolvedValue({ id: optionB }) },
      ...touchModels(),
    };
    const { service } = serviceWith(transactionWith(tx));
    await expect(
      service.setFieldValue('user', 'project', 'item', 'field', {
        value: value as never,
        itemVersion: 1,
      }),
    ).resolves.toMatchObject({ version: 2 });
    const upsertCall = tx.fieldValue.upsert.mock.calls[0]?.[0] as unknown as {
      create: Record<string, unknown>;
    };
    expect(upsertCall.create).toMatchObject(scalar);
  });

  it('sets multi-enum values through join rows and can clear an optional value', async () => {
    const tx = {
      breakdownItem: {
        findFirst: vi.fn().mockResolvedValue({ id: 'item', entityTypeId: 'type' }),
        update: vi.fn().mockResolvedValue({ id: 'item', version: 2 }),
      },
      fieldDefinition: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'field',
          entityTypeId: 'type',
          type: 'MULTI_ENUM',
          required: false,
          options: [{ id: optionA }, { id: optionB }],
        }),
      },
      fieldValue: {
        upsert: vi.fn().mockResolvedValue({}),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      ...touchModels(),
    };
    const { service } = serviceWith(transactionWith(tx));
    await service.setFieldValue('user', 'project', 'item', 'field', {
      value: { type: 'multi_enum', optionIds: [optionA, optionB] },
      itemVersion: 1,
    });
    const multiUpsertCall = tx.fieldValue.upsert.mock.calls[0]?.[0] as unknown as {
      create: { options: { create: Array<{ optionId: string }> } };
    };
    expect(multiUpsertCall.create.options).toEqual({
      create: [{ optionId: optionA }, { optionId: optionB }],
    });
    await service.setFieldValue('user', 'project', 'item', 'field', {
      value: null,
      itemVersion: 1,
    });
    expect(tx.fieldValue.deleteMany).toHaveBeenCalledWith({
      where: { itemId: 'item', fieldId: 'field' },
    });
  });

  it('defensively rejects stale items, foreign fields, type mismatches, invalid options, and storage', async () => {
    const invoke = async (
      item: object | null,
      field: object | null,
      value: object | null,
      storage: object | null = null,
    ) => {
      const tx = {
        breakdownItem: { findFirst: vi.fn().mockResolvedValue(item), update: vi.fn() },
        fieldDefinition: { findFirst: vi.fn().mockResolvedValue(field) },
        fieldValue: { upsert: vi.fn(), deleteMany: vi.fn() },
        storageObject: { findFirst: vi.fn().mockResolvedValue(storage) },
      };
      return serviceWith(transactionWith(tx)).service.setFieldValue(
        'user',
        'project',
        'item',
        'field',
        {
          value: value as never,
          itemVersion: 1,
        },
      );
    };
    await expect(invoke(null, null, null)).rejects.toBeInstanceOf(ConflictException);
    await expect(
      invoke(
        { entityTypeId: 'type' },
        { entityTypeId: 'other', type: 'TEXT', options: [] },
        { type: 'text', value: 'x' },
      ),
    ).rejects.toThrow('does not belong');
    await expect(
      invoke(
        { entityTypeId: 'type' },
        { entityTypeId: 'type', type: 'INTEGER', options: [] },
        { type: 'text', value: 'x' },
      ),
    ).rejects.toThrow('Value type');
    await expect(
      invoke(
        { entityTypeId: 'type' },
        { entityTypeId: 'type', type: 'ENUM', options: [{ id: optionA }] },
        { type: 'enum', optionId: optionB },
      ),
    ).rejects.toThrow('Invalid field option');
    await expect(
      invoke(
        { entityTypeId: 'type' },
        { entityTypeId: 'type', type: 'IMAGE', options: [] },
        { type: 'image', storageObjectId: optionB },
      ),
    ).rejects.toThrow('Storage object is unavailable');
    await expect(
      invoke(
        { entityTypeId: 'type' },
        { entityTypeId: 'type', type: 'TEXT', required: true, options: [] },
        null,
      ),
    ).rejects.toThrow('required');
  });
});

describe('BreakdownService typed filters and parent invariants', () => {
  type BuildTypedFilter = (field: object, filter: object) => object[];
  type ValidateParent = (
    tx: object,
    projectId: string,
    parentTypeId: string | null,
    parentId: string | null,
  ) => Promise<void>;

  const builder = () => {
    const service = serviceWith({}).service;
    return (service as unknown as { buildTypedFilter: BuildTypedFilter }).buildTypedFilter.bind(
      service,
    );
  };

  it.each([
    ['empty', { type: 'TEXT' }, { operator: 'is_empty' }],
    ['not empty', { type: 'TEXT' }, { operator: 'is_not_empty' }],
    ['text equals', { type: 'TEXT' }, { operator: 'equals', value: 'x' }],
    ['integer greater', { type: 'INTEGER' }, { operator: 'greater_than', value: 2 }],
    ['float less/equal', { type: 'FLOAT' }, { operator: 'less_or_equal', value: 2.5 }],
    ['boolean not equals', { type: 'BOOLEAN' }, { operator: 'not_equals', value: true }],
    ['date equals', { type: 'DATE' }, { operator: 'equals', value: '2026-07-22' }],
    [
      'enum equals',
      { type: 'ENUM', options: [{ id: optionA }] },
      { operator: 'equals', value: optionA },
    ],
    [
      'multi enum any',
      { type: 'MULTI_ENUM', options: [{ id: optionA }, { id: optionB }] },
      { operator: 'has_any', value: [optionA, optionB] },
    ],
    [
      'multi enum all',
      { type: 'MULTI_ENUM', options: [{ id: optionA }, { id: optionB }] },
      { operator: 'has_all', value: [optionA, optionB] },
    ],
    ['file equals', { type: 'FILE' }, { operator: 'equals', value: optionA }],
  ])('builds a valid %s predicate', (_label, partialField, partialFilter) => {
    const build = builder();
    expect(
      build(
        { id: 'field', key: 'field_key', options: [], ...partialField },
        { fieldId: 'field', ...partialFilter },
      ),
    ).toEqual(expect.any(Array));
  });

  it.each([
    [{ type: 'TEXT' }, { operator: 'greater_than', value: 'x' }],
    [{ type: 'TEXT' }, { operator: 'equals', value: 1 }],
    [{ type: 'INTEGER' }, { operator: 'equals', value: 1.5 }],
    [{ type: 'FLOAT' }, { operator: 'equals', value: Number.NaN }],
    [{ type: 'BOOLEAN' }, { operator: 'equals', value: 'true' }],
    [{ type: 'BOOLEAN' }, { operator: 'greater_than', value: true }],
    [{ type: 'DATE' }, { operator: 'equals', value: '07/22/2026' }],
    [
      { type: 'ENUM', options: [] },
      { operator: 'equals', value: optionA },
    ],
    [
      { type: 'MULTI_ENUM', options: [] },
      { operator: 'has_any', value: [] },
    ],
    [
      { type: 'MULTI_ENUM', options: [] },
      { operator: 'has_any', value: ['not-a-uuid'] },
    ],
    [
      { type: 'MULTI_ENUM', options: [] },
      { operator: 'has_any', value: [optionA] },
    ],
    [{ type: 'FILE' }, { operator: 'contains', value: optionA }],
  ])('rejects invalid typed filter input %#', (partialField, partialFilter) => {
    const build = builder();
    expect(() =>
      build(
        { id: 'field', key: 'field_key', options: [], ...partialField },
        { fieldId: 'field', ...partialFilter },
      ),
    ).toThrow(BadRequestException);
  });

  it('enforces parent shape and verifies an allowed parent record', async () => {
    const service = serviceWith({}).service;
    const validate = (service as unknown as { validateParent: ValidateParent }).validateParent.bind(
      service,
    );
    await expect(validate({}, 'project', null, 'parent')).rejects.toThrow('Top-level');
    await expect(validate({}, 'project', 'parent-type', null)).rejects.toThrow('requires a parent');
    await expect(
      validate(
        { breakdownItem: { findFirst: vi.fn().mockResolvedValue(null) } },
        'project',
        'parent-type',
        'parent',
      ),
    ).rejects.toThrow('does not match');
    await expect(
      validate(
        { breakdownItem: { findFirst: vi.fn().mockResolvedValue({ id: 'parent' }) } },
        'project',
        'parent-type',
        'parent',
      ),
    ).resolves.toBeUndefined();
  });
});

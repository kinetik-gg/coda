import { describe, expect, it } from 'vitest';
import {
  archiveTrackerFieldSchema,
  bulkDeleteTrackerRecordsSchema,
  bulkSetTrackerRecordValuesSchema,
  createTrackerCommentSchema,
  createTrackerFieldSchema,
  createTrackerRecordSchema,
  createTrackerSchema,
  listTrackerRecordsQuerySchema,
  setTrackerRecordFieldValueSchema,
  trackerActivityItemSchema,
  updateTrackerCommentSchema,
  updateTrackerFieldSchema,
  updateTrackerRecordSchema,
  updateTrackerSchema,
} from './trackers';

const uuid = (suffix: string): string => `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`;

describe('tracker payloads', () => {
  it('composes the Space target into creation and trims names', () => {
    expect(createTrackerSchema.parse({ name: '  Continuity  ' })).toEqual({
      name: 'Continuity',
    });
    expect(
      createTrackerSchema.parse({ name: 'Props', spaceId: uuid('2'), description: null }),
    ).toEqual({ name: 'Props', spaceId: uuid('2'), description: null });
    expect(createTrackerSchema.safeParse({ name: '' }).success).toBe(false);
    expect(createTrackerSchema.safeParse({ name: 'x'.repeat(201) }).success).toBe(false);
  });

  it('requires a version plus at least one field on update', () => {
    expect(updateTrackerSchema.parse({ description: 'd', version: 3 })).toEqual({
      description: 'd',
      version: 3,
    });
    expect(() => updateTrackerSchema.parse({ version: 1 })).toThrow(
      'At least one tracker field is required',
    );
    expect(updateTrackerSchema.safeParse({ name: 'n' }).success).toBe(false);
  });
});

describe('tracker field definitions', () => {
  const base = { name: 'Status', key: 'status', type: 'enum' as const };

  it('accepts enum options and rejects them on option-less types', () => {
    expect(createTrackerFieldSchema.parse({ ...base, options: [{ label: 'Open' }] })).toMatchObject(
      {
        required: false,
        options: [{ label: 'Open' }],
      },
    );
    expect(
      createTrackerFieldSchema.safeParse({ ...base, type: 'text', options: [{ label: 'x' }] })
        .success,
    ).toBe(false);
  });

  it('rejects duplicate option labels and malformed keys', () => {
    expect(
      createTrackerFieldSchema.safeParse({
        ...base,
        options: [{ label: 'Open' }, { label: 'open' }],
      }).success,
    ).toBe(false);
    expect(createTrackerFieldSchema.safeParse({ ...base, key: '9bad' }).success).toBe(false);
  });

  it('guards updates and archives behind a version', () => {
    expect(updateTrackerFieldSchema.parse({ required: true, version: 2 })).toEqual({
      configuration: {},
      required: true,
      version: 2,
    });
    expect(updateTrackerFieldSchema.safeParse({ required: true }).success).toBe(false);
    expect(archiveTrackerFieldSchema.parse({ version: 1 })).toEqual({ version: 1 });
    expect(archiveTrackerFieldSchema.safeParse({}).success).toBe(false);
  });
});

describe('tracker records', () => {
  it('creates records with optional rank neighbours', () => {
    expect(createTrackerRecordSchema.parse({ title: 'Sword' })).toEqual({ title: 'Sword' });
    expect(createTrackerRecordSchema.parse({ title: 'Sword', beforeId: uuid('3') })).toMatchObject({
      beforeId: uuid('3'),
    });
    expect(createTrackerRecordSchema.safeParse({ title: '' }).success).toBe(false);
    expect(createTrackerRecordSchema.safeParse({ title: 'x', afterId: 'nope' }).success).toBe(
      false,
    );
  });

  it('updates records only with a version', () => {
    expect(updateTrackerRecordSchema.parse({ title: 'New', version: 4 })).toEqual({
      title: 'New',
      version: 4,
    });
    expect(updateTrackerRecordSchema.safeParse({ title: 'New' }).success).toBe(false);
  });

  it('allows clearing a value without bumping through a missing version', () => {
    expect(setTrackerRecordFieldValueSchema.parse({ value: null, recordVersion: 7 })).toEqual({
      value: null,
      recordVersion: 7,
    });
    expect(setTrackerRecordFieldValueSchema.safeParse({ value: null }).success).toBe(false);
  });

  it('keeps bulk deletes unique and bounded', () => {
    expect(bulkDeleteTrackerRecordsSchema.parse({ ids: [uuid('1')] }).ids).toHaveLength(1);
    expect(bulkDeleteTrackerRecordsSchema.safeParse({ ids: [uuid('1'), uuid('1')] }).success).toBe(
      false,
    );
    expect(bulkDeleteTrackerRecordsSchema.safeParse({ ids: [] }).success).toBe(false);
  });

  it('rejects duplicate record/field pairs in bulk value sets', () => {
    const update = { recordId: uuid('1'), fieldId: uuid('2'), value: null };
    expect(bulkSetTrackerRecordValuesSchema.parse({ updates: [update] }).updates).toHaveLength(1);
    expect(bulkSetTrackerRecordValuesSchema.safeParse({ updates: [update, update] }).success).toBe(
      false,
    );
  });
});

describe('listTrackerRecordsQuerySchema', () => {
  it('defaults sort, direction, limit, and filters', () => {
    expect(listTrackerRecordsQuerySchema.parse({})).toEqual({
      limit: 100,
      sort: 'manual',
      direction: 'asc',
      filters: [],
    });
  });

  it('decodes JSON filter arrays and demands values for non-empty operators', () => {
    const fieldId = uuid('5');
    const parsed = listTrackerRecordsQuerySchema.parse({
      search: '  prop  ',
      filters: JSON.stringify([{ fieldId, operator: 'equals', value: 'sword' }]),
    });
    expect(parsed.search).toBe('prop');
    expect(parsed.filters).toEqual([{ fieldId, operator: 'equals', value: 'sword' }]);
    expect(
      listTrackerRecordsQuerySchema.safeParse({
        filters: JSON.stringify([{ fieldId, operator: 'equals' }]),
      }).success,
    ).toBe(false);
    expect(listTrackerRecordsQuerySchema.safeParse({ filters: '{nope' }).success).toBe(false);
  });
});

describe('tracker comments', () => {
  it('requires a body and versions updates', () => {
    expect(createTrackerCommentSchema.parse({ body: ' noted ' })).toEqual({ body: 'noted' });
    expect(updateTrackerCommentSchema.parse({ body: 'b', version: 2 })).toEqual({
      body: 'b',
      version: 2,
    });
    expect(updateTrackerCommentSchema.safeParse({ body: 'b' }).success).toBe(false);
    expect(createTrackerCommentSchema.safeParse({ body: '' }).success).toBe(false);
  });
});

describe('trackerActivityItemSchema', () => {
  it('parses a full activity item', () => {
    expect(
      trackerActivityItemSchema.parse({
        id: uuid('a'),
        trackerId: uuid('b'),
        actorId: null,
        action: 'CREATED',
        resourceType: 'tracker_record',
        resourceId: uuid('c'),
        metadata: {},
        createdAt: '2026-08-23',
      }),
    ).toMatchObject({ action: 'CREATED' });
  });

  it('rejects unknown actions and extra properties', () => {
    const base = {
      id: uuid('a'),
      trackerId: uuid('b'),
      actorId: null,
      action: 'CREATED',
      resourceType: 'tracker_record',
      resourceId: null,
      metadata: {},
      createdAt: '2026-08-23',
    };
    expect(trackerActivityItemSchema.safeParse(base).success).toBe(true);
    expect(trackerActivityItemSchema.safeParse({ ...base, action: 'MERGED' }).success).toBe(false);
    expect(trackerActivityItemSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
  });
});

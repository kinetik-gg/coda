import { describe, expect, it } from 'vitest';
import {
  bulkSetTrackerRecordValuesSchema,
  createTrackerFieldSchema,
  createTrackerRecordSchema,
  listTrackerRecordsQuerySchema,
  reorderTrackerFieldSchema,
  reorderTrackerRecordSchema,
  setTrackerRecordFieldValueSchema,
  trackerRecordFilterSchema,
  updateTrackerFieldOptionSchema,
  updateTrackerFieldSchema,
  updateTrackerRecordSchema,
} from './index';

const uuid = '10000000-0000-4000-8000-000000000001';

describe('tracker field contracts', () => {
  it('requires option labels to be unique and enum-only at creation', () => {
    expect(
      createTrackerFieldSchema.parse({
        name: 'Status',
        key: 'status',
        type: 'enum',
        options: [{ label: 'Open' }],
      }),
    ).toMatchObject({ type: 'enum', required: false });
    expect(() =>
      createTrackerFieldSchema.parse({
        name: 'Status',
        key: 'status',
        type: 'text',
        options: [{ label: 'Open' }],
      }),
    ).toThrow('Options are only supported by enum and multi-enum fields');
    expect(() =>
      createTrackerFieldSchema.parse({
        name: 'Status',
        key: 'status',
        type: 'enum',
        options: [{ label: 'Open' }, { label: 'open' }],
      }),
    ).toThrow('Option labels must be unique');
  });

  it('enforces the field key vocabulary on updates', () => {
    expect(updateTrackerFieldSchema.parse({ name: 'Renamed', version: 2 })).toMatchObject({
      name: 'Renamed',
      version: 2,
    });
    expect(() => updateTrackerFieldSchema.parse({ key: 'Bad Key', version: 1 })).toThrow();
    expect(() => updateTrackerFieldSchema.parse({ name: 'Renamed' })).toThrow();
  });

  it('keeps reorder bodies to one rank gap plus a version', () => {
    expect(reorderTrackerFieldSchema.parse({ beforeId: uuid, version: 3 })).toEqual({
      beforeId: uuid,
      version: 3,
    });
    expect(reorderTrackerFieldSchema.parse({ version: 1 })).toEqual({ version: 1 });
    expect(() => reorderTrackerFieldSchema.parse({ beforeId: 'nope', version: 1 })).toThrow();
    expect(() => reorderTrackerFieldSchema.parse({ beforeId: uuid })).toThrow();
  });

  it('validates partial option updates', () => {
    expect(updateTrackerFieldOptionSchema.parse({})).toEqual({});
    expect(updateTrackerFieldOptionSchema.parse({ color: null })).toEqual({ color: null });
    expect(() => updateTrackerFieldOptionSchema.parse({ label: '' })).toThrow();
    expect(() => updateTrackerFieldOptionSchema.parse({ label: 'x'.repeat(121) })).toThrow();
  });
});

describe('tracker record contracts', () => {
  it('trims titles and bounds their length', () => {
    expect(createTrackerRecordSchema.parse({ title: '  Scene lock  ' })).toEqual({
      title: 'Scene lock',
    });
    expect(() => createTrackerRecordSchema.parse({ title: '' })).toThrow();
    expect(() => createTrackerRecordSchema.parse({ title: 'x'.repeat(301) })).toThrow();
  });

  it('allows a title-only optimistic update and a bare reorder body', () => {
    expect(updateTrackerRecordSchema.parse({ title: 'Moved', version: 4 })).toEqual({
      title: 'Moved',
      version: 4,
    });
    expect(reorderTrackerRecordSchema.parse({ afterId: uuid, version: 2 })).toEqual({
      afterId: uuid,
      version: 2,
    });
    expect(() => updateTrackerRecordSchema.parse({ title: 'Moved' })).toThrow();
  });

  it('pairs value writes with the record version they were authored against', () => {
    expect(
      setTrackerRecordFieldValueSchema.parse({
        value: { type: 'text', value: 'ok' },
        recordVersion: 7,
      }),
    ).toMatchObject({ recordVersion: 7 });
    expect(setTrackerRecordFieldValueSchema.parse({ value: null, recordVersion: 1 })).toMatchObject(
      { value: null },
    );
    expect(() => setTrackerRecordFieldValueSchema.parse({ value: null })).toThrow();
  });

  it('rejects duplicate record-field pairs in bulk value sets', () => {
    const update = {
      recordId: uuid,
      fieldId: '20000000-0000-4000-8000-000000000002',
      value: { type: 'boolean', value: true },
    };
    expect(bulkSetTrackerRecordValuesSchema.parse({ updates: [update] }).updates).toHaveLength(1);
    expect(() => bulkSetTrackerRecordValuesSchema.parse({ updates: [update, update] })).toThrow(
      'Each record field may only be set once',
    );
  });

  it('parses record list queries with defaults, search, and typed filters', () => {
    const parsed = listTrackerRecordsQuerySchema.parse({
      sort: 'title',
      direction: 'desc',
      search: ' scene ',
      filters: JSON.stringify([{ fieldId: uuid, operator: 'equals', value: 'x' }]),
    });
    expect(parsed).toMatchObject({
      limit: 100,
      sort: 'title',
      direction: 'desc',
      search: 'scene',
    });
    expect(parsed.filters).toHaveLength(1);
    expect(listTrackerRecordsQuerySchema.parse({}).filters).toEqual([]);
    expect(() => listTrackerRecordsQuerySchema.parse({ limit: 251 })).toThrow();
    expect(() => trackerRecordFilterSchema.parse({ fieldId: uuid, operator: 'equals' })).toThrow(
      'A value is required for this filter operator',
    );
    expect(() =>
      listTrackerRecordsQuerySchema.parse({
        filters: JSON.stringify([{ fieldId: uuid, operator: 'wat' }]),
      }),
    ).toThrow();
  });
});

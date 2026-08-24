import { describe, expect, it } from 'vitest';
import {
  bulkSetTrackerRecordValuesSchema,
  createTrackerCommentSchema,
  createTrackerFieldSchema,
  createTrackerRecordSchema,
  exportTrackerRecordsQuerySchema,
  listTrackerCommentsQuerySchema,
  listTrackerRecordsQuerySchema,
  reorderTrackerFieldSchema,
  reorderTrackerRecordSchema,
  setTrackerRecordFieldValueSchema,
  trackerRecordFilterSchema,
  updateTrackerCommentSchema,
  updateTrackerFieldOptionSchema,
  updateTrackerFieldSchema,
  updateTrackerRecordSchema,
} from './index';

const uuid = '10000000-0000-4000-8000-000000000001';
const secondUuid = '10000000-0000-4000-8000-000000000002';

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

  it('builds export queries from the list vocabulary without pagination', () => {
    expect(exportTrackerRecordsQuerySchema.parse({})).toEqual({
      sort: 'manual',
      direction: 'asc',
      filters: [],
    });
    expect(() => exportTrackerRecordsQuerySchema.parse({ cursor: 'abc' })).toThrow();
    expect(() => exportTrackerRecordsQuerySchema.parse({ limit: 50 })).toThrow();
    expect(() => exportTrackerRecordsQuerySchema.parse({ sort: 'loudness' })).toThrow();
    const parsed = exportTrackerRecordsQuerySchema.parse({
      sort: 'updated_at',
      direction: 'desc',
      search: ' scene ',
      filters: JSON.stringify([
        { fieldId: uuid, operator: 'equals', value: 'x' },
        { fieldId: secondUuid, operator: 'is_empty' },
      ]),
    });
    expect(parsed.search).toBe('scene');
    expect(parsed.filters).toHaveLength(2);
    expect(() =>
      exportTrackerRecordsQuerySchema.parse({
        filters: JSON.stringify([{ fieldId: uuid, operator: 'nope' }]),
      }),
    ).toThrow();
  });
});

describe('tracker comment contracts', () => {
  it('bounds comment bodies and requires an optimistic version on edits', () => {
    expect(createTrackerCommentSchema.parse({ body: '  hi  ' })).toEqual({ body: 'hi' });
    expect(() => createTrackerCommentSchema.parse({ body: '' })).toThrow();
    expect(() => createTrackerCommentSchema.parse({ body: 'x'.repeat(10001) })).toThrow();
    expect(() => updateTrackerCommentSchema.parse({ body: 'x' })).toThrow();
    expect(updateTrackerCommentSchema.parse({ body: 'x', version: 2 })).toEqual({
      body: 'x',
      version: 2,
    });
  });

  it('parses comment list queries with the shared cursor envelope bounds', () => {
    expect(listTrackerCommentsQuerySchema.parse({})).toEqual({ limit: 100 });
    expect(listTrackerCommentsQuerySchema.parse({ limit: '5', cursor: 'abc' })).toEqual({
      limit: 5,
      cursor: 'abc',
    });
    expect(() => listTrackerCommentsQuerySchema.parse({ limit: 0 })).toThrow();
    expect(() => listTrackerCommentsQuerySchema.parse({ limit: 251 })).toThrow();
  });
});

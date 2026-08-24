import { describe, expect, it } from 'vitest';
import type { TrackerField, TrackerRecord, TrackerFieldValue } from '../trackers/types';
import {
  recordUpdatedText,
  freshGridConfig,
  gridCellText,
  gridViewColumns,
  isMediaField,
  isSingleSelectField,
  recordsQueryString,
  sortParam,
  type GridPanel,
} from './tracker-model';

function field(id: string, type = 'text'): TrackerField {
  return { id, name: id.toUpperCase(), key: id, type, required: false, version: 1, options: [] };
}

function value(partial: Partial<TrackerFieldValue>): TrackerFieldValue {
  return {
    fieldId: 'f1',
    textValue: null,
    integerValue: null,
    floatValue: null,
    booleanValue: null,
    dateValue: null,
    option: null,
    options: [],
    storageObjectId: null,
    ...partial,
  };
}

function record(values: TrackerFieldValue[]): TrackerRecord {
  return {
    id: 'rec1',
    trackerId: 't1',
    title: 'Row',
    position: 'aaa',
    version: 1,
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T12:00:00.000Z',
    values,
  };
}

function panel(overrides?: Partial<GridPanel['config']>): GridPanel {
  return {
    id: 'p1',
    type: 'grid',
    configVersion: 1,
    config: { ...freshGridConfig(), ...overrides },
  };
}

describe('tracker-model', () => {
  it('maps every sort alias to its query parameter', () => {
    expect(sortParam('manual')).toBe('manual');
    expect(sortParam('title')).toBe('title');
    expect(sortParam('created_at')).toBe('created_at');
    expect(sortParam('updated_at')).toBe('updated_at');
    expect(sortParam('code')).toBe('title');
  });

  it('serializes the records query with optional search and filters', () => {
    const base = { search: '', sort: 'manual', direction: 'asc', filters: [] } as const;
    expect(recordsQueryString(base)).toBe('limit=100&sort=manual&direction=asc');
    const full = recordsQueryString({
      search: 'dock',
      sort: 'title',
      direction: 'desc',
      filters: [{ fieldId: 'f1' }],
    });
    expect(full).toContain('limit=100');
    expect(full).toContain('sort=title');
    expect(full).toContain('direction=desc');
    expect(full).toContain(`search=${encodeURIComponent('dock')}`);
    expect(full).toContain(`filters=${encodeURIComponent(JSON.stringify([{ fieldId: 'f1' }]))}`);
  });

  it('classifies single-select enums and media fields case-insensitively', () => {
    expect(isSingleSelectField(field('f1', 'ENUM'))).toBe(true);
    expect(isSingleSelectField(field('f2', 'multi_enum'))).toBe(false);
    expect(isSingleSelectField(field('f3', 'text'))).toBe(false);
    for (const kind of ['file', 'image', 'video'] as const) {
      expect(isMediaField(field(`m-${kind}`, kind))).toBe(true);
    }
    expect(isMediaField(field('m-text', 'text'))).toBe(false);
  });

  it('builds the column model with hidden and ordered custom fields', () => {
    const fields = [field('f1', 'TEXT'), field('f2', 'ENUM'), field('f3', 'DATE')];
    const columns = gridViewColumns(panel(), fields);
    expect(columns.map((column) => column.key)).toEqual([
      'title',
      'updated',
      'field:f1',
      'field:f2',
      'field:f3',
    ]);

    const reordered = gridViewColumns(
      panel({ visibleCustomFieldIds: ['f3', 'f1'], hiddenColumns: [] }),
      fields,
    );
    expect(reordered.map((column) => column.key)).toEqual([
      'title',
      'updated',
      'field:f3',
      'field:f1',
    ]);
    expect(reordered[2]!.field?.id).toBe('f3');

    const hiddenCore = gridViewColumns(panel({ hiddenColumns: ['title'] }), []);
    expect(hiddenCore.map((column) => column.key)).toEqual(['updated']);

    const hiddenField = gridViewColumns(
      panel({ visibleCustomFieldIds: ['f1'], hiddenColumns: ['field:f1'] }),
      fields,
    );
    expect(hiddenField.some((column) => column.key === 'field:f1')).toBe(false);
  });

  it('renders cell text per value shape and empty default', () => {
    expect(gridCellText(record([]), 'f1')).toBe('');
    expect(gridCellText(record([value({ textValue: 'plain' })]), 'f1')).toBe('plain');
    expect(gridCellText(record([value({ option: { id: 'o1', label: 'Done' } })]), 'f1')).toBe(
      'Done',
    );
    expect(
      gridCellText(
        record([
          value({
            options: [{ option: { id: 'o1', label: 'A' } }, { option: { id: 'o2', label: 'B' } }],
          }),
        ]),
        'f1',
      ),
    ).toBe('A, B');
    expect(gridCellText(record([value({ booleanValue: true })]), 'f1')).toBe('TRUE');
    expect(gridCellText(record([value({ booleanValue: false })]), 'f1')).toBe('FALSE');
    expect(gridCellText(record([value({ integerValue: 42 })]), 'f1')).toBe('42');
    expect(gridCellText(record([value({ floatValue: 1.5 })]), 'f1')).toBe('1.5');
    expect(gridCellText(record([value({ dateValue: '2026-08-24' })]), 'f1')).toBe('2026-08-24');
    expect(gridCellText(record([value({ storageObjectId: 'obj1' })]), 'f1')).toBe('Attachment');
  });
});

describe('recordUpdatedText', () => {
  it('localizes the updated timestamp', () => {
    const row = { ...record([]) };
    expect(typeof row.updatedAt).toBe('string');
    expect(recordUpdatedText(row)).toContain('2026');
  });
});

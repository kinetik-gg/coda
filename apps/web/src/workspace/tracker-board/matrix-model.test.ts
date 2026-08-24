import { describe, expect, it } from 'vitest';
import type { TrackerField, TrackerRecord } from '../../trackers/types';
import {
  buildMatrix,
  freshMatrixConfig,
  MATRIX_CHIP_CAP,
  matrixCellKey,
  UNSET_FIELD_ID,
  visibleChips,
} from './matrix-model';

function enumField(id: string, optionIds: string[]): TrackerField {
  return {
    id,
    name: `Field ${id}`,
    key: id,
    type: 'enum',
    required: false,
    version: 1,
    options: optionIds.map((optionId) => ({ id: optionId, label: `Opt ${optionId}` })),
  };
}

function record(
  id: string,
  values: Array<{ fieldId: string; optionId?: string }>,
): TrackerRecord {
  return {
    id,
    trackerId: 't1',
    title: `Record ${id}`,
    position: id,
    version: 1,
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T00:00:00.000Z',
    values: values
      .filter((entry) => entry.optionId)
      .map((entry) => ({
        fieldId: entry.fieldId,
        textValue: null,
        integerValue: null,
        floatValue: null,
        booleanValue: null,
        dateValue: null,
        options: [],
        option: { id: entry.optionId!, label: `Opt ${entry.optionId}` },
      })),
  };
}

const rows = enumField('f-row', ['r1', 'r2']);
const cols = enumField('f-col', ['c1', 'c2']);

describe('fresh matrix config', () => {
  it('starts with unset sentinels on both axes', () => {
    const config = freshMatrixConfig();
    expect(config.rowFieldId).toBe(UNSET_FIELD_ID);
    expect(config.colFieldId).toBe(UNSET_FIELD_ID);
  });
});

describe('buildMatrix', () => {
  it('aggregates matching records into the intersecting cell only', () => {
    const records = [
      record('a', [
        { fieldId: 'f-row', optionId: 'r1' },
        { fieldId: 'f-col', optionId: 'c1' },
      ]),
      record('b', [
        { fieldId: 'f-row', optionId: 'r1' },
        { fieldId: 'f-col', optionId: 'c1' },
      ]),
      record('c', [
        { fieldId: 'f-row', optionId: 'r1' },
        { fieldId: 'f-col', optionId: 'c2' },
      ]),
    ];
    const model = buildMatrix(rows, cols, records);
    expect(model.cells.get(matrixCellKey('r1', 'c1'))!.records.map((entry) => entry.id)).toEqual([
      'a',
      'b',
    ]);
    expect(model.cells.get(matrixCellKey('r1', 'c2'))!.records.map((entry) => entry.id)).toEqual([
      'c',
    ]);
    expect(model.cells.get(matrixCellKey('r2', 'c1'))).toBeUndefined();
  });

  it('excludes records missing either axis value or pointing at retired options', () => {
    const records = [
      record('a', [{ fieldId: 'f-row', optionId: 'r1' }]),
      record('b', []),
      record('c', [
        { fieldId: 'f-row', optionId: 'rX' },
        { fieldId: 'f-col', optionId: 'c1' },
      ]),
    ];
    const model = buildMatrix(rows, cols, records);
    expect(model.grandTotal).toBe(0);
    expect([...model.cells.values()]).toHaveLength(0);
  });

  it('totals per row, per column, and overall', () => {
    const records = [
      record('a', [
        { fieldId: 'f-row', optionId: 'r1' },
        { fieldId: 'f-col', optionId: 'c1' },
      ]),
      record('b', [
        { fieldId: 'f-row', optionId: 'r1' },
        { fieldId: 'f-col', optionId: 'c2' },
      ]),
      record('c', [
        { fieldId: 'f-row', optionId: 'r2' },
        { fieldId: 'f-col', optionId: 'c1' },
      ]),
    ];
    const model = buildMatrix(rows, cols, records);
    expect(model.rowTotals.get('r1')).toBe(2);
    expect(model.rowTotals.get('r2')).toBe(1);
    expect(model.colTotals.get('c1')).toBe(2);
    expect(model.colTotals.get('c2')).toBe(1);
    expect(model.grandTotal).toBe(3);
  });

  it('carries every axis option even when cells stay empty', () => {
    const model = buildMatrix(rows, cols, []);
    expect(model.rows.map((option) => option.id)).toEqual(['r1', 'r2']);
    expect(model.cols.map((option) => option.id)).toEqual(['c1', 'c2']);
    expect(model.grandTotal).toBe(0);
  });
});

describe('chip capping', () => {
  it('caps chips at MATRIX_CHIP_CAP and exposes the remainder for the popover', () => {
    const records = [1, 2, 3, 4, 5].map((index) =>
      record(`r${index}`, [
        { fieldId: 'f-row', optionId: 'r1' },
        { fieldId: 'f-col', optionId: 'c1' },
      ]),
    );
    const model = buildMatrix(rows, cols, records);
    const cell = model.cells.get(matrixCellKey('r1', 'c1'))!;
    expect(cell.records).toHaveLength(5);
    expect(visibleChips(cell).map((entry) => entry.id)).toEqual(['r1', 'r2', 'r3']);
    expect(MATRIX_CHIP_CAP).toBeLessThan(cell.records.length);
    expect(cell.records.slice(visibleChips(cell).length).map((entry) => entry.id)).toEqual([
      'r4',
      'r5',
    ]);
  });
});

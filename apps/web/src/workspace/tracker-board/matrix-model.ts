import type { WorkspacePanel } from '@coda/contracts';
import type { TrackerField, TrackerFieldOption, TrackerRecord } from '../../trackers/types';
import { freshGridConfig } from '../tracker-model';

/** The tracker workspace's pivot panel (`matrix` in the shared panel-type union). */
export type MatrixPanel = Extract<WorkspacePanel, { type: 'matrix' }>;

/** The nil-UUID sentinel for "no field chosen yet"; real field ids never collide with it. */
export const UNSET_FIELD_ID = '00000000-0000-0000-0000-000000000000';

/** A fresh matrix panel body; both axes start unset until View-menu fields are picked. */
export function freshMatrixConfig() {
  return {
    ...freshGridConfig(),
    rowFieldId: UNSET_FIELD_ID,
    colFieldId: UNSET_FIELD_ID,
  };
}

/** Chips rendered per cell before the remainder collapses into a "+N more" popover. */
export const MATRIX_CHIP_CAP = 3;

export function matrixCellKey(rowOptionId: string, colOptionId: string): string {
  return `${rowOptionId}\u0000${colOptionId}`;
}

function optionIdOf(record: TrackerRecord, fieldId: string): string | undefined {
  return record.values.find((entry) => entry.fieldId === fieldId)?.option?.id;
}

export interface MatrixCell {
  rowOptionId: string;
  colOptionId: string;
  /** Every matching record; chip rendering caps how many surface before the "+N more". */
  records: TrackerRecord[];
}

export interface MatrixModel {
  rows: TrackerFieldOption[];
  cols: TrackerFieldOption[];
  cells: Map<string, MatrixCell>;
  rowTotals: Map<string, number>;
  colTotals: Map<string, number>;
  grandTotal: number;
}

/**
 * The matrix aggregation: one cell per row-option × col-option pair holding every matching
 * record (count plus chips up front, remainder behind a "+N more" popover), with row/column
 * totals. Records missing either value fall outside the grid.
 */
export function buildMatrix(
  rowField: TrackerField,
  colField: TrackerField,
  records: TrackerRecord[],
): MatrixModel {
  const cells = new Map<string, MatrixCell>();
  const rowTotals = new Map<string, number>();
  const colTotals = new Map<string, number>();
  let grandTotal = 0;
  const cellFor = (rowOptionId: string, colOptionId: string): MatrixCell => {
    const key = matrixCellKey(rowOptionId, colOptionId);
    let cell = cells.get(key);
    if (!cell) {
      cell = { rowOptionId, colOptionId, records: [] };
      cells.set(key, cell);
    }
    return cell;
  };
  for (const record of records) {
    const rowOptionId = optionIdOf(record, rowField.id);
    const colOptionId = optionIdOf(record, colField.id);
    if (!rowOptionId || !colOptionId) continue;
    if (!rowField.options.some((option) => option.id === rowOptionId)) continue;
    if (!colField.options.some((option) => option.id === colOptionId)) continue;
    cellFor(rowOptionId, colOptionId).records.push(record);
    rowTotals.set(rowOptionId, (rowTotals.get(rowOptionId) ?? 0) + 1);
    colTotals.set(colOptionId, (colTotals.get(colOptionId) ?? 0) + 1);
    grandTotal += 1;
  }
  return {
    rows: rowField.options,
    cols: colField.options,
    cells,
    rowTotals,
    colTotals,
    grandTotal,
  };
}

/** The chips a cell renders before its remainder collapses into the popover. */
export function visibleChips(cell: MatrixCell): TrackerRecord[] {
  return cell.records.slice(0, MATRIX_CHIP_CAP);
}

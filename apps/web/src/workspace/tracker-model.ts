import type { WorkspacePanel } from '@coda/contracts';
import type { TrackerField, TrackerFieldValue, TrackerRecord } from '../trackers/types';

/** The tracker workspace's record-grid panel (`grid` in the shared panel-type union). */
export type GridPanel = Extract<WorkspacePanel, { type: 'grid' }>;

export const TRACKER_SORTS = ['manual', 'title', 'created_at', 'updated_at'] as const;
export type TrackerSort = (typeof TRACKER_SORTS)[number];

/** Every sort value the layout contract allows a column view to persist (`code` is legacy). */
export type TrackerRecordSort = TrackerSort | 'code';

/** Records-endpoint page size shared by the grid, board, and matrix panels. */
export const RECORD_PAGE_SIZE = 100;

/** The panel sort vocabulary mapped onto the records endpoint's accepted values. */
const SORT_PARAMS: Record<TrackerRecordSort, 'manual' | 'title' | 'created_at' | 'updated_at'> = {
  manual: 'manual',
  title: 'title',
  code: 'title',
  created_at: 'created_at',
  updated_at: 'updated_at',
};

export function sortParam(
  sort: TrackerRecordSort,
): 'manual' | 'title' | 'created_at' | 'updated_at' {
  return SORT_PARAMS[sort];
}

/** The config slice every column-bearing view contributes to the records query. */
export interface TrackerRecordsQueryConfig {
  search: string;
  sort: TrackerRecordSort;
  direction: 'asc' | 'desc';
  filters: readonly unknown[];
}

/** The serialized query string identifying one view's server-side record selection. */
export function recordsQueryString(config: TrackerRecordsQueryConfig): string {
  const query = new URLSearchParams({
    limit: String(RECORD_PAGE_SIZE),
    sort: sortParam(config.sort),
    direction: config.direction,
  });
  if (config.search) query.set('search', config.search);
  if (config.filters.length) query.set('filters', JSON.stringify(config.filters));
  return query.toString();
}

/** Board lanes and matrix axes aggregate over single-select enum fields only. */
export function isSingleSelectField(field: TrackerField): boolean {
  return field.type.toLowerCase() === 'enum';
}

export interface TrackerGridColumn {
  key: string;
  label: string;
  field?: TrackerField;
}

const CORE_COLUMNS: TrackerGridColumn[] = [
  { key: 'title', label: 'TITLE' },
  { key: 'updated', label: 'UPDATED' },
];

/**
 * Column model of the tracker grid: fixed identity columns, then one column per active field.
 * Field columns are visible by default in field order. Once customized, `visibleCustomFieldIds`
 * carries the explicit column order and `hiddenColumns` records hidden columns — core columns by
 * key, field columns as `field:<id>` — so show/hide and reorder persist independently.
 */
export function gridViewColumns(panel: GridPanel, fields: TrackerField[]): TrackerGridColumn[] {
  const hidden = new Set(panel.config.hiddenColumns);
  const core = CORE_COLUMNS.filter((column) => !hidden.has(column.key));
  const columns = fields.map((field) => ({ key: `field:${field.id}`, label: field.name, field }));
  const order = panel.config.visibleCustomFieldIds;
  const ordered = order.length
    ? order.flatMap((id) => columns.filter((column) => column.field?.id === id))
    : columns;
  return [...core, ...ordered.filter((column) => column.field && !hidden.has(column.key))];
}

function fieldValueOf(record: TrackerRecord, fieldId: string): TrackerFieldValue | undefined {
  return record.values.find((entry) => entry.fieldId === fieldId);
}

/** Media fields have no editor yet; their cells render a filename chip placeholder. */
export function isMediaField(field: TrackerField): boolean {
  return ['file', 'image', 'video'].includes(field.type.toLowerCase());
}

/** The plain text a grid cell renders for a record+field; media cells report their attachment. */
export function gridCellText(record: TrackerRecord, fieldId: string): string {
  const value = fieldValueOf(record, fieldId);
  if (!value) return '';
  if (value.option) return value.option.label;
  if (value.options?.length) return value.options.map((entry) => entry.option.label).join(', ');
  if (value.booleanValue !== null && value.booleanValue !== undefined)
    return value.booleanValue ? 'TRUE' : 'FALSE';
  if (value.integerValue !== null && value.integerValue !== undefined)
    return String(value.integerValue);
  if (value.floatValue !== null && value.floatValue !== undefined) return String(value.floatValue);
  if (value.dateValue) return value.dateValue.slice(0, 10);
  if (value.storageObjectId) return 'Attachment';
  return typeof value.textValue === 'string' ? value.textValue : '';
}

export function recordUpdatedText(record: TrackerRecord): string {
  return new Date(record.updatedAt).toLocaleString();
}

/** A fresh grid panel body with the default column view state. */
export function freshGridConfig() {
  return {
    search: '',
    sort: 'manual' as const,
    direction: 'asc' as const,
    filters: [],
    hiddenColumns: [],
    visibleCustomFieldIds: [],
    columnWidths: {},
  };
}

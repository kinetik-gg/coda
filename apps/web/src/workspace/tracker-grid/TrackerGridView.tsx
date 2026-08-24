import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { DotsSixIcon } from '@phosphor-icons/react/dist/csr/DotsSix';
import { Skeleton, SkeletonGroup } from '../../components/Skeleton';
import type { ApiFieldValue } from '../panels/item-panel-utils';
import type { TrackerField, TrackerRecord } from '../../trackers/types';
import { customEditorValue } from '../panels/inspector-values';
import {
  CellEditor,
  cellEditorKind,
  TitleCellInput,
  typingOpensEditor,
} from '../panels/TrackerCellEditors';
import {
  gridCellText,
  isMediaField,
  recordUpdatedText,
  type TrackerGridColumn,
} from '../tracker-model';
import {
  mediaKindOfField,
  storageObjectIdOf,
} from '../tracker-media/tracker-media-model';
import { TrackerMediaCell } from '../tracker-media/TrackerMediaReadonly';
import styles from './TrackerGrid.module.css';

export interface CellAddress {
  row: number;
  column: number;
}

function clamp(value: number, maximum: number): number {
  return Math.max(0, Math.min(value, Math.max(0, maximum)));
}

export function gridColumnWidth(widths: Record<string, number>, key: string, field?: TrackerField) {
  return widths[key] ?? (key === 'title' ? 260 : field ? 160 : 150);
}

function cellText(column: TrackerGridColumn, record: TrackerRecord): string {
  if (column.key === 'title') return record.title;
  if (column.key === 'updated') return recordUpdatedText(record);
  return gridCellText(record, column.field?.id ?? '');
}

interface RowProps {
  trackerId: string;
  record: TrackerRecord;
  rowIndex: number;
  selected: boolean;
  columns: TrackerGridColumn[];
  columnWidths: Record<string, number>;
  reorderEnabled: boolean;
  editingColumn?: number;
  editSeed?: string;
  onSelect: () => void;
  onStartEdit: (column: number, seed?: string) => void;
  onCancelEdit: () => void;
  onCommitTitle: (record: TrackerRecord, title: string, step?: { horizontal: number }) => void;
  onCommitCell: (
    record: TrackerRecord,
    field: TrackerField,
    value: ApiFieldValue | null,
    step?: { horizontal: number },
  ) => void;
}

function GridRow({
  trackerId,
  record,
  rowIndex,
  selected,
  columns,
  columnWidths,
  reorderEnabled,
  editingColumn,
  editSeed,
  onSelect,
  onStartEdit,
  onCancelEdit,
  onCommitTitle,
  onCommitCell,
}: RowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: record.id, disabled: !reorderEnabled });
  const style = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
    zIndex: isDragging ? 3 : undefined,
    position: 'relative',
  } as CSSProperties;
  return (
    <tr ref={setNodeRef} style={style} className={selected ? styles.selectedRow : ''}>
      <td className={styles.handleCell}>
        <button
          ref={setActivatorNodeRef}
          className={styles.dragHandle}
          type="button"
          aria-label={`Reorder ${record.title}`}
          disabled={!reorderEnabled}
          {...attributes}
          {...listeners}
        >
          <DotsSixIcon size={12} weight="bold" />
        </button>
      </td>
      {columns.map((column, columnIndex) => {
        const editing = editingColumn === columnIndex;
        const width = gridColumnWidth(columnWidths, column.key, column.field);
        const media = column.field ? isMediaField(column.field) : false;
        return (
          <td
            key={column.key}
            data-cell={`${rowIndex}:${columnIndex}`}
            tabIndex={-1}
            aria-selected={selected}
            className={editing ? styles.editingCell : ''}
            style={{ width }}
            onClick={onSelect}
            onDoubleClick={() => onStartEdit(columnIndex)}
          >
            {editing && column.key === 'title' ? (
              <TitleCellInput
                recordId={record.id}
                initial={record.title}
                seed={editSeed}
                onCommit={(title, move) => onCommitTitle(record, title, move)}
                onCancel={onCancelEdit}
              />
            ) : editing && column.field ? (
              <CellEditor
                trackerId={trackerId}
                field={column.field}
                recordId={record.id}
                current={
                  isMediaField(column.field)
                    ? (storageObjectIdOf(record, column.field.id) ?? '')
                    : customEditorValue(
                        column.field,
                        record.values.find((entry) => entry.fieldId === column.field?.id),
                      )
                }
                seed={editSeed}
                onSave={(value, move) => onCommitCell(record, column.field!, value, move)}
                onCancel={onCancelEdit}
              />
            ) : media && column.field ? (
              <TrackerMediaCell
                trackerId={trackerId}
                kind={mediaKindOfField(column.field)}
                objectId={storageObjectIdOf(record, column.field.id)}
              />
            ) : (
              <span className={styles.cellValue} title={cellText(column, record)}>
                {cellText(column, record) || '—'}
              </span>
            )}
          </td>
        );
      })}
    </tr>
  );
}

/**
 * The tracker record table: sticky header, roving-tabindex keyboard navigation
 * (arrows/Tab move, Enter edits, typing seeds text edits), dnd-kit manual-rank reorder,
 * skeleton loading, cursor-paged "load more", and per-type cell editors mounted in place.
 * Media fields (#382) render thumbnails and meta chips read-only and open the shared
 * media editor (upload/replace/remove) when activated.
 */
export function TrackerGridView({
  trackerId,
  columns,
  columnWidths,
  records,
  selectedId,
  sort,
  loading,
  error,
  hasMore,
  loadingMore,
  canEdit,
  onSelect,
  onEditTitle,
  onEditCell,
  onResize,
  onReorder,
  onLoadMore,
  onRetry,
}: {
  trackerId: string;
  columns: TrackerGridColumn[];
  columnWidths: Record<string, number>;
  records: TrackerRecord[];
  selectedId?: string;
  sort: string;
  loading: boolean;
  error: Error | null;
  hasMore: boolean;
  loadingMore: boolean;
  canEdit: boolean;
  onSelect: (record: TrackerRecord) => void;
  onEditTitle: (record: TrackerRecord, title: string) => Promise<void> | void;
  onEditCell: (
    record: TrackerRecord,
    field: TrackerField,
    value: ApiFieldValue | null,
  ) => Promise<void> | void;
  onResize: (event: ReactPointerEvent<HTMLButtonElement>, key: string) => void;
  onReorder: (event: DragEndEvent) => void;
  onLoadMore: () => void;
  onRetry: () => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [active, setActive] = useState<CellAddress>({ row: 0, column: 0 });
  const [editing, setEditing] = useState<CellAddress>();
  const [editSeed, setEditSeed] = useState<string>();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editing) return;
    scrollRef.current
      ?.querySelector<HTMLTableCellElement>(`[data-cell="${active.row}:${active.column}"]`)
      ?.focus({ preventScroll: true });
  }, [active, editing, records, columns]);

  const move = (rowDelta: number, columnDelta: number) =>
    setActive((current) => ({
      row: clamp(current.row + rowDelta, records.length - 1),
      column: clamp(current.column + columnDelta, columns.length - 1),
    }));

  const startEdit = (address: CellAddress, seed?: string) => {
    const column = columns[address.column];
    if (!column || !canEdit) return;
    if (column.key !== 'title' && !column.field) return;
    setActive(address);
    setEditing(address);
    setEditSeed(seed);
  };

  const endEdit = () => {
    setEditing(undefined);
    setEditSeed(undefined);
  };

  const commitTitle = (
    record: TrackerRecord,
    title: string,
    step?: { horizontal: number },
  ) => {
    endEdit();
    if (step) move(0, step.horizontal);
    void onEditTitle(record, title);
  };
  const commitCell = (
    record: TrackerRecord,
    field: TrackerField,
    value: ApiFieldValue | null,
    step?: { horizontal: number },
  ) => {
    endEdit();
    if (step) move(0, step.horizontal);
    void onEditCell(record, field, value);
  };

  const keyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (editing) return;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        return move(1, 0);
      case 'ArrowUp':
        event.preventDefault();
        return move(-1, 0);
      case 'ArrowLeft':
        event.preventDefault();
        return move(0, -1);
      case 'ArrowRight':
        event.preventDefault();
        return move(0, 1);
      case 'Tab':
        event.preventDefault();
        return move(0, event.shiftKey ? -1 : 1);
      case 'Enter':
        event.preventDefault();
        return startEdit(active);
      default: {
        const printable =
          event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
        if (!printable) return;
        const column = columns[active.column];
        const kind = column?.field ? cellEditorKind(column.field) : 'text';
        if (!typingOpensEditor(kind)) return;
        event.preventDefault();
        startEdit(active, event.key);
      }
    }
  };
  const columnCount = columns.length + 1;

  return (
    <div className={styles.gridShell}>
      <div className={styles.tableScroll} ref={scrollRef} onKeyDown={keyDown}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onReorder}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.handleCell} aria-label="Reorder" />
                {columns.map((column) => (
                  <th
                    key={column.key}
                    style={{ minWidth: gridColumnWidth(columnWidths, column.key, column.field) }}
                  >
                    <span className={styles.columnHeader}>
                      <span data-column-label>{column.label}</span>
                    </span>
                    <button
                      type="button"
                      tabIndex={-1}
                      className={styles.columnResize}
                      aria-label={`Resize ${column.label}`}
                      onPointerDown={(event) => onResize(event, column.key)}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <SortableContext
              items={records.map((record) => record.id)}
              strategy={verticalListSortingStrategy}
            >
              <tbody>
                {loading &&
                  Array.from({ length: 8 }, (_, rowIndex) => (
                    <tr key={`loading-${rowIndex}`} className={styles.skeletonRow}>
                      <td className={styles.handleCell}>
                        <Skeleton width={12} height={12} />
                      </td>
                      {columns.map((column, columnIndex) => (
                        <td key={column.key}>
                          <Skeleton
                            width={columnIndex % 2 ? '72%' : '88%'}
                            height={9}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                  {!loading &&
                  !error &&
                  records.map((record, rowIndex) => (
                    <GridRow
                      key={record.id}
                      trackerId={trackerId}
                      record={record}
                      rowIndex={rowIndex}
                      selected={selectedId === record.id}
                      columns={columns}
                      columnWidths={columnWidths}
                      reorderEnabled={sort === 'manual'}
                      editingColumn={editing?.row === rowIndex ? editing.column : undefined}
                      editSeed={editing?.row === rowIndex ? editSeed : undefined}
                      onSelect={() => onSelect(record)}
                      onStartEdit={(column, seed) => startEdit({ row: rowIndex, column }, seed)}
                      onCancelEdit={endEdit}
                      onCommitTitle={commitTitle}
                      onCommitCell={commitCell}
                    />
                  ))}
                {!loading && error && (
                  <tr>
                    <td colSpan={columnCount} className={styles.queryStateCell}>
                      <div role="alert">
                        <span>Rows could not be loaded.</span>
                        <button type="button" onClick={onRetry}>
                          Retry
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </SortableContext>
          </table>
        </DndContext>
        {loading && (
          <SkeletonGroup label="Loading records" className={styles.loadingAnnouncement}>
            <span />
          </SkeletonGroup>
        )}
        {!loading && !error && !records.length && (
          <div className={styles.emptyState}>No records match this view.</div>
        )}
      </div>
      {!loading && !error && hasMore && (
        <button type="button" className={styles.loadMore} disabled={loadingMore} onClick={onLoadMore}>
          {loadingMore ? 'Loading more…' : 'Load more records'}
        </button>
      )}
    </div>
  );
}

import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
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
import { PencilSimpleIcon } from '@phosphor-icons/react/dist/csr/PencilSimple';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import { ConfirmationDialog } from '../../components/ConfirmationDialog';
import dropdownStyles from '../../components/DropdownMenu.module.css';
import { Skeleton, SkeletonGroup } from '../../components/Skeleton';
import { Tooltip } from '../../components/Tooltip';
import { displayFieldValue } from './item-panel-utils';
import { ItemEditorModal, type ItemEditorInput } from './ItemEditorModal';
import type { EntityTableColumn } from './entity-table-model';
import type { EditorState } from './use-entity-table-operations';
import type { BreakdownItem, EntityType } from './types';
import styles from './Panels.module.css';

const COUNT_COLUMN_WIDTH = 48;

export type EntityTableMenu = { x: number; y: number; item: BreakdownItem };

interface SortableRowProps {
  item: BreakdownItem;
  selected: boolean;
  columns: EntityTableColumn[];
  onSelect: () => void;
  onEdit: () => void;
  onContextMenu: (event: MouseEvent) => void;
  reorderEnabled: boolean;
}

function SortableRow({
  item,
  selected,
  columns,
  onSelect,
  onEdit,
  onContextMenu,
  reorderEnabled,
}: SortableRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, disabled: !reorderEnabled });
  const style = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
    position: 'relative',
    zIndex: isDragging ? 3 : undefined,
  } as CSSProperties;
  return (
    <tr
      ref={setNodeRef}
      style={style}
      tabIndex={0}
      className={`${selected ? styles.selectedRow : ''} ${isDragging ? styles.draggingRow : ''}`}
      onDoubleClick={onEdit}
      onKeyDown={(event: KeyboardEvent<HTMLTableRowElement>) => {
        if (event.key === 'Enter') onEdit();
      }}
      onClick={onSelect}
      onContextMenu={onContextMenu}
    >
      <td className={styles.handleCell}>
        <Tooltip
          className={styles.dragTooltip}
          content={
            reorderEnabled
              ? 'Drag this row to change its saved manual order'
              : 'Choose manual sorting before reordering saved items'
          }
        >
          <button
            ref={setActivatorNodeRef}
            className={styles.dragHandle}
            type="button"
            aria-label={`Reorder ${item.title}`}
            disabled={!reorderEnabled}
            {...attributes}
            {...listeners}
          >
            <DotsSixIcon size={12} weight="bold" />
          </button>
        </Tooltip>
      </td>
      {columns.map((column) => {
        const value =
          column.key === 'code'
            ? (item.displayCode ?? '—')
            : column.key === 'title'
              ? item.title
              : column.key === 'children'
                ? String(item._count?.children ?? 0)
                : displayFieldValue(
                    item.values.find((entry) => entry.fieldId === column.field?.id),
                  ) || '—';
        return (
          <td
            key={column.key}
            className={
              column.key === 'code'
                ? styles.code
                : column.key === 'children'
                  ? styles.countValue
                  : styles.primaryValue
            }
          >
            <Tooltip content={`Full cell value: ${value}`} className={styles.cellTooltip}>
              <span className={styles.cellTooltipText}>{value}</span>
            </Tooltip>
          </td>
        );
      })}
    </tr>
  );
}

export function EntityTableGrid({
  type,
  isDeepest,
  orderingScope,
  columns,
  columnWidths,
  items,
  selectedId,
  parentId,
  sort,
  loading,
  error,
  onResize,
  onReorder,
  onRetry,
  onEdit,
  onSelect,
  onOpenMenu,
}: {
  type: EntityType;
  isDeepest: boolean;
  orderingScope: string;
  columns: EntityTableColumn[];
  columnWidths: Record<string, number>;
  items: BreakdownItem[];
  selectedId?: string;
  parentId?: string;
  sort: string;
  loading: boolean;
  error: Error | null;
  onResize: (event: ReactPointerEvent<HTMLButtonElement>, key: string) => void;
  onReorder: (event: DragEndEvent) => void;
  onRetry: () => void;
  onEdit: (item: BreakdownItem) => void;
  onSelect: (item: BreakdownItem) => void;
  onOpenMenu: (event: MouseEvent, item: BreakdownItem) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const columnCount = columns.length + 1;

  return (
    <div className={styles.tableScroll}>
      <DndContext
        key={orderingScope}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onReorder}
      >
        <table
          className={`${styles.table} ${isDeepest ? styles.deepestTable : styles.branchTable}`}
        >
          <colgroup>
            <col style={{ width: 36 }} />
            {columns.map((column) => (
              <col
                key={column.key}
                style={{
                  width:
                    columnWidths[column.key] ??
                    (column.key === 'code'
                      ? 94
                      : column.key === 'children'
                        ? COUNT_COLUMN_WIDTH
                        : 180),
                }}
              />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className={styles.handleCell} aria-label="Reorder" />
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={column.key === 'children' ? styles.countCell : undefined}
                >
                  <span className={styles.columnLabel}>
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
            items={items.map((item) => item.id)}
            strategy={verticalListSortingStrategy}
          >
            <tbody>
              {loading &&
                Array.from({ length: 8 }, (_, rowIndex) => (
                  <tr key={`loading-${rowIndex}`} className={styles.skeletonTableRow}>
                    <td className={styles.handleCell}>
                      <Skeleton width={12} height={12} />
                    </td>
                    {columns.map((column, columnIndex) => (
                      <td key={column.key}>
                        <Skeleton
                          width={columnIndex === 0 ? '62%' : rowIndex % 3 === 0 ? '88%' : '72%'}
                          height={9}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              {!loading &&
                !error &&
                items.map((item) => (
                  <SortableRow
                    key={item.id}
                    item={item}
                    selected={selectedId === item.id}
                    columns={columns}
                    reorderEnabled={sort === 'manual' && (type.level === 1 || Boolean(parentId))}
                    onEdit={() => onEdit(item)}
                    onSelect={() => onSelect(item)}
                    onContextMenu={(event) => onOpenMenu(event, item)}
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
        <SkeletonGroup
          label={`Loading ${type.pluralName}`}
          className={styles.tableLoadingAnnouncement}
        >
          <span />
        </SkeletonGroup>
      )}
      {!loading && !error && !items.length && (
        <div className={styles.empty}>No {type.pluralName.toLowerCase()} yet.</div>
      )}
    </div>
  );
}

export function EntityTableContextMenu({
  menu,
  menuRef,
  singularName,
  onAdd,
  onEdit,
  onDelete,
}: {
  menu?: EntityTableMenu;
  menuRef: RefObject<HTMLDivElement | null>;
  singularName: string;
  onAdd: () => void;
  onEdit: (item: BreakdownItem) => void;
  onDelete: (item: BreakdownItem) => void;
}) {
  if (!menu) return null;
  return createPortal(
    <div
      ref={menuRef}
      className={`${dropdownStyles.popup} ${dropdownStyles.portalled} ${styles.contextMenu}`}
      style={{
        left: Math.min(menu.x, window.innerWidth - 190),
        top: Math.min(menu.y, window.innerHeight - 124),
      }}
      role="menu"
    >
      <button role="menuitem" className={dropdownStyles.item} onClick={onAdd}>
        <span className={styles.contextMenuItemContent}>
          <PlusIcon size={12} /> <span>Add {singularName}…</span>
        </span>
      </button>
      <span role="separator" className={dropdownStyles.separator} />
      <button role="menuitem" className={dropdownStyles.item} onClick={() => onEdit(menu.item)}>
        <span className={styles.contextMenuItemContent}>
          <PencilSimpleIcon size={12} /> <span>Edit…</span>
        </span>
      </button>
      <span role="separator" className={dropdownStyles.separator} />
      <button role="menuitem" className={dropdownStyles.item} onClick={() => onDelete(menu.item)}>
        <span className={styles.contextMenuItemContent}>
          <TrashIcon size={12} /> <span>Move to trash</span>
        </span>
      </button>
    </div>,
    document.body,
  );
}

export function EntityTableDialogs({
  type,
  parentType,
  parents,
  defaultParentId,
  editor,
  editorBusy,
  editorError,
  deleteConfirmation,
  deleteBusy,
  deleteError,
  onCloseEditor,
  onSaveEditor,
  onCancelDelete,
  onConfirmDelete,
}: {
  type: EntityType;
  parentType?: EntityType;
  parents: BreakdownItem[];
  defaultParentId: string | null | undefined;
  editor?: EditorState;
  editorBusy: boolean;
  editorError?: string;
  deleteConfirmation?: BreakdownItem;
  deleteBusy: boolean;
  deleteError?: string;
  onCloseEditor: () => void;
  onSaveEditor: (values: ItemEditorInput) => void;
  onCancelDelete: () => void;
  onConfirmDelete: (item: BreakdownItem) => void;
}) {
  return (
    <>
      {editor && (
        <ItemEditorModal
          entityType={type}
          item={editor.mode === 'edit' ? editor.item : undefined}
          parentType={parentType}
          parents={parents}
          defaultParentId={defaultParentId}
          busy={editorBusy}
          error={editorError}
          onClose={onCloseEditor}
          onSubmit={onSaveEditor}
        />
      )}
      {deleteConfirmation && (
        <ConfirmationDialog
          title={`Move ${type.singularName.toLowerCase()} to trash?`}
          description={
            <>
              “{deleteConfirmation.title}” and any descendants will move to project trash. You can
              restore the deletion batch later.
            </>
          }
          confirmLabel="Move to trash"
          busyLabel="Moving…"
          busy={deleteBusy}
          error={deleteError}
          onCancel={onCancelDelete}
          onConfirm={() => onConfirmDelete(deleteConfirmation)}
        />
      )}
    </>
  );
}

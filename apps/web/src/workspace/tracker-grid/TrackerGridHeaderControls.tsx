import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { ColumnsIcon } from '@phosphor-icons/react/dist/csr/Columns';
import { DotsSixIcon } from '@phosphor-icons/react/dist/csr/DotsSix';
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlass';
import type { TrackerField } from '../../trackers/types';
import { Tooltip } from '../../components/Tooltip';
import dropdownStyles from '../../components/DropdownMenu.module.css';
import type { GridPanel } from '../tracker-model';
import styles from './TrackerGrid.module.css';

/**
 * Grid panel header tools: debounced title search plus a Columns menu where core columns toggle
 * and field columns toggle visibility and drag-reorder — all persisted in the panel config
 * (`hiddenColumns`, `visibleCustomFieldIds` as the explicit ordered selection).
 */
export function TrackerGridHeaderControls({
  panel,
  fields,
  onPanelChange,
}: {
  panel: GridPanel;
  fields: TrackerField[];
  onPanelChange: (panel: GridPanel) => void;
}) {
  const [search, setSearch] = useState(panel.config.search);
  const [searchOpen, setSearchOpen] = useState(Boolean(panel.config.search));
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setSearch(panel.config.search), [panel.config.search]);
  useEffect(() => {
    if (search === panel.config.search) return;
    const timer = window.setTimeout(
      () => onPanelChange({ ...panel, config: { ...panel.config, search } }),
      250,
    );
    return () => window.clearTimeout(timer);
  }, [onPanelChange, panel, search]);

  return (
    <div className={styles.headerTools}>
      {searchOpen ? (
        <label className={styles.searchField}>
          <MagnifyingGlassIcon size={12} aria-hidden="true" />
          <input
            ref={searchInputRef}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onBlur={() => {
              if (!search) setSearchOpen(false);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              event.preventDefault();
              setSearch('');
              setSearchOpen(false);
            }}
            placeholder="Search"
            aria-label="Search records by title"
          />
        </label>
      ) : (
        <Tooltip content="Search records by title">
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Search records"
            onClick={() => {
              setSearchOpen(true);
              requestAnimationFrame(() => searchInputRef.current?.focus());
            }}
          >
            <MagnifyingGlassIcon size={12} aria-hidden="true" />
          </button>
        </Tooltip>
      )}
      <ColumnsMenu panel={panel} fields={fields} onPanelChange={onPanelChange} />
    </div>
  );
}

function ColumnsMenu({
  panel,
  fields,
  onPanelChange,
}: {
  panel: GridPanel;
  fields: TrackerField[];
  onPanelChange: (panel: GridPanel) => void;
}) {
  const [position, setPosition] = useState<{ x: number; y: number }>();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 3 } }));

  useEffect(() => {
    if (!position) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('[data-columns-popup]')) return;
      setPosition(undefined);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [position]);

  const toggle = () => {
    if (position) {
      setPosition(undefined);
      return;
    }
    const bounds = triggerRef.current?.getBoundingClientRect();
    if (!bounds) return;
    setPosition({ x: bounds.left, y: bounds.bottom + 2 });
  };

  const hidden = new Set(panel.config.hiddenColumns);
  const toggleHidden = (key: string) => {
    const hiddenColumns = hidden.has(key)
      ? panel.config.hiddenColumns.filter((entry) => entry !== key)
      : [...panel.config.hiddenColumns, key];
    onPanelChange({ ...panel, config: { ...panel.config, hiddenColumns } });
  };
  // Empty order means "natural field order"; materialize it once the user reorders.
  const orderedIds = panel.config.visibleCustomFieldIds.length
    ? panel.config.visibleCustomFieldIds.filter((id) => fields.some((field) => field.id === id))
    : fields.map((field) => field.id);
  const setOrderedIds = (ids: string[]) =>
    onPanelChange({ ...panel, config: { ...panel.config, visibleCustomFieldIds: ids } });

  const reorder = (event: DragEndEvent) => {
    const overId = event.over?.id;
    if (!overId || event.active.id === overId) return;
    const next = [...orderedIds];
    next.splice(next.indexOf(String(event.active.id)), 1);
    next.splice(next.indexOf(String(overId)), 0, String(event.active.id));
    setOrderedIds(next);
  };

  return (
    <>
      <Tooltip content="Show, hide, and reorder columns">
        <button
          ref={triggerRef}
          type="button"
          className={styles.iconButton}
          aria-label="Columns"
          aria-haspopup="menu"
          aria-expanded={Boolean(position)}
          onClick={toggle}
        >
          <ColumnsIcon size={12} aria-hidden="true" />
        </button>
      </Tooltip>
      {position &&
        createPortal(
          <div
            data-columns-popup=""
            role="menu"
            aria-label="Grid columns"
            className={`${dropdownStyles.popup} ${dropdownStyles.portalled} ${styles.columnsPopup}`}
            style={{ left: position.x, top: position.y }}
          >
            {['title', 'updated'].map((key) => (
              <button
                key={key}
                type="button"
                role="menuitemcheckbox"
                aria-checked={!hidden.has(key)}
                className={`${dropdownStyles.item} ${styles.columnToggle}`}
                onClick={() => toggleHidden(key)}
              >
                <span className={styles.columnCheck}>{hidden.has(key) ? '' : '✓'}</span>
                <span>{key.toUpperCase()}</span>
              </button>
            ))}
            {fields.length > 0 && <span role="separator" className={dropdownStyles.separator} />}
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={reorder}>
              <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
                {orderedIds.map((fieldId) => (
                  <SortableColumnRow
                    key={fieldId}
                    fieldId={fieldId}
                    label={fields.find((field) => field.id === fieldId)?.name ?? fieldId}
                    visible={!hidden.has(`field:${fieldId}`)}
                    onToggleVisible={() => toggleHidden(`field:${fieldId}`)}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </div>,
          document.body,
        )}
    </>
  );
}

function SortableColumnRow({
  fieldId,
  label,
  visible,
  onToggleVisible,
}: {
  fieldId: string;
  label: string;
  visible: boolean;
  onToggleVisible: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({
    id: fieldId,
  });
  return (
    <div
      ref={setNodeRef}
      className={styles.columnRow}
      style={{
        transform: transform ? `translate3d(0, ${transform.y}px, 0)` : undefined,
        zIndex: isDragging ? 3 : undefined,
        position: 'relative',
      }}
    >
      <button
        type="button"
        className={`${styles.dragHandle} ${styles.columnDragHandle}`}
        aria-label={`Reorder ${label}`}
        {...attributes}
        {...listeners}
      >
        <DotsSixIcon size={10} weight="bold" />
      </button>
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={visible}
        className={`${dropdownStyles.item} ${styles.columnToggle}`}
        onClick={onToggleVisible}
      >
        <span className={styles.columnCheck}>{visible ? '✓' : ''}</span>
        <span>{label}</span>
      </button>
    </div>
  );
}

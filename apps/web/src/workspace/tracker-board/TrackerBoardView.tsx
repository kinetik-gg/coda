import { type CSSProperties } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { CaretDownIcon } from '@phosphor-icons/react/dist/csr/CaretDown';
import { DotsSixIcon } from '@phosphor-icons/react/dist/csr/DotsSix';
import { Skeleton } from '../../components/Skeleton';
import type { TrackerFieldOption, TrackerRecord } from '../../trackers/types';
import { PanelCommandMenu, type PanelCommandItem } from '../PanelCommandMenu';
import { mediaKindOfField, storageObjectIdOf } from '../tracker-media/tracker-media-model';
import { TrackerMediaIndicator } from '../tracker-media/TrackerMediaReadonly';
import { boardCardText, laneOfRecord, type BoardLane } from './board-model';
import { isMediaField, type TrackerGridColumn } from '../tracker-model';
import styles from './TrackerBoard.module.css';

function dragStyle(transform: { x: number; y: number } | null, dragging: boolean): CSSProperties {
  return {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    zIndex: dragging ? 3 : undefined,
    position: 'relative',
  };
}

function LaneHeader({ lane, onToggle }: { lane: BoardLane; onToggle: (key: string) => void }) {
  return (
    <header className={styles.laneHeader}>
      <button
        type="button"
        className={styles.laneCollapse}
        aria-label={`${lane.collapsed ? 'Expand' : 'Collapse'} ${lane.label}`}
        aria-expanded={!lane.collapsed}
        onClick={() => onToggle(lane.key)}
      >
        <CaretDownIcon
          size={10}
          weight="bold"
          aria-hidden="true"
          style={lane.collapsed ? { transform: 'rotate(-90deg)' } : undefined}
        />
      </button>
      <span
        className={styles.laneSwatch}
        style={lane.option?.color ? { background: lane.option.color } : undefined}
        aria-hidden="true"
      />
      <span className={styles.laneTitle}>{lane.label}</span>
      <span className={styles.laneCount}>{lane.records.length}</span>
    </header>
  );
}

/** Every other lane becomes an explicit keyboard-reachable move destination for one card. */
function moveTargets(
  lanes: BoardLane[],
  record: TrackerRecord,
  onMove: (record: TrackerRecord, option: TrackerFieldOption | null) => void,
): PanelCommandItem[] {
  return lanes
    .filter((lane) => !lane.records.some((entry) => entry.id === record.id))
    .map((lane) => ({ label: `Move to ${lane.label}`, action: () => onMove(record, lane.option) }));
}

function BoardCard({
  lanes,
  record,
  cardColumns,
  canEdit,
  selected,
  onSelect,
  onMove,
}: {
  lanes: BoardLane[];
  record: TrackerRecord;
  cardColumns: TrackerGridColumn[];
  canEdit: boolean;
  selected: boolean;
  onSelect: (record: TrackerRecord) => void;
  onMove: (record: TrackerRecord, option: TrackerFieldOption | null) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: record.id,
    disabled: !canEdit,
  });
  return (
    <li
      ref={setNodeRef}
      className={`${styles.card} ${selected ? styles.cardSelected : ''} ${isDragging ? styles.cardDragging : ''}`}
      style={dragStyle(transform, isDragging)}
    >
      <button
        type="button"
        className={styles.cardDragHandle}
        aria-label={`Drag ${record.title}`}
        disabled={!canEdit}
        {...attributes}
        {...listeners}
      >
        <DotsSixIcon size={12} weight="bold" aria-hidden="true" />
      </button>
      <button type="button" className={styles.cardMain} onClick={() => onSelect(record)}>
        <span className={styles.cardTitle}>{record.title}</span>
        {cardColumns.map((column) => (
          <span key={column.key} className={styles.cardSecondary}>
            {column.field && isMediaField(column.field) ? (
              <TrackerMediaIndicator
                kind={mediaKindOfField(column.field)}
                objectId={storageObjectIdOf(record, column.field.id)}
              />
            ) : (
              boardCardText(record, column) || '—'
            )}
          </span>
        ))}
      </button>
      {canEdit && (
        <PanelCommandMenu
          label={`Move ${record.title}`}
          triggerClassName={styles.cardMenuTrigger}
          triggerContent={<span aria-hidden="true">⋯</span>}
          popupClassName={styles.movePopup}
          items={moveTargets(lanes, record, onMove)}
        />
      )}
    </li>
  );
}

function LaneBody({
  lanes,
  lane,
  cardColumns,
  canEdit,
  selectedId,
  onSelect,
  onMove,
}: {
  lanes: BoardLane[];
  lane: BoardLane;
  cardColumns: TrackerGridColumn[];
  canEdit: boolean;
  selectedId?: string;
  onSelect: (record: TrackerRecord) => void;
  onMove: (record: TrackerRecord, option: TrackerFieldOption | null) => void;
}) {
  if (lane.collapsed) return null;
  return (
    <div className={styles.laneBody}>
      {lane.records.length === 0 && canEdit && (
        <p className={styles.laneEmptyHint}>Drop cards here</p>
      )}
      {lane.records.map((record) => (
        <BoardCard
          key={record.id}
          lanes={lanes}
          record={record}
          cardColumns={cardColumns}
          canEdit={canEdit}
          selected={selectedId === record.id}
          onSelect={onSelect}
          onMove={onMove}
        />
      ))}
    </div>
  );
}

function Lane({
  lanes,
  lane,
  cardColumns,
  canEdit,
  selectedId,
  onSelect,
  onMove,
  onToggleLane,
}: {
  lanes: BoardLane[];
  lane: BoardLane;
  cardColumns: TrackerGridColumn[];
  canEdit: boolean;
  selectedId?: string;
  onSelect: (record: TrackerRecord) => void;
  onMove: (record: TrackerRecord, option: TrackerFieldOption | null) => void;
  onToggleLane: (key: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: lane.key, disabled: !canEdit });
  return (
    <section
      ref={setNodeRef}
      className={`${styles.lane} ${isOver ? styles.laneOver : ''}`}
      aria-label={`${lane.label} lane`}
      aria-disabled={!canEdit}
    >
      <LaneHeader lane={lane} onToggle={onToggleLane} />
      <LaneBody
        lanes={lanes}
        lane={lane}
        cardColumns={cardColumns}
        canEdit={canEdit}
        selectedId={selectedId}
        onSelect={onSelect}
        onMove={onMove}
      />
    </section>
  );
}

/**
 * The tracker kanban surface: horizontally scrolling sticky-headed lanes, pointer drag between
 * lanes (cards are dnd-kit draggables, lanes are drop targets), and a per-card move menu so
 * keyboard users get the same PATCH path without dragging.
 */
export function TrackerBoardView({
  lanes,
  cardColumns,
  loading,
  error,
  hasMore,
  loadingMore,
  canEdit,
  selectedId,
  onSelect,
  onMove,
  onToggleLane,
  onLoadMore,
  onRetry,
}: {
  lanes: BoardLane[];
  cardColumns: TrackerGridColumn[];
  loading: boolean;
  error: Error | null;
  hasMore: boolean;
  loadingMore: boolean;
  canEdit: boolean;
  selectedId?: string;
  onSelect: (record: TrackerRecord) => void;
  onMove: (record: TrackerRecord, option: TrackerFieldOption | null) => void;
  onToggleLane: (key: string) => void;
  onLoadMore: () => void;
  onRetry: () => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const resolveDragEnd = (event: DragEndEvent) => {
    if (!event.over) return;
    const lane = lanes.find((entry) => entry.key === String(event.over!.id));
    const record = lanes
      .flatMap((entry) => entry.records)
      .find((entry) => entry.id === String(event.active.id));
    if (!lane || !record) return;
    if (laneOfRecord(lanes, record)?.key === lane.key) return;
    onMove(record, lane.option);
  };
  if (error) {
    return (
      <div className={styles.queryState} role="alert">
        <span>Cards could not be loaded.</span>
        <button type="button" onClick={onRetry}>
          Retry
        </button>
      </div>
    );
  }
  return (
    <>
      <div className={styles.boardScroll}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={resolveDragEnd}>
          <div className={styles.boardRow}>
            {loading &&
              [0, 1, 2].map((index) => (
                <section key={index} className={styles.lane} aria-hidden="true">
                  <header className={styles.laneHeader}>
                    <Skeleton width="55%" height={9} />
                  </header>
                  <div className={styles.laneBody}>
                    {[0, 1, 2].map((cardIndex) => (
                      <div key={cardIndex} className={styles.skeletonCard}>
                        <Skeleton width="78%" height={9} />
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            {!loading &&
              lanes.map((lane) => (
                <Lane
                  key={lane.key}
                  lanes={lanes}
                  lane={lane}
                  cardColumns={cardColumns}
                  canEdit={canEdit}
                  selectedId={selectedId}
                  onSelect={onSelect}
                  onMove={onMove}
                  onToggleLane={onToggleLane}
                />
              ))}
          </div>
        </DndContext>
      </div>
      {!loading && !error && hasMore && (
        <button
          type="button"
          className={styles.loadMore}
          disabled={loadingMore}
          onClick={onLoadMore}
        >
          {loadingMore ? 'Loading more…' : 'Load more records'}
        </button>
      )}
    </>
  );
}

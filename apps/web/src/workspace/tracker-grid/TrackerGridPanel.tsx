import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { listTrackerFields, listTrackerRecords } from '../../api';
import { useRegisterPanelActions } from '../shell/panel-actions';
import { headerMinimumColumnWidth, resizedColumnWidth } from '../panels/entity-table-sizing';
import {
  gridViewColumns,
  RECORD_PAGE_SIZE,
  recordsQueryString,
  sortParam,
  type GridPanel,
} from '../tracker-model';
import { TrackerGridFilters } from './TrackerGridFilters';
import { TrackerGridView } from './TrackerGridView';
import { useTrackerRecordOperations } from '../panels/use-tracker-record-operations';
import type { ApiFieldValue } from '../panels/item-panel-utils';
import type { TrackerField, TrackerRecord } from '../../trackers/types';
import styles from './TrackerGrid.module.css';

function recordsKey(panel: GridPanel): string {
  return recordsQueryString(panel.config);
}

/** Column resize drag persisted into the panel config on release (breakdown table behavior). */
function startColumnResize(
  event: ReactPointerEvent<HTMLButtonElement>,
  key: string,
  panel: GridPanel,
  onPanelChange: (panel: GridPanel) => void,
  setLiveWidths: Dispatch<SetStateAction<Record<string, number>>>,
): void {
  event.preventDefault();
  event.stopPropagation();
  const start = event.clientX;
  const initial = panel.config.columnWidths[key] ?? (key === 'title' ? 260 : 160);
  const header = event.currentTarget.closest('th');
  const label = header?.querySelector<HTMLElement>('[data-column-label]');
  const minimum = Math.max(
    48,
    headerMinimumColumnWidth(
      label?.getBoundingClientRect().width ?? 0,
      Number.parseFloat(header?.getAttribute('data-pad-left') ?? '0'),
      Number.parseFloat(header?.getAttribute('data-pad-right') ?? '0'),
    ),
  );
  let next = initial;
  const move = (pointer: PointerEvent) => {
    next = resizedColumnWidth(initial + pointer.clientX - start, minimum);
    setLiveWidths((current) => ({ ...current, [key]: next }));
  };
  const end = () => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', end);
    onPanelChange({
      ...panel,
      config: { ...panel.config, columnWidths: { ...panel.config.columnWidths, [key]: next } },
    });
  };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', end, { once: true });
}

/**
 * The tracker record-grid panel (#379): cursor-paged records with debounced search, typed
 * filter chips, persisted column show/hide/reorder/resize, manual-rank dnd reorder, and the
 * per-type cell editors feeding undo-aware mutations.
 */
export function TrackerGridPanel({
  trackerId,
  panel,
  canEdit,
  selectedRecord,
  onSelectRecord,
  onPanelChange,
  onItemOperation,
  onOperationError,
}: {
  trackerId: string;
  panel: GridPanel;
  canEdit: boolean;
  selectedRecord?: TrackerRecord;
  onSelectRecord: (record: TrackerRecord | undefined) => void;
  onPanelChange: (panel: GridPanel) => void;
  onItemOperation?: (operation: {
    label: string;
    undo: () => Promise<void>;
    redo: () => Promise<void>;
  }) => void;
  onOperationError: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const [liveWidths, setLiveWidths] = useState<Record<string, number>>(panel.config.columnWidths);
  useEffect(() => setLiveWidths(panel.config.columnWidths), [panel.config.columnWidths]);

  const fields = useQuery({
    queryKey: ['tracker-fields', trackerId],
    queryFn: ({ signal }) => listTrackerFields(trackerId, signal),
  }).data;
  const activeFields: TrackerField[] = useMemo(() => fields ?? [], [fields]);

  const params = useMemo(() => recordsKey(panel), [panel]);
  const records = useInfiniteQuery({
    queryKey: ['tracker-records', trackerId, params],
    queryFn: ({ signal, pageParam }) =>
      listTrackerRecords(
        trackerId,
        {
          cursor: pageParam || undefined,
          limit: RECORD_PAGE_SIZE,
          sort: sortParam(panel.config.sort),
          direction: panel.config.direction,
          search: panel.config.search || undefined,
          filters: panel.config.filters,
        },
        signal,
      ),
    initialPageParam: '',
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 5_000,
  });
  const loadedRecords = useMemo(
    () => records.data?.pages.flatMap((page) => page.items) ?? [],
    [records.data],
  );
  const [orderedRecords, setOrderedRecords] = useState<TrackerRecord[]>();
  useEffect(() => setOrderedRecords(undefined), [loadedRecords]);
  const visibleRecords = orderedRecords ?? loadedRecords;

  const invalidate = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['tracker-records', trackerId] });
  }, [queryClient, trackerId]);

  const operations = useTrackerRecordOperations({
    trackerId,
    canEdit,
    panelSort: panel.config.sort,
    visibleRecords,
    setOrderedItems: setOrderedRecords,
    invalidate,
    refreshSelected: onSelectRecord,
    onSelectRecord,
    onItemOperation,
    onRefetch: () => void records.refetch(),
  });

  useEffect(() => {
    if (!operations.error) return;
    onOperationError(operations.error);
    operations.setError(undefined);
  }, [operations, operations.error, onOperationError]);

  useRegisterPanelActions(panel.id, (action) => {
    if (action === 'refresh') void records.refetch();
    if (action === 'add-record' && canEdit) void operations.createRecord('New record');
    if (action === 'delete-selected' && selectedRecord && canEdit)
      void operations.deleteRecords([selectedRecord]);
  });

  const resize = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, key: string) =>
      startColumnResize(event, key, panel, onPanelChange, setLiveWidths),
    [onPanelChange, panel],
  );

  const commitCell = useCallback(
    (record: TrackerRecord, field: TrackerField, value: ApiFieldValue | null) =>
      operations.setCell(record, field, value),
    [operations],
  );

  return (
    <div className={styles.panelBody} aria-busy={records.isLoading}>
      <div className={styles.headerRow}>
        <span className={styles.countLabel}>
          {records.isLoading ? 'LOADING…' : `${visibleRecords.length} RECORDS`}
        </span>
      </div>
      {(activeFields.length > 0 || panel.config.filters.length > 0) && (
        <TrackerGridFilters panel={panel} fields={activeFields} onPanelChange={onPanelChange} />
      )}
      <TrackerGridView
        trackerId={trackerId}
        columns={gridViewColumns(panel, activeFields)}
        columnWidths={liveWidths}
        records={visibleRecords}
        selectedId={selectedRecord?.id}
        sort={panel.config.sort}
        loading={records.isLoading}
        error={records.error}
        hasMore={Boolean(records.hasNextPage)}
        loadingMore={records.isFetchingNextPage}
        canEdit={canEdit}
        onSelect={onSelectRecord}
        onEditTitle={(record, title) => operations.editTitle(record, title)}
        onEditCell={commitCell}
        onResize={resize}
        onReorder={(event) => {
          if (!event.over || event.active.id === event.over.id) return;
          const oldIndex = visibleRecords.findIndex((entry) => entry.id === event.active.id);
          const newIndex = visibleRecords.findIndex((entry) => entry.id === event.over!.id);
          if (oldIndex < 0 || newIndex < 0) return;
          void operations.reorderRecord(visibleRecords[oldIndex]!, newIndex);
        }}
        onLoadMore={() => void records.fetchNextPage()}
        onRetry={() => {
          void records.refetch();
          void queryClient.refetchQueries({ queryKey: ['tracker-fields', trackerId] });
        }}
      />
    </div>
  );
}

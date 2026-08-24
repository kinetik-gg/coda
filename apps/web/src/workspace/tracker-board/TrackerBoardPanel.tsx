import { useCallback, useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { listTrackerFields, listTrackerRecords } from '../../api';
import { useRegisterPanelActions } from '../shell/panel-actions';
import type { ApiFieldValue } from '../panels/item-panel-utils';
import { useTrackerRecordOperations } from '../panels/use-tracker-record-operations';
import {
  RECORD_PAGE_SIZE,
  isSingleSelectField,
  recordsQueryString,
  sortParam,
} from '../tracker-model';
import type { TrackerFieldOption, TrackerRecord } from '../../trackers/types';
import { boardCardColumns, boardLanes, type BoardPanel } from './board-model';
import { TrackerBoardView } from './TrackerBoardView';
import styles from './TrackerBoard.module.css';

/**
 * The tracker kanban panel (#380): lanes from the configured single-select group-by field plus
 * an explicit Unassigned lane, cards rendering the configured secondary fields read-only, and
 * cross-lane moves issuing the same undo-aware cell PATCH as grid editing — optimistic locally,
 * refreshed row on a version conflict. Records share the grid's react-query vocabulary, so
 * socket invalidation and row-level cache replacement re-aggregate every open view.
 */
export function TrackerBoardPanel({
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
  panel: BoardPanel;
  canEdit: boolean;
  selectedRecord?: TrackerRecord;
  onSelectRecord: (record: TrackerRecord | undefined) => void;
  onPanelChange: (panel: BoardPanel) => void;
  onItemOperation?: (operation: {
    label: string;
    undo: () => Promise<void>;
    redo: () => Promise<void>;
  }) => void;
  onOperationError: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const fields = useQuery({
    queryKey: ['tracker-fields', trackerId],
    queryFn: ({ signal }) => listTrackerFields(trackerId, signal),
  }).data;
  const activeFields = useMemo(() => fields ?? [], [fields]);
  const groupByField = useMemo(
    () =>
      activeFields.find(
        (field) => field.id === panel.config.groupByFieldId && isSingleSelectField(field),
      ),
    [activeFields, panel.config.groupByFieldId],
  );

  const params = useMemo(() => recordsQueryString(panel.config), [panel.config]);
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

  // Optimistic overlay: moved cards render in their target lane until the mutation response
  // replaces them in the shared cache; clearing snaps failed moves back without a refetch.
  const [pendingMoves, setPendingMoves] = useState<Map<string, TrackerFieldOption | null>>();
  useEffect(() => setPendingMoves(undefined), [loadedRecords]);
  const displayRecords = useMemo(
    () =>
      pendingMoves?.size
        ? loadedRecords.map((record) => {
            const option = pendingMoves.get(record.id);
            return option === undefined
              ? record
              : withEnumOption(record, groupByField?.id ?? '', option);
          })
        : loadedRecords,
    [loadedRecords, pendingMoves, groupByField],
  );
  const lanes = useMemo(
    () => boardLanes(panel.config, groupByField, displayRecords),
    [panel.config, groupByField, displayRecords],
  );
  const cardColumns = useMemo(
    () => boardCardColumns(panel.config, activeFields),
    [panel.config, activeFields],
  );

  const invalidate = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['tracker-records', trackerId] });
  }, [queryClient, trackerId]);
  const operations = useTrackerRecordOperations({
    trackerId,
    canEdit,
    panelSort: panel.config.sort,
    visibleRecords: displayRecords,
    setOrderedItems: () => {},
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

  const moveCard = useCallback(
    async (record: TrackerRecord, option: TrackerFieldOption | null) => {
      if (!canEdit || !groupByField) return;
      const next: ApiFieldValue | null = option ? { type: 'enum', optionId: option.id } : null;
      setPendingMoves((current) => new Map(current ?? []).set(record.id, option));
      try {
        await operations.setCell(record, groupByField, next);
      } catch (reason) {
        onOperationError(reason instanceof Error ? reason.message : 'The move could not be saved.');
      } finally {
        setPendingMoves((current) => {
          if (!current?.has(record.id)) return current;
          const remainder = new Map(current);
          remainder.delete(record.id);
          return remainder;
        });
      }
    },
    [canEdit, groupByField, onOperationError, operations],
  );

  const toggleLane = useCallback(
    (key: string) => {
      const collapsed = panel.config.hiddenColumns.includes(key);
      const hiddenColumns = collapsed
        ? panel.config.hiddenColumns.filter((entry) => entry !== key)
        : [...panel.config.hiddenColumns, key];
      onPanelChange({ ...panel, config: { ...panel.config, hiddenColumns } });
    },
    [onPanelChange, panel],
  );

  useRegisterPanelActions(panel.id, (action) => {
    if (action === 'refresh') void records.refetch();
  });

  if (!groupByField) {
    return (
      <div className={styles.panelBody}>
        <div className={styles.emptyState}>
          Choose a single-select field to group by in this panel&apos;s View menu.
        </div>
      </div>
    );
  }
  return (
    <div className={styles.panelBody} aria-busy={records.isLoading}>
      <div className={styles.headerRow}>
        <span className={styles.countLabel}>
          {records.isLoading ? 'LOADING…' : `${displayRecords.length} CARDS`}
        </span>
      </div>
      <TrackerBoardView
        lanes={lanes}
        cardColumns={cardColumns}
        loading={records.isLoading}
        error={records.error}
        hasMore={Boolean(records.hasNextPage)}
        loadingMore={records.isFetchingNextPage}
        canEdit={canEdit}
        selectedId={selectedRecord?.id}
        onSelect={onSelectRecord}
        onMove={(record, option) => void moveCard(record, option)}
        onToggleLane={toggleLane}
        onLoadMore={() => void records.fetchNextPage()}
        onRetry={() => {
          void records.refetch();
          void queryClient.refetchQueries({ queryKey: ['tracker-fields', trackerId] });
        }}
      />
    </div>
  );
}

/** The optimistic counterpart of an enum cell write: swap the joined option in place. */
function withEnumOption(
  record: TrackerRecord,
  fieldId: string,
  option: TrackerFieldOption | null,
): TrackerRecord {
  const values = record.values.filter((entry) => entry.fieldId !== fieldId);
  if (option)
    values.push({
      fieldId,
      textValue: null,
      integerValue: null,
      floatValue: null,
      booleanValue: null,
      dateValue: null,
      options: [],
      option,
    });
  return { ...record, values };
}

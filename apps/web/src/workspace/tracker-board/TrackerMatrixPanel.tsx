import { useMemo } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { listTrackerFields, listTrackerRecords } from '../../api';
import { useRegisterPanelActions } from '../shell/panel-actions';
import {
  RECORD_PAGE_SIZE,
  isSingleSelectField,
  recordsQueryString,
  sortParam,
} from '../tracker-model';
import type { TrackerRecord } from '../../trackers/types';
import { buildMatrix, type MatrixPanel } from './matrix-model';
import { TrackerMatrixView } from './TrackerMatrixView';
import styles from './TrackerMatrix.module.css';

/**
 * The tracker pivot panel (#380): rows and columns from two configured single-select fields,
 * every cell aggregating the records matching both options (count, capped chips, "+N more"
 * popover selecting back into the grid) and totals on both axes. Records share the grid's
 * react-query vocabulary, so socket invalidation re-aggregates without stale closures — the
 * model rebuilds from whatever pages are currently cached.
 */
export function TrackerMatrixPanel({
  trackerId,
  panel,
  onSelectRecord,
}: {
  trackerId: string;
  panel: MatrixPanel;
  onSelectRecord: (record: TrackerRecord | undefined) => void;
}) {
  const queryClient = useQueryClient();
  const fields = useQuery({
    queryKey: ['tracker-fields', trackerId],
    queryFn: ({ signal }) => listTrackerFields(trackerId, signal),
  }).data;
  const activeFields = useMemo(() => fields ?? [], [fields]);
  const rowField = useMemo(
    () =>
      activeFields.find(
        (field) => field.id === panel.config.rowFieldId && isSingleSelectField(field),
      ),
    [activeFields, panel.config.rowFieldId],
  );
  const colField = useMemo(
    () =>
      activeFields.find(
        (field) => field.id === panel.config.colFieldId && isSingleSelectField(field),
      ),
    [activeFields, panel.config.colFieldId],
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
  const model = useMemo(
    () => (rowField && colField ? buildMatrix(rowField, colField, loadedRecords) : undefined),
    [rowField, colField, loadedRecords],
  );

  useRegisterPanelActions(panel.id, (action) => {
    if (action === 'refresh') void records.refetch();
  });

  if (!rowField || !colField) {
    return (
      <div className={styles.panelBody}>
        <div className={styles.emptyState}>
          Choose single-select fields for rows and columns in this panel&apos;s View menu.
        </div>
      </div>
    );
  }
  if (!model || model.rows.length === 0 || model.cols.length === 0) {
    return (
      <div className={styles.panelBody}>
        <div className={styles.emptyState}>
          Neither axis field has options yet — add options to group by them.
        </div>
      </div>
    );
  }
  return (
    <div className={styles.panelBody} aria-busy={records.isLoading}>
      <div className={styles.headerRow}>
        <span className={styles.countLabel}>
          {records.isLoading ? 'LOADING…' : `${model.grandTotal} MATCHES`}
        </span>
      </div>
      <TrackerMatrixView
        model={model}
        axisLabel={`${rowField.name} × ${colField.name}`}
        loading={records.isLoading}
        error={records.error}
        hasMore={Boolean(records.hasNextPage)}
        loadingMore={records.isFetchingNextPage}
        onSelect={(record) => onSelectRecord(record)}
        onLoadMore={() => void records.fetchNextPage()}
        onRetry={() => {
          void records.refetch();
          void queryClient.refetchQueries({ queryKey: ['tracker-fields', trackerId] });
        }}
      />
    </div>
  );
}

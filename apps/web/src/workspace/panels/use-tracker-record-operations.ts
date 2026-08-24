import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { arrayMove } from '@dnd-kit/sortable';
import { api, ApiError, setTrackerRecordFieldValue, updateTrackerRecord } from '../../api';
import type { TrackerField, TrackerRecord } from '../../trackers/types';
import type { ItemOperation } from './types';
import { reorderGap, valueToApi, type ApiFieldValue } from './item-panel-utils';
import { replaceRecordEverywhere } from '../tracker-record-cache';
import { useTrackerRecordLifecycle } from './use-tracker-record-lifecycle';

type Invalidate = () => Promise<void>;
type RefreshSelected = (record: TrackerRecord) => void;
type SelectRecord = (record: TrackerRecord | undefined) => void;
type RegisterOperation = (operation: ItemOperation) => void;

function messageOf(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

/**
 * Undo-aware tracker record mutations (#379), mirroring the breakdown entity-table operations
 * against the tracker endpoints and feeding the workspace's shared 99-entry stack. Every inverse
 * is a real API call; edits chain optimistic versions off each response. The react-query cache is
 * updated in place per row, so open panels stay consistent without a full refetch. Row lifecycle
 * (create/delete inverses) lives in {@link useTrackerRecordLifecycle}.
 */
export function useTrackerRecordOperations({
  trackerId,
  canEdit,
  panelSort,
  visibleRecords,
  setOrderedItems,
  invalidate,
  refreshSelected,
  onSelectRecord,
  onItemOperation,
  onRefetch,
}: {
  trackerId: string;
  canEdit: boolean;
  panelSort: string;
  visibleRecords: TrackerRecord[];
  setOrderedItems: Dispatch<SetStateAction<TrackerRecord[] | undefined>>;
  invalidate: Invalidate;
  refreshSelected: RefreshSelected;
  onSelectRecord: SelectRecord;
  onItemOperation?: RegisterOperation;
  onRefetch: () => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string>();
  const lifecycle = useTrackerRecordLifecycle({
    trackerId,
    canEdit,
    visibleRecords,
    invalidate,
    onSelectRecord,
    onItemOperation,
    onRefetch,
  });

  const applyRecord = useCallback(
    (record: TrackerRecord) => {
      replaceRecordEverywhere(queryClient, trackerId, record);
      refreshSelected(record);
    },
    [queryClient, trackerId, refreshSelected],
  );

  const patchTitle = useCallback(
    async (record: TrackerRecord, title: string): Promise<TrackerRecord> => {
      try {
        const next = await updateTrackerRecord({
          trackerId,
          recordId: record.id,
          title,
          version: record.version,
        });
        applyRecord(next);
        return next;
      } catch (reason) {
        if (reason instanceof ApiError && reason.problem.status === 409) {
          const fresh = await api<TrackerRecord>(
            `/api/v1/trackers/${trackerId}/records/${record.id}`,
          );
          replaceRecordEverywhere(queryClient, trackerId, fresh);
          throw new Error('Title changed elsewhere — the row was refreshed.');
        }
        throw reason;
      }
    },
    [applyRecord, queryClient, trackerId],
  );

  /** Title edit with a real inverse pair; used by inline cell editing and the inspector. */
  const editTitle = useCallback(
    async (record: TrackerRecord, title: string) => {
      if (!canEdit) throw new Error('You do not have permission to edit records.');
      const before = record.title;
      if (before === title) return;
      let current = await patchTitle(record, title);
      onItemOperation?.({
        label: 'Rename record',
        undo: async () => {
          current = await patchTitle(current, before);
        },
        redo: async () => {
          current = await patchTitle(current, title);
        },
      });
      await invalidate();
    },
    [canEdit, invalidate, onItemOperation, patchTitle],
  );

  /**
   * One typed cell write with a real inverse pair; values are already validated API inputs.
   * A version conflict (another session edited the row) refreshes just that row from the server
   * and reports a refreshed-row message — the grid's counterpart of the layout self-heal.
   */
  const setCell = useCallback(
    async (record: TrackerRecord, field: TrackerField, after: ApiFieldValue | null) => {
      if (!canEdit) throw new Error('You do not have permission to edit records.');
      const before = valueToApi(
        field,
        record.values.find((entry) => entry.fieldId === field.id),
      );
      if (JSON.stringify(before) === JSON.stringify(after)) return;
      let current: TrackerRecord;
      try {
        current = await setTrackerRecordFieldValue({
          trackerId,
          recordId: record.id,
          fieldId: field.id,
          value: after,
          recordVersion: record.version,
        });
      } catch (reason) {
        if (reason instanceof ApiError && reason.problem.status === 409) {
          const fresh = await api<TrackerRecord>(
            `/api/v1/trackers/${trackerId}/records/${record.id}`,
          );
          replaceRecordEverywhere(queryClient, trackerId, fresh);
          throw new Error(`${field.name} changed elsewhere — the row was refreshed.`);
        }
        throw reason;
      }
      applyRecord(current);
      const write = async (value: ApiFieldValue | null) => {
        current = await setTrackerRecordFieldValue({
          trackerId,
          recordId: current.id,
          fieldId: field.id,
          value,
          recordVersion: current.version,
        });
        applyRecord(current);
      };
      onItemOperation?.({
        label: `Edit ${field.name}`,
        undo: () => write(before),
        redo: () => write(after),
      });
      await invalidate();
    },
    [applyRecord, canEdit, invalidate, onItemOperation, queryClient, trackerId],
  );

  /**
   * Manual-rank drag move with a real inverse pair, mirroring the breakdown reorder flow: the
   * rows reorder optimistically, and a failed save rolls the local order back via `onRefetch`.
   */
  const reorderRecord = useCallback(
    async (moved: TrackerRecord, targetIndex: number) => {
      if (!canEdit || panelSort !== 'manual') return;
      const oldIndex = visibleRecords.findIndex((entry) => entry.id === moved.id);
      if (oldIndex < 0 || oldIndex === targetIndex) return;
      const targetGap = reorderGap(visibleRecords, moved.id, targetIndex);
      const originalGap = reorderGap(visibleRecords, moved.id, oldIndex);
      setOrderedItems(arrayMove(visibleRecords, oldIndex, targetIndex));
      let current: TrackerRecord;
      try {
        current = await updateTrackerRecord({
          trackerId,
          recordId: moved.id,
          ...targetGap,
          version: moved.version,
        });
        applyRecord(current);
        const move = async (gap: { beforeId: string | null; afterId: string | null }) => {
          current = await updateTrackerRecord({
            trackerId,
            recordId: moved.id,
            ...gap,
            version: current.version,
          });
          applyRecord(current);
        };
        onItemOperation?.({
          label: `Reorder ${moved.title}`,
          undo: () => move(originalGap),
          redo: () => move(targetGap),
        });
        await invalidate();
      } catch (reason) {
        setError(messageOf(reason, 'The order could not be saved.'));
        onRefetch();
      }
    },
    [
      applyRecord,
      canEdit,
      invalidate,
      onItemOperation,
      onRefetch,
      panelSort,
      setOrderedItems,
      trackerId,
      visibleRecords,
    ],
  );

  return {
    error,
    setError,
    busy: lifecycle.busy,
    editTitle,
    setCell,
    createRecord: lifecycle.createRecord,
    deleteRecords: lifecycle.deleteRecords,
    reorderRecord,
  };
}

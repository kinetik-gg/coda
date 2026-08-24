import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  createTrackerRecord,
  deleteTrackerRecords,
} from '../../api';
import type { TrackerRecord } from '../../trackers/types';
import type { ItemOperation } from './types';
import { reorderGap } from './item-panel-utils';
import { removeRecordsEverywhere, replaceRecordEverywhere } from '../tracker-record-cache';

type Invalidate = () => Promise<void>;
type SelectRecord = (record: TrackerRecord | undefined) => void;
type RegisterOperation = (operation: ItemOperation) => void;

function messageOf(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

/**
 * Record create/delete with real inverse pairs (#379). Tracker records have no batch-restore
 * route, so undoing a create deletes it and redoing re-creates it at the same manual slot; the
 * closures track the live id as it changes. Deletion snapshots slot restored rows back between
 * their former neighbours, in reverse order so earlier gaps still resolve.
 */
export function useTrackerRecordLifecycle({
  trackerId,
  canEdit,
  visibleRecords,
  invalidate,
  onSelectRecord,
  onItemOperation,
  onRefetch,
}: {
  trackerId: string;
  canEdit: boolean;
  visibleRecords: TrackerRecord[];
  invalidate: Invalidate;
  onSelectRecord: SelectRecord;
  onItemOperation?: RegisterOperation;
  onRefetch: () => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  /** Creates a record slotted into the manual order; undo deletes it, redo recreates it there. */
  const createRecord = useCallback(
    async (title: string, gap?: { beforeId?: string; afterId?: string }) => {
      if (!canEdit) {
        setError('You do not have permission to edit records.');
        return;
      }
      setBusy(true);
      setError(undefined);
      try {
        const created = await createTrackerRecord({ trackerId, title, ...gap });
        replaceRecordEverywhere(queryClient, trackerId, created);
        let deletionBatch: string | undefined;
        let liveId = created.id;
        onItemOperation?.({
          label: 'Create record',
          undo: async () => {
            const result = await deleteTrackerRecords({ trackerId, ids: [liveId] });
            deletionBatch = result.deletionBatchId;
            removeRecordsEverywhere(queryClient, trackerId, result.deletedIds);
            onSelectRecord(undefined);
            await invalidate();
          },
          redo: async () => {
            if (!deletionBatch) throw new Error('The deleted record can no longer be restored.');
            const recreated = await createTrackerRecord({ trackerId, title, ...gap });
            deletionBatch = undefined;
            liveId = recreated.id;
            replaceRecordEverywhere(queryClient, trackerId, recreated);
            await invalidate();
          },
        });
        await invalidate();
      } catch (reason) {
        setError(messageOf(reason, 'The record could not be created.'));
        onRefetch();
      } finally {
        setBusy(false);
      }
    },
    [canEdit, invalidate, onSelectRecord, onItemOperation, onRefetch, queryClient, trackerId],
  );

  /** Soft-deletes records; undo re-creates them at their former neighbours, redo deletes again. */
  const deleteRecords = useCallback(
    async (records: TrackerRecord[]) => {
      if (!canEdit || !records.length || busy) return;
      setBusy(true);
      setError(undefined);
      try {
        // Snapshot each row's manual-order slot (its neighbours without itself) before deletion,
        // so undo can slot rows back exactly where they were.
        const snapshots = records.map((record) => {
          const index = visibleRecords.findIndex((entry) => entry.id === record.id);
          return {
            record,
            gap: reorderGap(visibleRecords, record.id, Math.max(0, index)),
          };
        });
        const result = await deleteTrackerRecords({
          trackerId,
          ids: snapshots.map(({ record }) => record.id),
        });
        removeRecordsEverywhere(queryClient, trackerId, result.deletedIds);
        const survivor = visibleRecords.find(
          (entry) => !snapshots.some(({ record }) => record.id === entry.id),
        );
        onSelectRecord(survivor);
        let liveIds = snapshots.map(({ record }) => record.id);
        onItemOperation?.({
          label: snapshots.length > 1 ? `Delete ${snapshots.length} records` : 'Delete record',
          undo: async () => {
            // Reverse order restores earlier rows first so their position gaps still resolve.
            const recreated: TrackerRecord[] = [];
            for (const { record, gap } of [...snapshots].reverse()) {
              recreated.unshift(
                await createTrackerRecord({
                  trackerId,
                  title: record.title,
                  ...(gap.beforeId ? { beforeId: gap.beforeId } : {}),
                  ...(gap.afterId ? { afterId: gap.afterId } : {}),
                }),
              );
            }
            liveIds = recreated.map((record) => record.id);
            await invalidate();
          },
          redo: async () => {
            const next = await deleteTrackerRecords({ trackerId, ids: liveIds });
            liveIds = next.deletedIds.length ? next.deletedIds : liveIds;
            removeRecordsEverywhere(queryClient, trackerId, next.deletedIds);
            onSelectRecord(survivor);
            await invalidate();
          },
        });
        await invalidate();
      } catch (reason) {
        setError(messageOf(reason, 'The records could not be moved to trash.'));
        onRefetch();
      } finally {
        setBusy(false);
      }
    },
    [busy, canEdit, invalidate, onSelectRecord, onItemOperation, onRefetch, queryClient, trackerId, visibleRecords],
  );

  return { error, setError, busy, createRecord, deleteRecords };
}

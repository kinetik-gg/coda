import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { WorkspacePanel } from '@coda/contracts';
import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowCounterClockwise';
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash';
import { api } from '../../api';
import { Skeleton, SkeletonGroup } from '../../components/Skeleton';
import { Tooltip } from '../../components/Tooltip';
import type { PanelContentProps } from './types';
import styles from './Panels.styles';

type Trash = Extract<WorkspacePanel, { type: 'trash' }>;
interface TrashedItem {
  id: string;
  title: string;
  displayCode?: string | null;
  deletionBatchId?: string | null;
  deletedAt: string;
  entityType?: { singularName: string };
}
interface TrashedField {
  id: string;
  name: string;
  deletedAt: string;
}
interface TrashedDocument {
  id: string;
  title: string;
  deletedAt: string;
}
interface TrashedObject {
  id: string;
  originalFilename: string;
  deletedAt: string;
}
interface TrashListing {
  items: TrashedItem[];
  fields: TrashedField[];
  sourceDocuments: TrashedDocument[];
  storageObjects: TrashedObject[];
}

export function TrashPanel({ projectId, panel }: PanelContentProps & { panel: Trash }) {
  const queryClient = useQueryClient();
  const [restoringId, setRestoringId] = useState<string>();
  const [restoreError, setRestoreError] = useState<string>();
  const listing = useQuery({
    queryKey: ['trash', projectId],
    queryFn: ({ signal }) => api<TrashListing>(`/api/v1/projects/${projectId}/trash`, { signal }),
  });
  const restore = async (
    kind: 'item' | 'field' | 'document' | 'object',
    entry: { id: string; deletionBatchId?: string | null },
  ) => {
    setRestoringId(entry.id);
    setRestoreError(undefined);
    try {
      const path =
        kind === 'item' && entry.deletionBatchId
          ? `trash/batches/${entry.deletionBatchId}/restore`
          : kind === 'field'
            ? `fields/${entry.id}/restore`
            : kind === 'document'
              ? `source-documents/${entry.id}/restore`
              : `storage-objects/${entry.id}/restore`;
      await api(`/api/v1/projects/${projectId}/${path}`, { method: 'POST' });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['trash', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['project', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['items', projectId] }),
      ]);
    } catch (error) {
      setRestoreError(error instanceof Error ? error.message : 'The entry could not be restored.');
    } finally {
      setRestoringId(undefined);
    }
  };
  const needle = panel.config.search.trim().toLowerCase();
  const groups = [
    {
      key: 'item',
      label: 'Items',
      entries: listing.data?.items ?? [],
      name: (entry: TrashedItem) =>
        `${entry.displayCode ? `${entry.displayCode} — ` : ''}${entry.title}`,
      type: (entry: TrashedItem) => entry.entityType?.singularName ?? 'Item',
    },
    {
      key: 'field',
      label: 'Fields',
      entries: listing.data?.fields ?? [],
      name: (entry: TrashedField) => entry.name,
      type: () => 'Field',
    },
    {
      key: 'document',
      label: 'Documents',
      entries: listing.data?.sourceDocuments ?? [],
      name: (entry: TrashedDocument) => entry.title,
      type: () => 'Document',
    },
    {
      key: 'object',
      label: 'Assets',
      entries: listing.data?.storageObjects ?? [],
      name: (entry: TrashedObject) => entry.originalFilename,
      type: () => 'Asset',
    },
  ] as const;
  const visibleEntryCount = groups.reduce(
    (count, group) =>
      count +
      group.entries.filter(
        (entry) =>
          !needle ||
          group
            .name(entry as never)
            .toLowerCase()
            .includes(needle),
      ).length,
    0,
  );
  return (
    <div className={styles.utilityPanel} aria-busy={listing.isLoading || Boolean(restoringId)}>
      <div className={styles.utilityList}>
        {listing.isLoading && (
          <SkeletonGroup label="Loading trash" className={styles.utilityListSkeleton}>
            {Array.from({ length: 7 }, (_, index) => (
              <div key={index}>
                <Skeleton width={12} height={12} />
                <span>
                  <Skeleton width={index % 2 ? '58%' : '76%'} height={9} />
                  <Skeleton width={126} height={8} />
                </span>
                <Skeleton width={62} height={24} radius={4} />
              </div>
            ))}
          </SkeletonGroup>
        )}
        {!listing.isLoading && listing.error && (
          <div className={styles.panelQueryState} role="alert">
            <span>Trash could not be loaded.</span>
            <button
              type="button"
              className={styles.queryStateAction}
              onClick={() => void listing.refetch()}
            >
              Retry
            </button>
          </div>
        )}
        {!listing.isLoading &&
          !listing.error &&
          groups.map((group) => {
            const entries = group.entries.filter(
              (entry) =>
                !needle ||
                group
                  .name(entry as never)
                  .toLowerCase()
                  .includes(needle),
            );
            if (!entries.length) return null;
            return (
              <section key={group.key} className={styles.trashGroup}>
                <h3>{group.label}</h3>
                {entries.map((entry) => (
                  <div key={entry.id} className={styles.trashEntry}>
                    <TrashIcon size={12} aria-hidden="true" />
                    <div>
                      <strong>{group.name(entry as never)}</strong>
                      <span>
                        {group.type(entry as never)} · {new Date(entry.deletedAt).toLocaleString()}
                      </span>
                    </div>
                    <Tooltip content="Restore this entry and its linked deleted data">
                      <button
                        type="button"
                        disabled={Boolean(restoringId)}
                        onClick={() => void restore(group.key, entry)}
                      >
                        <ArrowCounterClockwiseIcon size={12} />
                        <span>{restoringId === entry.id ? 'Restoring…' : 'Restore'}</span>
                      </button>
                    </Tooltip>
                  </div>
                ))}
              </section>
            );
          })}
        {!listing.isLoading && !listing.error && visibleEntryCount === 0 && (
          <div className={styles.empty}>
            {needle ? 'No trash matches this view.' : 'Trash is empty.'}
          </div>
        )}
      </div>
      {restoreError && (
        <button
          type="button"
          className={styles.inlineError}
          role="alert"
          onClick={() => setRestoreError(undefined)}
        >
          {restoreError}
        </button>
      )}
    </div>
  );
}

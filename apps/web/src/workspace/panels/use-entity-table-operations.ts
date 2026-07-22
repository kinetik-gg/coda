import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import type { DragEndEvent } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { api } from '../../api';
import { hydratedItem, type EntityPanel } from './entity-table-model';
import { reorderGap } from './item-panel-utils';
import type { ItemEditorInput } from './ItemEditorModal';
import type { BreakdownItem, EntityType, PanelContentProps } from './types';

export type EditorState = { mode: 'create' } | { mode: 'edit'; item: BreakdownItem };

type Invalidate = () => Promise<void>;
type RefreshSelected = (item: BreakdownItem) => void;

export function useEntityTableEditor({
  projectId,
  type,
  invalidate,
  refreshSelected,
  onSelectEntity,
  onItemOperation,
}: {
  projectId: string;
  type?: EntityType;
  invalidate: Invalidate;
  refreshSelected: RefreshSelected;
  onSelectEntity: PanelContentProps['onSelectEntity'];
  onItemOperation: PanelContentProps['onItemOperation'];
}) {
  const [editor, setEditor] = useState<EditorState>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const patchCore = useCallback(
    async (item: BreakdownItem, values: ItemEditorInput) => {
      const result = await api<BreakdownItem>(`/api/v1/projects/${projectId}/items/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...values, version: item.version }),
      });
      const hydrated = hydratedItem(result, item);
      refreshSelected(hydrated);
      await invalidate();
      return hydrated;
    },
    [invalidate, projectId, refreshSelected],
  );

  const save = async (values: ItemEditorInput) => {
    if (!type || !editor) return;
    setBusy(true);
    setError(undefined);
    try {
      if (editor.mode === 'create') {
        const createdRaw = await api<BreakdownItem>(`/api/v1/projects/${projectId}/items`, {
          method: 'POST',
          body: JSON.stringify({ entityTypeId: type.id, ...values }),
        });
        const created = hydratedItem(createdRaw);
        refreshSelected(created);
        let deletionBatch: string | undefined;
        let currentVersion = created.version;
        onItemOperation?.({
          label: `Create ${type.singularName}`,
          undo: async () => {
            const result = await api<{ batchId: string }>(
              `/api/v1/projects/${projectId}/items/${created.id}/trash`,
              { method: 'DELETE' },
            );
            deletionBatch = result.batchId;
            currentVersion += 1;
            onSelectEntity(undefined);
            await invalidate();
          },
          redo: async () => {
            if (!deletionBatch) throw new Error('The deleted item can no longer be restored.');
            await api(`/api/v1/projects/${projectId}/trash/batches/${deletionBatch}/restore`, {
              method: 'POST',
            });
            currentVersion += 1;
            refreshSelected({ ...created, version: currentVersion });
            await invalidate();
          },
        });
      } else {
        const before = editor.item;
        const beforeValues: ItemEditorInput = {
          title: before.title,
          displayCode: before.displayCode,
          description: before.description,
          parentId: before.parentId ?? null,
        };
        let current = await patchCore(before, values);
        onItemOperation?.({
          label: `Edit ${type.singularName}`,
          undo: async () => {
            current = await patchCore(current, beforeValues);
          },
          redo: async () => {
            current = await patchCore(current, values);
          },
        });
      }
      setEditor(undefined);
      await invalidate();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The item could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return { editor, setEditor, busy, error, setError, save };
}

export function useEntityTableDeletion({
  projectId,
  visibleItems,
  invalidate,
  refreshSelected,
  onSelectEntity,
  onItemOperation,
  onDeleted,
}: {
  projectId: string;
  visibleItems: BreakdownItem[];
  invalidate: Invalidate;
  refreshSelected: RefreshSelected;
  onSelectEntity: PanelContentProps['onSelectEntity'];
  onItemOperation: PanelContentProps['onItemOperation'];
  onDeleted: () => void;
}) {
  const [confirmation, setConfirmation] = useState<BreakdownItem>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const trash = async (item: BreakdownItem) => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      let result = await api<{ batchId: string }>(
        `/api/v1/projects/${projectId}/items/${item.id}/trash`,
        { method: 'DELETE' },
      );
      let restoredVersion = item.version;
      onItemOperation?.({
        label: `Move ${item.title} to trash`,
        undo: async () => {
          await api(`/api/v1/projects/${projectId}/trash/batches/${result.batchId}/restore`, {
            method: 'POST',
          });
          restoredVersion += 2;
          refreshSelected({ ...item, version: restoredVersion });
          await invalidate();
        },
        redo: async () => {
          result = await api<{ batchId: string }>(
            `/api/v1/projects/${projectId}/items/${item.id}/trash`,
            { method: 'DELETE' },
          );
          const fallback = visibleItems.find((entry) => entry.id !== item.id);
          if (fallback) refreshSelected(fallback);
          else onSelectEntity(undefined);
          await invalidate();
        },
      });
      const removedIndex = visibleItems.findIndex((entry) => entry.id === item.id);
      const nextSelection = visibleItems[removedIndex + 1] ?? visibleItems[removedIndex - 1];
      if (nextSelection) refreshSelected(nextSelection);
      else onSelectEntity(undefined);
      setConfirmation(undefined);
      onDeleted();
      await invalidate();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The item could not be moved to trash.');
    } finally {
      setBusy(false);
    }
  };

  return { confirmation, setConfirmation, busy, error, setError, trash };
}

export function useEntityTableReorder({
  projectId,
  type,
  panel,
  visibleItems,
  setOrderedItems,
  invalidate,
  refreshSelected,
  onItemOperation,
  onRefetch,
}: {
  projectId: string;
  type?: EntityType;
  panel: EntityPanel;
  visibleItems: BreakdownItem[];
  setOrderedItems: Dispatch<SetStateAction<BreakdownItem[] | undefined>>;
  invalidate: Invalidate;
  refreshSelected: RefreshSelected;
  onItemOperation: PanelContentProps['onItemOperation'];
  onRefetch: () => void;
}) {
  const [error, setError] = useState<string>();

  const reorder = async (event: DragEndEvent) => {
    if (!type || !event.over || event.active.id === event.over.id || panel.config.sort !== 'manual')
      return;
    const oldIndex = visibleItems.findIndex((item) => item.id === event.active.id);
    const newIndex = visibleItems.findIndex((item) => item.id === event.over!.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const moved = visibleItems[oldIndex]!;
    const targetGap = reorderGap(visibleItems, moved.id, newIndex);
    const originalGap = reorderGap(visibleItems, moved.id, oldIndex);
    setOrderedItems(arrayMove(visibleItems, oldIndex, newIndex));
    setError(undefined);
    try {
      let current = hydratedItem(
        await api<BreakdownItem>(`/api/v1/projects/${projectId}/items/${moved.id}/reorder`, {
          method: 'PATCH',
          body: JSON.stringify({
            ...targetGap,
            parentId: moved.parentId ?? null,
            version: moved.version,
          }),
        }),
        moved,
      );
      refreshSelected(current);
      const move = async (gap: { beforeId: string | null; afterId: string | null }) => {
        current = hydratedItem(
          await api<BreakdownItem>(`/api/v1/projects/${projectId}/items/${moved.id}/reorder`, {
            method: 'PATCH',
            body: JSON.stringify({
              ...gap,
              parentId: moved.parentId ?? null,
              version: current.version,
            }),
          }),
          current,
        );
        refreshSelected(current);
        await invalidate();
      };
      onItemOperation?.({
        label: `Reorder ${moved.title}`,
        undo: () => move(originalGap),
        redo: () => move(targetGap),
      });
      await invalidate();
    } catch (reason) {
      setOrderedItems(undefined);
      setError(reason instanceof Error ? reason.message : 'The order could not be saved.');
      onRefetch();
    }
  };

  return { error, setError, reorder };
}

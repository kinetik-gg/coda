import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { api } from '../api';
import { getApiActivitySnapshot, subscribeApiActivity } from '../api-activity';
import type { ActiveEntity, BreakdownItem, ItemOperation, Project } from './panels/types';
import { WorkspaceLoadingSkeleton } from './WorkspaceLoadingSkeleton';
import { DenseWorkspaceView } from './DenseWorkspaceView';
import { useWorkspaceCommands } from './useWorkspaceCommands';
import { useBreakdownLayoutSync, type LayoutResponse } from './useBreakdownLayoutSync';
import styles from './DenseWorkspace.module.css';
import { resolveBreakdownSaveState } from './workspace-status';

function messageOf(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

export function DenseWorkspace({
  projectId,
  currentUserId,
}: {
  projectId: string;
  currentUserId: string;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const project = useQuery({
    queryKey: ['project', projectId],
    queryFn: ({ signal }) => api<Project>(`/api/v1/projects/${projectId}`, { signal }),
  });
  const stored = useQuery({
    queryKey: ['workspace-layout', projectId],
    queryFn: ({ signal }) =>
      api<LayoutResponse>(`/api/v1/projects/${projectId}/workspace-layout`, { signal }),
  });
  const deepestType = project.data?.entityTypes.at(-1);
  const initialItems = useQuery({
    queryKey: ['workspace-initial-entity', projectId, deepestType?.id],
    queryFn: ({ signal }) =>
      api<BreakdownItem[]>(
        `/api/v1/projects/${projectId}/items?entityTypeId=${deepestType!.id}&limit=1&sort=manual&direction=asc`,
        { signal },
      ),
    enabled: Boolean(deepestType),
    staleTime: Number.POSITIVE_INFINITY,
  });

  const sync = useBreakdownLayoutSync(projectId, stored.data);
  const {
    layout,
    setLayout,
    persistState,
    operationError,
    pushToast,
    dismissToast,
    publishConflict,
    resolvePublishOverwrite,
    adoptLatestDefault,
    dismissPublishConflict,
    commit,
    updatePanel,
    reset,
    publish,
  } = sync;

  const [activeEntity, setActiveEntity] = useState<ActiveEntity>();
  const [itemHistory, setItemHistory] = useState<ItemOperation[]>([]);
  const [itemFuture, setItemFuture] = useState<ItemOperation[]>([]);
  const [itemOperationPending, setItemOperationPending] = useState(false);

  const apiActivity = useSyncExternalStore(
    subscribeApiActivity,
    getApiActivitySnapshot,
    getApiActivitySnapshot,
  );
  const saveState = resolveBreakdownSaveState({
    persistState,
    loading: apiActivity.loading,
    updating: apiActivity.updating,
  });

  useEffect(() => {
    const item = initialItems.data?.[0];
    if (!activeEntity && item && deepestType) setActiveEntity({ item, entityType: deepestType });
  }, [activeEntity, deepestType, initialItems.data]);

  useEffect(() => {
    const socket = io();
    socket.emit('join-project', projectId);
    socket.on('invalidate', (event: { resource?: string }) => {
      void queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      if (event.resource === 'workspace-default')
        void queryClient.invalidateQueries({ queryKey: ['workspace-layout', projectId] });
    });
    return () => {
      socket.disconnect();
    };
  }, [projectId, queryClient]);

  const registerItemOperation = useCallback((operation: ItemOperation) => {
    setItemHistory((entries) => [...entries.slice(-99), operation]);
    setItemFuture([]);
  }, []);
  const undoItem = async () => {
    const operation = itemHistory.at(-1);
    if (!operation || itemOperationPending) return;
    setItemOperationPending(true);
    try {
      await operation.undo();
      setItemHistory((entries) => entries.slice(0, -1));
      setItemFuture((entries) => [...entries.slice(-99), operation]);
    } catch (reason) {
      pushToast(messageOf(reason, `Could not undo ${operation.label}.`));
    } finally {
      setItemOperationPending(false);
    }
  };
  const redoItem = async () => {
    const operation = itemFuture.at(-1);
    if (!operation || itemOperationPending) return;
    setItemOperationPending(true);
    try {
      await operation.redo();
      setItemFuture((entries) => entries.slice(0, -1));
      setItemHistory((entries) => [...entries.slice(-99), operation]);
    } catch (reason) {
      pushToast(messageOf(reason, `Could not redo ${operation.label}.`));
    } finally {
      setItemOperationPending(false);
    }
  };
  useWorkspaceCommands({ setLayout, undo: undoItem, redo: redoItem, reset, publish });

  if (project.isLoading || stored.isLoading || !layout) return <WorkspaceLoadingSkeleton />;
  if (!project.data || project.error || stored.error)
    return (
      <div className={styles.loading} role="alert">
        <span>WORKSPACE COULD NOT BE OPENED</span>
        <button
          type="button"
          onClick={() => {
            void project.refetch();
            void stored.refetch();
          }}
        >
          RETRY
        </button>
      </div>
    );

  return (
    <DenseWorkspaceView
      layout={layout}
      project={project.data}
      projectId={projectId}
      currentUserId={currentUserId}
      activeEntity={activeEntity}
      setActiveEntity={setActiveEntity}
      saveState={saveState}
      operationError={operationError}
      publishConflict={publishConflict}
      queryClient={queryClient}
      onLayoutChange={commit}
      updatePanel={updatePanel}
      registerItemOperation={registerItemOperation}
      onOperationError={(error) => pushToast(error.message)}
      onDismissError={dismissToast}
      onPublishOverwrite={resolvePublishOverwrite}
      onAdoptLatest={adoptLatestDefault}
      onDismissPublishConflict={dismissPublishConflict}
    />
  );
}

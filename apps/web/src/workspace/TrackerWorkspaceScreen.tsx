import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { api, getTracker, listTrackerFields } from '../api';
import { getApiActivitySnapshot, subscribeApiActivity } from '../api-activity';
import type { TrackerCurrentUser, TrackerRecord } from '../trackers/types';
import { WorkspaceLoadingSkeleton } from './WorkspaceLoadingSkeleton';
import { resolveBreakdownSaveState } from './workspace-status';
import { useWorkspaceCommands } from './useWorkspaceCommands';
import { useTrackerLayoutSync, type LayoutResponse } from './useTrackerLayoutSync';
import { trackerCommentsQueryKey } from './tracker-grid/use-tracker-comments';
import { TrackerWorkspaceView } from './TrackerWorkspaceView';
import type { ItemOperation } from './panels/types';
import dwsStyles from './DenseWorkspace.module.css';

function messageOf(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

/**
 * The tracker workspace controller (#379): loads tracker + saved layout, joins the tracker's
 * realtime room for invalidation-driven refetches (a newly published default refetches the
 * layout), owns the shared undo/redo stack, and drives the generic panel shell through the
 * tracker panel registry — mirroring the breakdown workspace's controller shape.
 */
export function TrackerWorkspaceScreen({
  trackerId,
  currentUser,
  onBack,
}: {
  trackerId: string;
  currentUser: TrackerCurrentUser;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const tracker = useQuery({
    queryKey: ['tracker', trackerId],
    queryFn: ({ signal }) => getTracker(trackerId, signal),
  });
  const stored = useQuery({
    queryKey: ['tracker-layout', trackerId],
    queryFn: ({ signal }) =>
      api<LayoutResponse>(`/api/v1/trackers/${trackerId}/workspace-layout`, { signal }),
  });
  // Shared with the panels (same key), so the columns menu and editors read one cache entry.
  const fields = useQuery({
    queryKey: ['tracker-fields', trackerId],
    queryFn: ({ signal }) => listTrackerFields(trackerId, signal),
  });

  const sync = useTrackerLayoutSync(trackerId, stored.data);
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

  const [selectedRecord, setSelectedRecord] = useState<TrackerRecord>();
  const [history, setHistory] = useState<ItemOperation[]>([]);
  const [future, setFuture] = useState<ItemOperation[]>([]);
  const [operationPending, setOperationPending] = useState(false);

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
    const socket = io();
    socket.emit('join-tracker', trackerId);
    socket.on('invalidate', (event: { resource?: string }) => {
      void queryClient.invalidateQueries({ queryKey: ['tracker', trackerId] });
      if (event.resource === 'records')
        void queryClient.invalidateQueries({ queryKey: ['tracker-records', trackerId] });
      if (event.resource === 'fields')
        void queryClient.invalidateQueries({ queryKey: ['tracker-fields', trackerId] });
      if (event.resource === 'comments')
        void queryClient.invalidateQueries({ queryKey: trackerCommentsQueryKey(trackerId) });
      // A freshly published default must reach everyone editing against the old one.
      if (event.resource === 'workspace-default')
        void queryClient.invalidateQueries({ queryKey: ['tracker-layout', trackerId] });
    });
    return () => {
      socket.disconnect();
    };
  }, [trackerId, queryClient]);

  const registerOperation = useCallback((operation: ItemOperation) => {
    setHistory((entries) => [...entries.slice(-99), operation]);
    setFuture([]);
  }, []);
  const undo = async () => {
    const operation = history.at(-1);
    if (!operation || operationPending) return;
    setOperationPending(true);
    try {
      await operation.undo();
      setHistory((entries) => entries.slice(0, -1));
      setFuture((entries) => [...entries.slice(-99), operation]);
    } catch (reason) {
      pushToast(messageOf(reason, `Could not undo ${operation.label}.`));
    } finally {
      setOperationPending(false);
    }
  };
  const redo = async () => {
    const operation = future.at(-1);
    if (!operation || operationPending) return;
    setOperationPending(true);
    try {
      await operation.redo();
      setFuture((entries) => entries.slice(0, -1));
      setHistory((entries) => [...entries.slice(-99), operation]);
    } catch (reason) {
      pushToast(messageOf(reason, `Could not redo ${operation.label}.`));
    } finally {
      setOperationPending(false);
    }
  };
  useWorkspaceCommands({ setLayout, undo, redo, reset, publish });

  if (tracker.isLoading || stored.isLoading || !layout) return <WorkspaceLoadingSkeleton />;
  if (!tracker.data || tracker.error || stored.error)
    return (
      <div className={dwsStyles.loading} role="alert">
        <span>TRACKER COULD NOT BE OPENED</span>
        <button
          type="button"
          onClick={() => {
            void tracker.refetch();
            void stored.refetch();
          }}
        >
          RETRY
        </button>
      </div>
    );

  return (
    <TrackerWorkspaceView
      layout={layout}
      tracker={tracker.data}
      trackerId={trackerId}
      fields={fields.data ?? []}
      saveState={saveState}
      canUndo={history.length > 0}
      onUndo={() => void undo()}
      selectedRecord={selectedRecord}
      onSelectRecord={setSelectedRecord}
      currentUser={currentUser}
      operationError={operationError}
      publishConflict={publishConflict}
      canPublish={stored.data?.canPublish ?? false}
      onLayoutChange={commit}
      updatePanel={updatePanel}
      registerOperation={registerOperation}
      onOperationError={(message) => pushToast(message)}
      onDismissError={dismissToast}
      onPublishOverwrite={resolvePublishOverwrite}
      onAdoptLatest={adoptLatestDefault}
      onDismissPublishConflict={dismissPublishConflict}
      onBack={onBack}
    />
  );
}

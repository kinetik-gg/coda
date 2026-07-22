import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import {
  workspaceLayoutSchema,
  type WorkspaceLayout,
  type WorkspaceLayoutNode,
  type WorkspacePanel,
  type WorkspacePanelSlot,
} from '@coda/contracts';
import { api } from '../api';
import { getApiActivitySnapshot, subscribeApiActivity } from '../api-activity';
import type { ActiveEntity, BreakdownItem, ItemOperation, Project } from './panels/types';
import { WorkspaceLoadingSkeleton } from './WorkspaceLoadingSkeleton';
import { DenseWorkspaceView } from './DenseWorkspaceView';
import { useWorkspaceCommands } from './useWorkspaceCommands';
import styles from './DenseWorkspace.module.css';
import type { LayoutSaveState } from './workspace-status';

interface StoredLayout {
  layout: WorkspaceLayout;
  revision: number;
  basedOnDefaultRevision?: number;
}
interface LayoutResponse {
  personal: StoredLayout;
  default: StoredLayout;
  canPublish: boolean;
}

function replacePanel(
  node: WorkspaceLayoutNode,
  slotId: string,
  panel: WorkspacePanel,
): WorkspaceLayoutNode {
  if (node.kind === 'panel') return node.id === slotId ? { ...node, panel } : node;
  const first = replacePanel(node.first, slotId, panel);
  const second = replacePanel(node.second, slotId, panel);
  return first === node.first && second === node.second ? node : { ...node, first, second };
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
  const [layout, setLayout] = useState<WorkspaceLayout>();
  const [personalRevision, setPersonalRevision] = useState(0);
  const [defaultRevision, setDefaultRevision] = useState(0);
  const [activeEntity, setActiveEntity] = useState<ActiveEntity>();
  const [itemHistory, setItemHistory] = useState<ItemOperation[]>([]);
  const [itemFuture, setItemFuture] = useState<ItemOperation[]>([]);
  const [itemOperationPending, setItemOperationPending] = useState(false);
  const [saveState, setSaveState] = useState<LayoutSaveState>('saved');
  const [savedNoticeVisible, setSavedNoticeVisible] = useState(false);
  const [operationError, setOperationError] = useState<string>();
  const lastSavedHash = useRef('');
  const savedNoticeTimer = useRef<number | undefined>(undefined);
  const apiActivity = useSyncExternalStore(
    subscribeApiActivity,
    getApiActivitySnapshot,
    getApiActivitySnapshot,
  );

  const announceSaved = useCallback(() => {
    if (savedNoticeTimer.current !== undefined) window.clearTimeout(savedNoticeTimer.current);
    setSavedNoticeVisible(true);
    savedNoticeTimer.current = window.setTimeout(() => {
      setSavedNoticeVisible(false);
      savedNoticeTimer.current = undefined;
    }, 1800);
  }, []);

  useEffect(
    () => () => {
      if (savedNoticeTimer.current !== undefined) window.clearTimeout(savedNoticeTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!stored.data || layout) return;
    const next = workspaceLayoutSchema.parse(stored.data.personal.layout);
    setLayout(next);
    setPersonalRevision(stored.data.personal.revision);
    setDefaultRevision(stored.data.default.revision);
    lastSavedHash.current = JSON.stringify(next);
  }, [layout, stored.data]);

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

  useEffect(() => {
    if (!layout) return;
    const hash = JSON.stringify(layout);
    if (hash === lastSavedHash.current) return;
    setSaveState('dirty');
    const timer = window.setTimeout(() => {
      setSaveState('saving');
      void api<StoredLayout>(`/api/v1/projects/${projectId}/workspace-layout`, {
        method: 'PUT',
        body: JSON.stringify({ layout, expectedRevision: personalRevision }),
      })
        .then((saved) => {
          lastSavedHash.current = hash;
          setPersonalRevision(saved.revision);
          setSaveState('saved');
          announceSaved();
        })
        .catch((reason: unknown) => {
          setSaveState('error');
          setOperationError(
            reason instanceof Error ? reason.message : 'Workspace could not be saved.',
          );
        });
    }, 650);
    return () => window.clearTimeout(timer);
  }, [announceSaved, layout, personalRevision, projectId]);

  const commit = useCallback((next: WorkspaceLayout) => {
    setLayout(next);
  }, []);
  const updatePanel = useCallback((slot: WorkspacePanelSlot, panel: WorkspacePanel) => {
    setLayout((current) => {
      if (!current) return current;
      return workspaceLayoutSchema.parse({
        ...current,
        root: replacePanel(current.root, slot.id, panel),
      });
    });
  }, []);
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
      setOperationError(
        reason instanceof Error ? reason.message : `Could not undo ${operation.label}.`,
      );
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
      setOperationError(
        reason instanceof Error ? reason.message : `Could not redo ${operation.label}.`,
      );
    } finally {
      setItemOperationPending(false);
    }
  };
  const reset = async () => {
    const result = await api<StoredLayout>(`/api/v1/projects/${projectId}/workspace-layout/reset`, {
      method: 'POST',
      body: JSON.stringify({ expectedRevision: personalRevision }),
    });
    setLayout(result.layout);
    setPersonalRevision(result.revision);
    lastSavedHash.current = JSON.stringify(result.layout);
    setSaveState('saved');
    announceSaved();
  };
  const publish = async () => {
    if (saveState !== 'saved') {
      setOperationError('Wait for personal layout changes to finish saving before publishing.');
      return;
    }
    const result = await api<StoredLayout>(
      `/api/v1/projects/${projectId}/workspace-layout/publish`,
      { method: 'POST', body: JSON.stringify({ personalRevision, defaultRevision }) },
    );
    setDefaultRevision(result.revision);
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
      savedNoticeVisible={savedNoticeVisible}
      loading={apiActivity.loading}
      updating={apiActivity.updating}
      operationError={operationError}
      queryClient={queryClient}
      onLayoutChange={commit}
      updatePanel={updatePanel}
      registerItemOperation={registerItemOperation}
      onOperationError={(error) => setOperationError(error.message)}
      onDismissError={() => setOperationError(undefined)}
    />
  );
}

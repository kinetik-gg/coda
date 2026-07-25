import { useCallback, useEffect, useRef, useState } from 'react';
import {
  workspaceLayoutSchema,
  type WorkspaceLayout,
  type WorkspaceLayoutNode,
  type WorkspacePanel,
  type WorkspacePanelSlot,
} from '@coda/contracts';
import { api, ApiError } from '../api';
import { type LayoutPersistState, type PublishConflict } from './workspace-status';

export interface StoredLayout {
  layout: WorkspaceLayout;
  revision: number;
  basedOnDefaultRevision?: number;
}
export interface LayoutResponse {
  personal: StoredLayout;
  default: StoredLayout;
  canPublish: boolean;
}

/** A 409 from the layout endpoints is the recoverable, self-healable case; anything else is fatal. */
function isConflict(reason: unknown): boolean {
  return reason instanceof ApiError && reason.problem.status === 409;
}
function messageOf(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
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

/**
 * Owns the self-healing sync between a member's personal breakdown layout and the published
 * default (#120). All writes — the debounced save, reset, and publish — run through a single
 * in-flight queue so they can never interleave. Optimistic-concurrency 409s on save/reset rebase
 * against the latest revision and retry once silently; a 409 on publish surfaces an explicit
 * user choice rather than a raw error. Toasts are deduped so an actionable message never repeats.
 */
export function useBreakdownLayoutSync(projectId: string, stored: LayoutResponse | undefined) {
  const [layout, setLayout] = useState<WorkspaceLayout>();
  const [persistState, setPersistState] = useState<LayoutPersistState>('saved');
  const [operationError, setOperationError] = useState<string>();
  const [publishConflict, setPublishConflict] = useState<PublishConflict>();

  // Revisions and the current layout are mirrored into refs so operations that run off the
  // serialized queue always read the freshest optimistic-concurrency token — the debounced-save
  // closure that captured a stale `personalRevision` was the original source of spurious 409s.
  const lastSavedHash = useRef('');
  const layoutRef = useRef<WorkspaceLayout | undefined>(undefined);
  const personalRevisionRef = useRef(0);
  const defaultRevisionRef = useRef(0);
  const lastToastRef = useRef<string | undefined>(undefined);
  // Single in-flight lane: every save/reset/publish chains off the previous one so a debounced
  // save can never interleave with a reset or publish (or with another debounced save).
  const opQueue = useRef<Promise<unknown>>(Promise.resolve());

  const enqueue = useCallback(<T>(task: () => Promise<T>): Promise<T> => {
    const run = opQueue.current.then(task, task);
    opQueue.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }, []);

  const pushToast = useCallback((message: string) => {
    // Dedupe identical consecutive toasts: the same message stays a single toast until it is
    // dismissed or a different message supersedes it.
    if (lastToastRef.current === message) return;
    lastToastRef.current = message;
    setOperationError(message);
  }, []);
  const dismissToast = useCallback(() => {
    lastToastRef.current = undefined;
    setOperationError(undefined);
  }, []);

  const refetchLayouts = useCallback(async (): Promise<LayoutResponse> => {
    const latest = await api<LayoutResponse>(`/api/v1/projects/${projectId}/workspace-layout`);
    personalRevisionRef.current = latest.personal.revision;
    defaultRevisionRef.current = latest.default.revision;
    return latest;
  }, [projectId]);

  // Runs an optimistic write, and on a 409 refetches the latest revisions and retries exactly
  // once. A toast surfaces only when the retry also fails — the common concurrent-edit path
  // self-heals silently.
  const syncWithRetry = useCallback(
    async (
      perform: () => Promise<StoredLayout>,
      apply: (result: StoredLayout) => void,
      fallback: string,
    ): Promise<void> => {
      setPersistState('saving');
      try {
        apply(await perform());
        setPersistState('saved');
        return;
      } catch (first) {
        if (isConflict(first)) {
          try {
            await refetchLayouts();
            apply(await perform());
            setPersistState('saved');
            return;
          } catch (retry) {
            setPersistState('error');
            pushToast(messageOf(retry, fallback));
            return;
          }
        }
        setPersistState('error');
        pushToast(messageOf(first, fallback));
      }
    },
    [refetchLayouts, pushToast],
  );

  const applyStoredPersonal = useCallback((result: StoredLayout) => {
    const parsed = workspaceLayoutSchema.parse(result.layout);
    personalRevisionRef.current = result.revision;
    layoutRef.current = parsed;
    lastSavedHash.current = JSON.stringify(parsed);
    setLayout(parsed);
  }, []);

  const runSave = useCallback(
    (targetLayout: WorkspaceLayout, hash: string): Promise<void> => {
      if (hash === lastSavedHash.current) {
        setPersistState('saved');
        return Promise.resolve();
      }
      return syncWithRetry(
        () =>
          api<StoredLayout>(`/api/v1/projects/${projectId}/workspace-layout`, {
            method: 'PUT',
            body: JSON.stringify({
              layout: targetLayout,
              expectedRevision: personalRevisionRef.current,
            }),
          }),
        (saved) => {
          personalRevisionRef.current = saved.revision;
          lastSavedHash.current = hash;
        },
        'Workspace could not be saved.',
      );
    },
    [projectId, syncWithRetry],
  );

  const reset = useCallback(
    () =>
      enqueue(() =>
        syncWithRetry(
          () =>
            api<StoredLayout>(`/api/v1/projects/${projectId}/workspace-layout/reset`, {
              method: 'POST',
              body: JSON.stringify({ expectedRevision: personalRevisionRef.current }),
            }),
          applyStoredPersonal,
          'Workspace could not be reset.',
        ),
      ),
    [enqueue, projectId, syncWithRetry, applyStoredPersonal],
  );

  // POSTs the publish. On a 409 it refetches and raises the explicit user-choice flow instead of
  // a toast; the owner decides whether their layout overwrites the concurrently-published one.
  const performPublish = useCallback(async (): Promise<'ok' | 'conflict' | 'error'> => {
    try {
      const result = await api<StoredLayout>(
        `/api/v1/projects/${projectId}/workspace-layout/publish`,
        {
          method: 'POST',
          body: JSON.stringify({
            personalRevision: personalRevisionRef.current,
            defaultRevision: defaultRevisionRef.current,
          }),
        },
      );
      defaultRevisionRef.current = result.revision;
      return 'ok';
    } catch (reason) {
      if (isConflict(reason)) {
        const latest = await refetchLayouts();
        setPublishConflict({ latestDefault: workspaceLayoutSchema.parse(latest.default.layout) });
        return 'conflict';
      }
      pushToast(messageOf(reason, 'Workspace could not be published.'));
      return 'error';
    }
  }, [projectId, refetchLayouts, pushToast]);

  const publish = useCallback(
    () =>
      enqueue(async () => {
        // Flush any pending edits first so the server publishes exactly what the owner sees; the
        // queue guarantees no debounced save is still racing behind us.
        const current = layoutRef.current;
        if (current) {
          const hash = JSON.stringify(current);
          if (hash !== lastSavedHash.current) {
            await runSave(current, hash);
            if (hash !== lastSavedHash.current) return; // the save failed and already toasted
          }
        }
        await performPublish();
      }),
    [enqueue, runSave, performPublish],
  );

  const resolvePublishOverwrite = useCallback(
    () =>
      enqueue(async () => {
        const outcome = await performPublish();
        if (outcome !== 'conflict') setPublishConflict(undefined);
      }),
    [enqueue, performPublish],
  );
  const adoptLatestDefault = useCallback(() => {
    setPublishConflict((conflict) => {
      if (conflict) {
        layoutRef.current = conflict.latestDefault;
        setLayout(conflict.latestDefault); // becomes dirty vs saved hash; the debounce persists it
      }
      return undefined;
    });
  }, []);
  const dismissPublishConflict = useCallback(() => setPublishConflict(undefined), []);

  useEffect(() => {
    if (!stored || layout) return;
    const next = workspaceLayoutSchema.parse(stored.personal.layout);
    layoutRef.current = next;
    personalRevisionRef.current = stored.personal.revision;
    defaultRevisionRef.current = stored.default.revision;
    lastSavedHash.current = JSON.stringify(next);
    setLayout(next);
  }, [layout, stored]);

  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  useEffect(() => {
    if (!layout) return;
    const hash = JSON.stringify(layout);
    if (hash === lastSavedHash.current) return;
    setPersistState('dirty');
    const timer = window.setTimeout(() => {
      void enqueue(() => runSave(layout, hash));
    }, 650);
    return () => window.clearTimeout(timer);
  }, [layout, enqueue, runSave]);

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

  return {
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
  };
}

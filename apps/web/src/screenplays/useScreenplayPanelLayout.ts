import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api';
import { createBrowserUuid } from '../browser-uuid';
import { collectPanelSlots } from '../workspace/layout';
import type { SaveState } from '../workspace/shell';
import {
  createDefaultScreenplayPanelLayout,
  createScreenplayPanel,
  reduceScreenplayPanelLayout,
  screenplayPanelLayoutSchema,
  type ScreenplayPanelKind,
  type ScreenplayPanelLayout,
} from './screenplay-panel-layout';

const LAYOUT_STORAGE_PREFIX = 'coda:screenplay-layout:';
const SAVE_DEBOUNCE_MS = 650;

interface ScreenplayPanelLayoutOptions {
  screenplayId: string;
  onError: (message: string) => void;
}

/** The server row shape returned by GET/PUT `/screenplays/:id/panel-layout` (`null` before first save). */
interface StoredScreenplayLayout {
  layout: unknown;
  revision: number;
  schemaVersion: number;
}

/**
 * Ranked so that a merge of two save states surfaces the one that most warrants attention. The
 * background read states (`loading`/`updating`) rank below `saved`: while one concern is still
 * loading from the server, an already-`saved` concern should keep the chip on its "all clear"
 * reading rather than flip it to a transient LOADING on every editor open.
 */
const SAVE_STATE_PRIORITY: Record<SaveState, number> = {
  loading: 0,
  updating: 1,
  saved: 2,
  unsaved: 3,
  saving: 4,
  offline: 5,
  conflict: 6,
  failed: 7,
};

/**
 * Collapses two canonical save states into one for a shared status chip, keeping whichever ranks
 * higher. Used to fold the panel-layout persistence state into the screenplay's document-autosave
 * state so a single {@link SaveState} chip reports both.
 */
export function mergeScreenplaySaveState(a: SaveState, b: SaveState): SaveState {
  return SAVE_STATE_PRIORITY[a] >= SAVE_STATE_PRIORITY[b] ? a : b;
}

function storageKey(screenplayId: string): string {
  return `${LAYOUT_STORAGE_PREFIX}${screenplayId}`;
}

/**
 * Reads the offline-cached / pre-server-sync layout for a screenplay, reporting whether a stored
 * value was actually present so the caller can decide whether a one-time migration import is owed.
 */
function storedPanelLayout(screenplayId: string): {
  layout: ScreenplayPanelLayout;
  fromStorage: boolean;
} {
  try {
    const stored = localStorage.getItem(storageKey(screenplayId));
    if (stored) {
      return { layout: screenplayPanelLayoutSchema.parse(JSON.parse(stored)), fromStorage: true };
    }
  } catch {
    // Invalid or unavailable storage falls back to the canonical layout.
  }
  return { layout: createDefaultScreenplayPanelLayout(), fromStorage: false };
}

function writeLocal(screenplayId: string, layout: ScreenplayPanelLayout): void {
  try {
    localStorage.setItem(storageKey(screenplayId), JSON.stringify(layout));
  } catch {
    // A private or quota-limited browser can still use the in-memory + server layout.
  }
}

export function useScreenplayPanelLayout({ screenplayId, onError }: ScreenplayPanelLayoutOptions) {
  const queryClient = useQueryClient();
  const initial = useRef<{ layout: ScreenplayPanelLayout; fromStorage: boolean }>(null!);
  initial.current ??= storedPanelLayout(screenplayId);

  const [layout, setLayout] = useState(() => initial.current.layout);
  const [history, setHistory] = useState<ScreenplayPanelLayout[]>([]);
  const [fullscreenSlotId, setFullscreenSlotId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('loading');

  // `revision` is null until the first server reconciliation establishes sync; saves defer until
  // then. `lastSavedHash` is the JSON of the layout the server currently holds (null forces a save,
  // e.g. an owed migration import). `hydrated` guards one-shot reconciliation; `dirty` records a
  // local edit that must not be clobbered by an adopted server layout.
  const layoutRef = useRef(layout);
  const revisionRef = useRef<number | null>(null);
  const lastSavedHashRef = useRef<string | null>(null);
  const hydratedRef = useRef(false);
  const dirtyRef = useRef(false);
  const inFlightRef = useRef(false);
  const persistRef = useRef<() => void>(() => {});

  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  const remote = useQuery({
    queryKey: ['screenplay-layout', screenplayId],
    queryFn: ({ signal }) =>
      api<StoredScreenplayLayout | null>(`/api/v1/screenplays/${screenplayId}/panel-layout`, {
        signal,
      }),
  });

  const resyncFromServer = useCallback(async () => {
    try {
      const fresh = await api<StoredScreenplayLayout | null>(
        `/api/v1/screenplays/${screenplayId}/panel-layout`,
      );
      const parsed = fresh ? screenplayPanelLayoutSchema.safeParse(fresh.layout) : null;
      if (fresh && parsed?.success) {
        revisionRef.current = fresh.revision;
        lastSavedHashRef.current = JSON.stringify(parsed.data);
        layoutRef.current = parsed.data;
        setLayout(parsed.data);
        queryClient.setQueryData(['screenplay-layout', screenplayId], fresh);
        setSaveState('saved');
      } else {
        // The row vanished (e.g. the screenplay was reset elsewhere); allow a fresh create.
        revisionRef.current = 0;
        lastSavedHashRef.current = null;
        setSaveState('unsaved');
      }
    } catch {
      setSaveState(navigator.onLine ? 'failed' : 'offline');
    }
  }, [queryClient, screenplayId]);

  const persist = useCallback(() => {
    if (revisionRef.current === null || inFlightRef.current) return;
    const current = layoutRef.current;
    const hash = JSON.stringify(current);
    if (hash === lastSavedHashRef.current) {
      setSaveState('saved');
      return;
    }
    if (!navigator.onLine) {
      setSaveState('offline');
      return;
    }
    inFlightRef.current = true;
    setSaveState('saving');
    api<StoredScreenplayLayout>(`/api/v1/screenplays/${screenplayId}/panel-layout`, {
      method: 'PUT',
      body: JSON.stringify({ layout: current, expectedRevision: revisionRef.current }),
    })
      .then((saved) => {
        revisionRef.current = saved.revision;
        lastSavedHashRef.current = hash;
        queryClient.setQueryData(['screenplay-layout', screenplayId], saved);
        const stillDirty =
          navigator.onLine && JSON.stringify(layoutRef.current) !== lastSavedHashRef.current;
        setSaveState(stillDirty ? 'unsaved' : 'saved');
        if (stillDirty) window.setTimeout(() => persistRef.current(), SAVE_DEBOUNCE_MS);
      })
      .catch((reason: unknown) => {
        if (reason instanceof ApiError && reason.problem.status === 409) {
          void resyncFromServer();
        } else {
          setSaveState(navigator.onLine ? 'failed' : 'offline');
        }
      })
      .finally(() => {
        inFlightRef.current = false;
      });
  }, [queryClient, resyncFromServer, screenplayId]);

  useEffect(() => {
    persistRef.current = persist;
  }, [persist]);

  // One-shot reconciliation once the initial server read settles: adopt the server layout, or set
  // up a lazy/owed create when the server has no row for this user yet.
  useEffect(() => {
    if (hydratedRef.current || remote.isPending) return;
    if (remote.isError) {
      setSaveState(navigator.onLine ? 'failed' : 'offline');
      return;
    }
    hydratedRef.current = true;
    const parsed = remote.data ? screenplayPanelLayoutSchema.safeParse(remote.data.layout) : null;
    if (remote.data && parsed?.success) {
      revisionRef.current = remote.data.revision;
      if (dirtyRef.current) {
        // Local edits made before sync win; import them against the server's revision.
        lastSavedHashRef.current = JSON.stringify(parsed.data);
        setSaveState('unsaved');
        window.setTimeout(() => persistRef.current(), 0);
      } else {
        setLayout(parsed.data);
        layoutRef.current = parsed.data;
        lastSavedHashRef.current = JSON.stringify(parsed.data);
        setSaveState('saved');
      }
      return;
    }
    // No server row yet. Import an existing local layout once; otherwise create lazily on first edit.
    revisionRef.current = 0;
    if (initial.current.fromStorage || dirtyRef.current) {
      lastSavedHashRef.current = null;
      setSaveState('unsaved');
      window.setTimeout(() => persistRef.current(), 0);
    } else {
      lastSavedHashRef.current = JSON.stringify(layoutRef.current);
      setSaveState('saved');
    }
  }, [remote.data, remote.isError, remote.isPending]);

  // Keep the offline mirror warm on every layout change.
  useEffect(() => {
    writeLocal(screenplayId, layout);
  }, [layout, screenplayId]);

  // Debounced server persistence for user-driven layout changes after sync is established.
  useEffect(() => {
    if (!hydratedRef.current || revisionRef.current === null) return;
    const hash = JSON.stringify(layout);
    if (hash === lastSavedHashRef.current) return;
    if (!navigator.onLine) {
      setSaveState('offline');
      return;
    }
    setSaveState('unsaved');
    const timer = window.setTimeout(() => persistRef.current(), SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [layout]);

  // Retry a deferred sync or pending save when connectivity returns.
  useEffect(() => {
    const retry = () => {
      if (!hydratedRef.current || revisionRef.current === null) {
        void remote.refetch();
        return;
      }
      if (JSON.stringify(layoutRef.current) !== lastSavedHashRef.current) persistRef.current();
    };
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [remote]);

  const commit = useCallback((next: ScreenplayPanelLayout) => {
    dirtyRef.current = true;
    setHistory((current) => [...current.slice(-19), layoutRef.current]);
    setLayout(next);
  }, []);

  const togglePanelKind = useCallback(
    (kind: ScreenplayPanelKind) => {
      const current = layoutRef.current;
      const slots = collectPanelSlots(current.root);
      const existing = slots.find((slot) => slot.panel.type === kind);
      try {
        if (existing) {
          if (slots.length === 1) return;
          commit(reduceScreenplayPanelLayout(current, { type: 'close', slotId: existing.id }));
          return;
        }
        const target = slots[0];
        if (!target) return;
        const newSlotId = createBrowserUuid();
        const newPanelId = createBrowserUuid();
        const splitLayout = reduceScreenplayPanelLayout(current, {
          type: 'split',
          slotId: target.id,
          axis: 'horizontal',
          ratioBasisPoints: 3000,
          splitId: createBrowserUuid(),
          newSlotId,
          newPanelId,
          placement: kind === 'outline' ? 'first' : 'second',
        });
        commit(
          reduceScreenplayPanelLayout(splitLayout, {
            type: 'replace',
            slotId: newSlotId,
            panel: createScreenplayPanel(kind, newPanelId),
          }),
        );
      } catch (error) {
        onError(error instanceof Error ? error.message : 'Panel operation failed.');
      }
    },
    [commit, onError],
  );

  const undo = useCallback(() => {
    const previous = history.at(-1);
    if (!previous) return;
    dirtyRef.current = true;
    layoutRef.current = previous;
    setLayout(previous);
    setHistory((current) => current.slice(0, -1));
  }, [history]);

  const reset = useCallback(() => {
    commit(createDefaultScreenplayPanelLayout());
    setFullscreenSlotId(null);
  }, [commit]);

  return {
    layout,
    fullscreenSlotId,
    saveState,
    canUndo: history.length > 0,
    setFullscreenSlotId,
    commit,
    togglePanelKind,
    undo,
    reset,
  };
}

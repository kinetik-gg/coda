import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api';
import type { SaveState } from '../workspace/shell';
import type { ScreenplayPaperSize } from './screenplay-paper';
import type {
  ScreenplayRecoverySnapshot,
  ScreenplayRecoveryStore,
} from './screenplay-recovery-store';
import type { Screenplay } from './types';
import { useScreenplayRecovery } from './useScreenplayRecovery';

interface ScreenplayAutosaveOptions {
  collaborativeSource?: boolean;
  onRecoverSource?: (sourceText: string) => void;
  recoveryStore?: ScreenplayRecoveryStore;
  recoveryDebounceMs?: number;
}

export function useScreenplayAutosave(
  screenplayId: string,
  screenplay?: Screenplay,
  options: ScreenplayAutosaveOptions = {},
) {
  const collaborativeSource = options.collaborativeSource ?? false;
  const onRecoverSource = options.onRecoverSource;
  const queryClient = useQueryClient();
  const [draft, setDraftState] = useState('');
  const [paperSize, setPaperSizeState] = useState<ScreenplayPaperSize>('letter');
  const [status, setStatus] = useState<SaveState>('saved');
  const initializedId = useRef<string | undefined>(undefined);
  const draftRef = useRef('');
  const savedRef = useRef('');
  const paperSizeRef = useRef<ScreenplayPaperSize>('letter');
  const savedPaperSizeRef = useRef<ScreenplayPaperSize>('letter');
  const versionRef = useRef(1);
  const inFlightRef = useRef<Promise<boolean> | null>(null);

  const installScreenplay = useCallback(
    (next: Screenplay) => {
      const nextPaperSize = next.paperSize ?? 'letter';
      const openingNewDocument = initializedId.current !== next.id;
      initializedId.current = next.id;
      if (!collaborativeSource || openingNewDocument) {
        draftRef.current = next.sourceText;
        savedRef.current = next.sourceText;
        setDraftState(next.sourceText);
      }
      paperSizeRef.current = nextPaperSize;
      savedPaperSizeRef.current = nextPaperSize;
      versionRef.current = next.version;
      setPaperSizeState(nextPaperSize);
      setStatus('saved');
    },
    [collaborativeSource],
  );

  useEffect(() => {
    if (!screenplay || initializedId.current === screenplay.id) return;
    installScreenplay(screenplay);
  }, [installScreenplay, screenplay]);

  const recoveryRefs = useMemo(
    () => ({
      initializedId,
      draft: draftRef,
      savedDraft: savedRef,
      paperSize: paperSizeRef,
      savedPaperSize: savedPaperSizeRef,
      serverVersion: versionRef,
    }),
    [],
  );
  const applyRecovery = useCallback(
    (snapshot: ScreenplayRecoverySnapshot) => {
      draftRef.current = snapshot.sourceText;
      paperSizeRef.current = snapshot.paperSize;
      setDraftState(snapshot.sourceText);
      setPaperSizeState(snapshot.paperSize);
      onRecoverSource?.(snapshot.sourceText);
      if (!collaborativeSource) setStatus(navigator.onLine ? 'unsaved' : 'offline');
    },
    [collaborativeSource, onRecoverSource],
  );
  const recoveryState = useScreenplayRecovery({
    screenplayId,
    screenplay,
    draft,
    paperSize,
    refs: recoveryRefs,
    store: options.recoveryStore,
    debounceMs: options.recoveryDebounceMs,
    applySnapshot: applyRecovery,
  });
  const { clearConfirmed, preserve, present } = recoveryState;
  const documentIsDirty = useCallback(
    () =>
      (!collaborativeSource && draftRef.current !== savedRef.current) ||
      paperSizeRef.current !== savedPaperSizeRef.current,
    [collaborativeSource],
  );

  const persist = useCallback(
    function persistDraft(): Promise<boolean> {
      if (!documentIsDirty()) {
        setStatus('saved');
        return Promise.resolve(true);
      }
      if (!navigator.onLine) {
        setStatus('offline');
        return preserve().then(() => false);
      }
      if (inFlightRef.current) {
        return inFlightRef.current.then((saved) => {
          if (!saved || !documentIsDirty()) return saved;
          return persistDraft();
        });
      }
      const sentSource = draftRef.current;
      const sentPaperSize = paperSizeRef.current;
      setStatus('saving');
      const request = (async () => {
        try {
          const updated = await api<Screenplay>(`/api/v1/screenplays/${screenplayId}`, {
            method: 'PATCH',
            body: JSON.stringify({
              ...(!collaborativeSource ? { sourceText: sentSource } : {}),
              paperSize: sentPaperSize,
              version: versionRef.current,
            }),
          });
          if (!collaborativeSource) savedRef.current = sentSource;
          savedPaperSizeRef.current = sentPaperSize;
          versionRef.current = updated.version;
          queryClient.setQueryData<Screenplay>(['screenplay', screenplayId], updated);
          const exactSave =
            (collaborativeSource || draftRef.current === sentSource) &&
            paperSizeRef.current === sentPaperSize;
          setStatus(exactSave ? 'saved' : 'unsaved');
          if (exactSave) await clearConfirmed(sentSource, sentPaperSize);
          return true;
        } catch (error) {
          await preserve();
          setStatus(
            error instanceof ApiError && error.problem.status === 409 ? 'conflict' : 'failed',
          );
          return false;
        } finally {
          inFlightRef.current = null;
        }
      })();
      inFlightRef.current = request;
      return request.then((saved) => {
        if (!saved || !documentIsDirty()) return saved;
        return persistDraft();
      });
    },
    [clearConfirmed, collaborativeSource, documentIsDirty, preserve, queryClient, screenplayId],
  );

  useEffect(() => {
    if (status !== 'unsaved') return;
    const timer = window.setTimeout(() => void persist(), 700);
    return () => window.clearTimeout(timer);
  }, [draft, paperSize, persist, status]);

  useEffect(() => {
    const retry = () => {
      if (documentIsDirty()) void persist();
    };
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [documentIsDirty, persist]);

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (!documentIsDirty()) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [documentIsDirty]);

  const setDraft = useCallback(
    (value: string) => {
      draftRef.current = value;
      setDraftState(value);
      if (collaborativeSource) return;
      setStatus(
        value === savedRef.current && paperSizeRef.current === savedPaperSizeRef.current
          ? 'saved'
          : navigator.onLine
            ? 'unsaved'
            : 'offline',
      );
    },
    [collaborativeSource],
  );

  const setPaperSize = useCallback((value: ScreenplayPaperSize) => {
    paperSizeRef.current = value;
    setPaperSizeState(value);
    setStatus(
      value === savedPaperSizeRef.current && draftRef.current === savedRef.current
        ? 'saved'
        : navigator.onLine
          ? 'unsaved'
          : 'offline',
    );
  }, []);

  const getCurrentDocument = useCallback(
    () => ({ sourceText: draftRef.current, paperSize: paperSizeRef.current }),
    [],
  );
  const getCurrentVersion = useCallback(() => versionRef.current, []);

  // Adopts a server version bumped by an out-of-band mutation (e.g. a title rename issued from the
  // File menu) so the next source persist optimistic-concurrency check uses the current version.
  const syncServerVersion = useCallback((version: number) => {
    versionRef.current = version;
  }, []);

  const reloadLatest = useCallback(async () => {
    const preserved = await preserve();
    const latest = await api<Screenplay>(`/api/v1/screenplays/${screenplayId}`);
    queryClient.setQueryData(['screenplay', screenplayId], latest);
    installScreenplay(latest);
    if (preserved) present(preserved);
  }, [installScreenplay, preserve, present, queryClient, screenplayId]);

  return {
    draft,
    paperSize,
    status,
    recovery: recoveryState.recovery,
    recoveryError: recoveryState.recoveryError,
    recoveryServerVersion: versionRef.current,
    setDraft,
    setPaperSize,
    getCurrentDocument,
    getCurrentVersion,
    syncServerVersion,
    persist,
    reloadLatest,
    recoverDraft: recoveryState.recoverDraft,
    discardRecovery: recoveryState.discardRecovery,
    dismissRecoveryError: recoveryState.dismissRecoveryError,
  };
}

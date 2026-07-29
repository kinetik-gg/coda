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
import type { ScreenplayCollaborationProvider } from './screenplay-collaboration-provider';
import { useScreenplayRecovery } from './useScreenplayRecovery';
import { mergeScreenplaySaveState } from './useScreenplayPanelLayout';

interface ScreenplayAutosaveOptions {
  recoveryStore?: ScreenplayRecoveryStore;
  recoveryDebounceMs?: number;
  collaboration?: ScreenplayCollaborationProvider;
}

export function useScreenplayAutosave(
  screenplayId: string,
  screenplay?: Screenplay,
  options: ScreenplayAutosaveOptions = {},
) {
  const queryClient = useQueryClient();
  const [draftState, setDraftState] = useState('');
  const [paperSize, setPaperSizeState] = useState<ScreenplayPaperSize>('letter');
  const [status, setStatus] = useState<SaveState>('saved');
  const initializedId = useRef<string | undefined>(undefined);
  const draftRef = useRef('');
  const savedRef = useRef('');
  const paperSizeRef = useRef<ScreenplayPaperSize>('letter');
  const savedPaperSizeRef = useRef<ScreenplayPaperSize>('letter');
  const versionRef = useRef(1);
  const inFlightRef = useRef<Promise<boolean> | null>(null);
  const collaboration = options.collaboration;

  const installScreenplay = useCallback(
    (next: Screenplay) => {
      const nextPaperSize = next.paperSize ?? 'letter';
      initializedId.current = next.id;
      if (!collaboration) {
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
    [collaboration],
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
  const collaborationDraft = collaboration?.snapshot.draft;
  const collaborationStatus = collaboration?.snapshot.status;
  const collaborationVersion = collaboration?.snapshot.version;
  useEffect(() => {
    if (!collaboration) return;
    draftRef.current = collaboration.snapshot.draft;
    versionRef.current = collaboration.snapshot.version;
    if (collaboration.snapshot.status === 'saved') {
      savedRef.current = collaboration.snapshot.draft;
    }
  }, [collaboration, collaborationDraft, collaborationStatus, collaborationVersion]);
  const draft = collaborationDraft ?? draftState;
  const applyRecovery = useCallback(
    (snapshot: ScreenplayRecoverySnapshot) => {
      draftRef.current = snapshot.sourceText;
      paperSizeRef.current = snapshot.paperSize;
      if (collaboration) collaboration.replaceSourceText(snapshot.sourceText);
      else setDraftState(snapshot.sourceText);
      setPaperSizeState(snapshot.paperSize);
      setStatus(navigator.onLine ? 'unsaved' : 'offline');
    },
    [collaboration],
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

  const persistRestDraft = useCallback(
    function persistDraft(): Promise<boolean> {
      if (
        draftRef.current === savedRef.current &&
        paperSizeRef.current === savedPaperSizeRef.current
      ) {
        setStatus('saved');
        return Promise.resolve(true);
      }
      if (!navigator.onLine) {
        setStatus('offline');
        return preserve().then(() => false);
      }
      if (inFlightRef.current) {
        return inFlightRef.current.then((saved) => {
          if (
            !saved ||
            (draftRef.current === savedRef.current &&
              paperSizeRef.current === savedPaperSizeRef.current)
          )
            return saved;
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
              sourceText: sentSource,
              paperSize: sentPaperSize,
              version: versionRef.current,
            }),
          });
          savedRef.current = sentSource;
          savedPaperSizeRef.current = sentPaperSize;
          versionRef.current = updated.version;
          queryClient.setQueryData<Screenplay>(['screenplay', screenplayId], updated);
          const exactSave =
            draftRef.current === sentSource && paperSizeRef.current === sentPaperSize;
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
        if (
          !saved ||
          (draftRef.current === savedRef.current &&
            paperSizeRef.current === savedPaperSizeRef.current)
        )
          return saved;
        return persistDraft();
      });
    },
    [clearConfirmed, preserve, queryClient, screenplayId],
  );

  const persist = useCallback(async (): Promise<boolean> => {
    if (!collaboration) return persistRestDraft();
    if (!(await collaboration.persist())) {
      await preserve();
      return false;
    }
    versionRef.current = collaboration.snapshot.version;
    savedRef.current = collaboration.snapshot.draft;
    if (paperSizeRef.current === savedPaperSizeRef.current) {
      setStatus('saved');
      await clearConfirmed(collaboration.snapshot.draft, paperSizeRef.current);
      return true;
    }
    const sentPaperSize = paperSizeRef.current;
    setStatus('saving');
    try {
      const updated = await api<Screenplay>(`/api/v1/screenplays/${screenplayId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          paperSize: sentPaperSize,
          version: collaboration.snapshot.version,
        }),
      });
      savedPaperSizeRef.current = sentPaperSize;
      versionRef.current = updated.version;
      collaboration.adoptVersion(updated.version);
      queryClient.setQueryData<Screenplay>(['screenplay', screenplayId], updated);
      setStatus(paperSizeRef.current === sentPaperSize ? 'saved' : 'unsaved');
      if (paperSizeRef.current === sentPaperSize) {
        await clearConfirmed(collaboration.snapshot.draft, sentPaperSize);
      }
      return true;
    } catch (error) {
      await preserve();
      setStatus(error instanceof ApiError && error.problem.status === 409 ? 'conflict' : 'failed');
      return false;
    }
  }, [clearConfirmed, collaboration, persistRestDraft, preserve, queryClient, screenplayId]);

  useEffect(() => {
    if (status !== 'unsaved') return;
    const timer = window.setTimeout(() => void persist(), 700);
    return () => window.clearTimeout(timer);
  }, [draft, paperSize, persist, status]);

  useEffect(() => {
    const retry = () => {
      if (
        draftRef.current !== savedRef.current ||
        paperSizeRef.current !== savedPaperSizeRef.current
      )
        void persist();
    };
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [persist]);

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (
        draftRef.current === savedRef.current &&
        paperSizeRef.current === savedPaperSizeRef.current
      )
        return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, []);

  const setDraft = useCallback(
    (value: string) => {
      draftRef.current = value;
      if (collaboration) collaboration.replaceSourceText(value);
      else setDraftState(value);
      setStatus(
        value === savedRef.current && paperSizeRef.current === savedPaperSizeRef.current
          ? 'saved'
          : navigator.onLine
            ? 'unsaved'
            : 'offline',
      );
    },
    [collaboration],
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
  const syncServerVersion = useCallback(
    (version: number) => {
      versionRef.current = version;
      collaboration?.adoptVersion(version);
    },
    [collaboration],
  );

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
    status:
      collaborationStatus === 'loading' && status === 'saved'
        ? 'loading'
        : collaborationStatus
          ? mergeScreenplaySaveState(collaborationStatus, status)
          : status,
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

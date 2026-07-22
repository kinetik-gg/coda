import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api';
import type { ScreenplayPaperSize } from './screenplay-paper';
import type {
  ScreenplayRecoverySnapshot,
  ScreenplayRecoveryStore,
} from './screenplay-recovery-store';
import type { SaveStatus, Screenplay } from './types';
import { useScreenplayRecovery } from './useScreenplayRecovery';

interface ScreenplayAutosaveOptions {
  recoveryStore?: ScreenplayRecoveryStore;
  recoveryDebounceMs?: number;
}

export function useScreenplayAutosave(
  screenplayId: string,
  screenplay?: Screenplay,
  options: ScreenplayAutosaveOptions = {},
) {
  const queryClient = useQueryClient();
  const [draft, setDraftState] = useState('');
  const [paperSize, setPaperSizeState] = useState<ScreenplayPaperSize>('letter');
  const [status, setStatus] = useState<SaveStatus>('saved');
  const initializedId = useRef<string | undefined>(undefined);
  const draftRef = useRef('');
  const savedRef = useRef('');
  const paperSizeRef = useRef<ScreenplayPaperSize>('letter');
  const savedPaperSizeRef = useRef<ScreenplayPaperSize>('letter');
  const versionRef = useRef(1);
  const inFlightRef = useRef<Promise<boolean> | null>(null);

  const installScreenplay = useCallback((next: Screenplay) => {
    const nextPaperSize = next.paperSize ?? 'letter';
    initializedId.current = next.id;
    draftRef.current = next.sourceText;
    savedRef.current = next.sourceText;
    paperSizeRef.current = nextPaperSize;
    savedPaperSizeRef.current = nextPaperSize;
    versionRef.current = next.version;
    setDraftState(next.sourceText);
    setPaperSizeState(nextPaperSize);
    setStatus('saved');
  }, []);

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
  const applyRecovery = useCallback((snapshot: ScreenplayRecoverySnapshot) => {
    draftRef.current = snapshot.sourceText;
    paperSizeRef.current = snapshot.paperSize;
    setDraftState(snapshot.sourceText);
    setPaperSizeState(snapshot.paperSize);
    setStatus(navigator.onLine ? 'unsaved' : 'offline');
  }, []);
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

  const persist = useCallback(
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

  const setDraft = useCallback((value: string) => {
    draftRef.current = value;
    setDraftState(value);
    setStatus(
      value === savedRef.current && paperSizeRef.current === savedPaperSizeRef.current
        ? 'saved'
        : navigator.onLine
          ? 'unsaved'
          : 'offline',
    );
  }, []);

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
    persist,
    reloadLatest,
    recoverDraft: recoveryState.recoverDraft,
    discardRecovery: recoveryState.discardRecovery,
    dismissRecoveryError: recoveryState.dismissRecoveryError,
  };
}

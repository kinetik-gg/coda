import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
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

interface AutosaveRefs {
  draft: MutableRefObject<string>;
  savedDraft: MutableRefObject<string>;
  paperSize: MutableRefObject<ScreenplayPaperSize>;
  savedPaperSize: MutableRefObject<ScreenplayPaperSize>;
  serverVersion: MutableRefObject<number>;
}

function useCollaborationDocument(
  collaboration: ScreenplayCollaborationProvider | undefined,
  draftState: string,
  setDraftState: Dispatch<SetStateAction<string>>,
  setStatus: Dispatch<SetStateAction<SaveState>>,
  refs: AutosaveRefs,
) {
  const draft = collaboration?.snapshot.draft ?? draftState;
  const status = collaboration?.snapshot.status;
  const version = collaboration?.snapshot.version;
  useEffect(() => {
    if (!collaboration) return;
    refs.draft.current = collaboration.snapshot.draft;
    refs.serverVersion.current = collaboration.snapshot.version;
    if (collaboration.snapshot.status === 'saved') {
      refs.savedDraft.current = collaboration.snapshot.draft;
    }
  }, [collaboration, draft, refs, status, version]);
  const setDraft = useCallback(
    (value: string) => {
      refs.draft.current = value;
      if (collaboration) collaboration.replaceSourceText(value);
      else setDraftState(value);
      setStatus(
        value === refs.savedDraft.current && refs.paperSize.current === refs.savedPaperSize.current
          ? 'saved'
          : navigator.onLine
            ? 'unsaved'
            : 'offline',
      );
    },
    [collaboration, refs, setDraftState, setStatus],
  );
  return { draft, setDraft, status };
}

async function persistCollaborativeDocument(input: {
  collaboration: ScreenplayCollaborationProvider;
  refs: AutosaveRefs;
  screenplayId: string;
  queryClient: QueryClient;
  setStatus: Dispatch<SetStateAction<SaveState>>;
  preserve: () => Promise<ScreenplayRecoverySnapshot | undefined>;
  clearConfirmed: (sourceText: string, paperSize: ScreenplayPaperSize) => Promise<void>;
}): Promise<boolean> {
  const { collaboration, refs } = input;
  if (!(await collaboration.persist())) {
    await input.preserve();
    return false;
  }
  refs.serverVersion.current = collaboration.snapshot.version;
  refs.savedDraft.current = collaboration.snapshot.draft;
  if (refs.paperSize.current === refs.savedPaperSize.current) {
    input.setStatus('saved');
    await input.clearConfirmed(collaboration.snapshot.draft, refs.paperSize.current);
    return true;
  }
  const sentPaperSize = refs.paperSize.current;
  input.setStatus('saving');
  try {
    const updated = await api<Screenplay>(`/api/v1/screenplays/${input.screenplayId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        paperSize: sentPaperSize,
        version: collaboration.snapshot.version,
      }),
    });
    refs.savedPaperSize.current = sentPaperSize;
    refs.serverVersion.current = updated.version;
    collaboration.adoptVersion(updated.version);
    input.queryClient.setQueryData<Screenplay>(['screenplay', input.screenplayId], updated);
    input.setStatus(refs.paperSize.current === sentPaperSize ? 'saved' : 'unsaved');
    if (refs.paperSize.current === sentPaperSize) {
      await input.clearConfirmed(collaboration.snapshot.draft, sentPaperSize);
    }
    return true;
  } catch (error) {
    await input.preserve();
    input.setStatus(
      error instanceof ApiError && error.problem.status === 409 ? 'conflict' : 'failed',
    );
    return false;
  }
}

function usePaperSizeSetter(
  refs: AutosaveRefs,
  setPaperSizeState: Dispatch<SetStateAction<ScreenplayPaperSize>>,
  setStatus: Dispatch<SetStateAction<SaveState>>,
) {
  return useCallback(
    (value: ScreenplayPaperSize) => {
      refs.paperSize.current = value;
      setPaperSizeState(value);
      setStatus(
        value === refs.savedPaperSize.current && refs.draft.current === refs.savedDraft.current
          ? 'saved'
          : navigator.onLine
            ? 'unsaved'
            : 'offline',
      );
    },
    [refs, setPaperSizeState, setStatus],
  );
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
  const {
    draft,
    setDraft,
    status: collaborationStatus,
  } = useCollaborationDocument(collaboration, draftState, setDraftState, setStatus, recoveryRefs);
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
    return persistCollaborativeDocument({
      collaboration,
      refs: recoveryRefs,
      screenplayId,
      queryClient,
      setStatus,
      preserve,
      clearConfirmed,
    });
  }, [
    clearConfirmed,
    collaboration,
    persistRestDraft,
    preserve,
    queryClient,
    recoveryRefs,
    screenplayId,
  ]);

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

  const setPaperSize = usePaperSizeSetter(recoveryRefs, setPaperSizeState, setStatus);

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

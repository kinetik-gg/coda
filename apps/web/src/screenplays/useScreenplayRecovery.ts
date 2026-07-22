import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { ScreenplayPaperSize } from './screenplay-paper';
import {
  createScreenplayRecoverySnapshot,
  indexedDbScreenplayRecoveryStore,
  screenplayRecoveryContentHash,
  type ScreenplayRecoverySnapshot,
  type ScreenplayRecoveryStore,
} from './screenplay-recovery-store';
import type { Screenplay } from './types';

const RECOVERY_DEBOUNCE_MS = 250;
const RECOVERY_ERROR =
  'Browser recovery is unavailable. Keep this tab open or download a Fountain backup.';

interface RecoveryDocumentRefs {
  initializedId: MutableRefObject<string | undefined>;
  draft: MutableRefObject<string>;
  savedDraft: MutableRefObject<string>;
  paperSize: MutableRefObject<ScreenplayPaperSize>;
  savedPaperSize: MutableRefObject<ScreenplayPaperSize>;
  serverVersion: MutableRefObject<number>;
}

interface ScreenplayRecoveryOptions {
  screenplayId: string;
  screenplay?: Screenplay;
  draft: string;
  paperSize: ScreenplayPaperSize;
  refs: RecoveryDocumentRefs;
  store?: ScreenplayRecoveryStore;
  debounceMs?: number;
  applySnapshot: (snapshot: ScreenplayRecoverySnapshot) => void;
}

export function useScreenplayRecovery({
  screenplayId,
  screenplay,
  draft,
  paperSize,
  refs,
  store = indexedDbScreenplayRecoveryStore,
  debounceMs = RECOVERY_DEBOUNCE_MS,
  applySnapshot,
}: ScreenplayRecoveryOptions) {
  const [recovery, setRecovery] = useState<ScreenplayRecoverySnapshot>();
  const [recoveryError, setRecoveryError] = useState<string>();
  const memoryRecovery = useRef<ScreenplayRecoverySnapshot | undefined>(undefined);
  const loadedScope = useRef<string | undefined>(undefined);
  const accountId = screenplay?.ownerUserId;

  const preserve = useCallback(async (): Promise<ScreenplayRecoverySnapshot | undefined> => {
    if (!accountId || refs.initializedId.current !== screenplayId) return undefined;
    if (!isDirty(refs)) return memoryRecovery.current;
    const snapshot = await createScreenplayRecoverySnapshot({
      accountId,
      screenplayId,
      baseServerVersion: refs.serverVersion.current,
      sourceText: refs.draft.current,
      paperSize: refs.paperSize.current,
    });
    memoryRecovery.current = snapshot;
    try {
      await store.save(snapshot);
      setRecoveryError(undefined);
    } catch {
      setRecoveryError(RECOVERY_ERROR);
    }
    return snapshot;
  }, [accountId, refs, screenplayId, store]);

  const clearConfirmed = useCallback(
    async (sourceText: string, confirmedPaperSize: ScreenplayPaperSize): Promise<void> => {
      if (!accountId) return;
      const contentHash = await screenplayRecoveryContentHash(sourceText, confirmedPaperSize);
      if (memoryRecovery.current?.contentHash === contentHash) memoryRecovery.current = undefined;
      try {
        await store.remove(accountId, screenplayId, {
          contentHash,
          sourceText,
          paperSize: confirmedPaperSize,
        });
      } catch {
        setRecoveryError(RECOVERY_ERROR);
      }
    },
    [accountId, screenplayId, store],
  );

  useEffect(() => {
    if (!screenplay || refs.initializedId.current !== screenplay.id) return;
    const scope = `${screenplay.ownerUserId}:${screenplay.id}`;
    if (loadedScope.current !== scope) {
      loadedScope.current = scope;
      memoryRecovery.current = undefined;
      setRecovery(undefined);
      setRecoveryError(undefined);
    }
    let cancelled = false;
    void store
      .read(screenplay.ownerUserId, screenplay.id)
      .then(async (snapshot) => {
        if (cancelled || !snapshot) return;
        if (matchesServer(snapshot, screenplay)) {
          await store.remove(screenplay.ownerUserId, screenplay.id, snapshot);
          return;
        }
        memoryRecovery.current = snapshot;
        setRecovery(snapshot);
      })
      .catch(() => {
        if (!cancelled) setRecoveryError(RECOVERY_ERROR);
      });
    return () => {
      cancelled = true;
    };
  }, [refs, screenplay, store]);

  useEffect(() => {
    if (!accountId || !isDirty(refs)) return;
    const timer = window.setTimeout(() => void preserve(), debounceMs);
    return () => window.clearTimeout(timer);
  }, [accountId, debounceMs, draft, paperSize, preserve, refs]);

  useEffect(() => {
    const flush = () => void preserve();
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flushWhenHidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flushWhenHidden);
    };
  }, [preserve]);

  const recoverDraft = useCallback(() => {
    if (!recovery) return;
    applySnapshot(recovery);
    setRecovery(undefined);
  }, [applySnapshot, recovery]);

  const discardRecovery = useCallback(async () => {
    if (!recovery) return;
    memoryRecovery.current = undefined;
    setRecovery(undefined);
    try {
      await store.remove(recovery.accountId, recovery.screenplayId, recovery);
    } catch {
      setRecoveryError(RECOVERY_ERROR);
    }
  }, [recovery, store]);

  const present = useCallback((snapshot: ScreenplayRecoverySnapshot) => {
    memoryRecovery.current = snapshot;
    setRecovery(snapshot);
  }, []);

  return {
    recovery,
    recoveryError,
    preserve,
    clearConfirmed,
    present,
    recoverDraft,
    discardRecovery,
    dismissRecoveryError: () => setRecoveryError(undefined),
  };
}

function isDirty(refs: RecoveryDocumentRefs): boolean {
  return (
    refs.draft.current !== refs.savedDraft.current ||
    refs.paperSize.current !== refs.savedPaperSize.current
  );
}

function matchesServer(snapshot: ScreenplayRecoverySnapshot, screenplay: Screenplay): boolean {
  return (
    snapshot.sourceText === screenplay.sourceText &&
    snapshot.paperSize === (screenplay.paperSize ?? 'letter')
  );
}

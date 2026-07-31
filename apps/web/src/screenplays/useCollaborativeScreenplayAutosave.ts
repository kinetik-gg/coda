import { useCallback, useEffect } from 'react';
import type { Screenplay } from './types';
import { useScreenplayAutosave } from './useScreenplayAutosave';
import { useScreenplayCollaboration } from './useScreenplayCollaboration';

export function useCollaborativeScreenplayAutosave(screenplayId: string, screenplay: Screenplay) {
  const collaboration = useScreenplayCollaboration(screenplayId);
  const baseAutosave = useScreenplayAutosave(screenplayId, screenplay, {
    collaborativeSource: true,
    onRecoverSource: collaboration.replaceText,
  });
  const { persist: persistMetadata, setDraft, syncServerVersion } = baseAutosave;
  const { contentReady, flush, isConnected, text: collaborationText } = collaboration;

  useEffect(() => {
    if (contentReady) setDraft(collaborationText);
  }, [collaborationText, contentReady, setDraft]);

  const persist = useCallback(async () => {
    const projectedVersion = await flush();
    if (projectedVersion !== undefined) syncServerVersion(projectedVersion);
    const metadataSaved = await persistMetadata();
    // `flush()` already resolves immediately (never hangs) when there is no live, joined socket to
    // send through — durable content already lives in the local Yjs/IndexedDB store and replays
    // once a connection returns. Blocking on `projectedVersion` in that case would trap the writer
    // in the document forever (e.g. while the session is still connecting, or offline) rather than
    // only when an actual in-flight flush attempt failed (#337).
    const collaborationSettled = projectedVersion !== undefined || !isConnected();
    return metadataSaved && collaborationSettled;
  }, [flush, isConnected, persistMetadata, syncServerVersion]);

  return { autosave: { ...baseAutosave, persist }, collaboration };
}

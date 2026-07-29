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
  const {
    contentReady,
    flush,
    saveState: collaborationSaveState,
    text: collaborationText,
  } = collaboration;

  useEffect(() => {
    if (contentReady) setDraft(collaborationText);
  }, [collaborationText, contentReady, setDraft]);

  const persist = useCallback(async () => {
    const projectedVersion = await flush();
    if (projectedVersion !== undefined) syncServerVersion(projectedVersion);
    const metadataSaved = await persistMetadata();
    return (
      metadataSaved && (projectedVersion !== undefined || collaborationSaveState === 'offline')
    );
  }, [collaborationSaveState, flush, persistMetadata, syncServerVersion]);

  return { autosave: { ...baseAutosave, persist }, collaboration };
}

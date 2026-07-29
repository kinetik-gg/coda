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
  const { persist: persistMetadata, setDraft } = baseAutosave;
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
    const [collaborationSynced, metadataSaved] = await Promise.all([flush(), persistMetadata()]);
    return metadataSaved && (collaborationSynced || collaborationSaveState === 'offline');
  }, [collaborationSaveState, flush, persistMetadata]);

  return { autosave: { ...baseAutosave, persist }, collaboration };
}

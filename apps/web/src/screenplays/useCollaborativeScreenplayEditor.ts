import { useMemo } from 'react';
import type { Screenplay } from './types';
import { useScreenplayAutosave } from './useScreenplayAutosave';
import { useScreenplayCollaboration } from './useScreenplayCollaboration';

export function useCollaborativeScreenplayEditor(screenplayId: string, screenplay: Screenplay) {
  const collaboration = useScreenplayCollaboration(screenplay);
  const autosave = useScreenplayAutosave(screenplayId, screenplay, {
    collaboration: collaboration.provider,
  });
  const binding = useMemo(
    () => ({
      awareness: collaboration.awareness,
      remoteOrigin: collaboration.remoteOrigin,
      yText: collaboration.yText,
    }),
    [collaboration.awareness, collaboration.remoteOrigin, collaboration.yText],
  );
  return { autosave, binding, collaboration };
}

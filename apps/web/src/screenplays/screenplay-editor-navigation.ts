import { useCallback } from 'react';
import type { Screenplay, ScreenplaySummary } from './types';
import type { useScreenplayAutosave } from './useScreenplayAutosave';

export interface ScreenplayEditorProps {
  screenplayId: string;
  screenplay: Screenplay;
  screenplays: ScreenplaySummary[];
  onBack: () => void;
  onOpenScreenplay: (id: string) => void;
}

export function useOpenScreenplay(
  autosave: ReturnType<typeof useScreenplayAutosave>,
  screenplayId: string,
  onOpenScreenplay: (id: string) => void,
) {
  return useCallback(
    async (id: string) => {
      if (id !== screenplayId && (await autosave.persist())) onOpenScreenplay(id);
    },
    [autosave, onOpenScreenplay, screenplayId],
  );
}

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { ScreenplayCollaborationBinding } from './screenplay-collaboration-editor';
import { ScreenplayCollaborationSession } from './screenplay-collaboration-session';

export function useScreenplayCollaboration(screenplayId: string) {
  const [session] = useState(() => new ScreenplayCollaborationSession(screenplayId));
  const saveState = useSyncExternalStore(
    session.subscribe,
    session.getSaveState,
    session.getSaveState,
  );
  const text = useSyncExternalStore(session.subscribe, session.getText, session.getText);
  const contentReady = useSyncExternalStore(
    session.subscribe,
    session.getContentReady,
    session.getContentReady,
  );
  const participants = useSyncExternalStore(
    session.subscribe,
    session.getParticipants,
    session.getParticipants,
  );
  const binding = useMemo<ScreenplayCollaborationBinding>(
    () => ({
      awareness: session.awareness,
      text: session.text,
      undoManager: session.undoManager,
      isApplyingExternalUpdate: session.isApplyingExternalUpdate,
    }),
    [session],
  );

  useEffect(
    () => () => {
      void session.destroy();
    },
    [session],
  );

  return {
    binding,
    contentReady,
    flush: () => session.flush(),
    participants,
    replaceText: session.replaceText,
    saveState,
    text,
  };
}

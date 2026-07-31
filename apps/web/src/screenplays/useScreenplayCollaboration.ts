import { useEffect, useMemo, useReducer, useRef, useSyncExternalStore } from 'react';
import type { ScreenplayCollaborationBinding } from './screenplay-collaboration-editor';
import {
  ScreenplayCollaborationSession,
  type ScreenplayCollaborationSessionOptions,
} from './screenplay-collaboration-session';

export function useScreenplayCollaboration(
  screenplayId: string,
  options?: ScreenplayCollaborationSessionOptions,
) {
  // The options are read once, when a session is constructed: a session owns a socket, a Y.Doc and
  // an IndexedDB handle, so it must not be rebuilt because a caller passed a fresh object literal.
  const optionsRef = useRef(options);
  const sessionRef = useRef<ScreenplayCollaborationSession>(undefined);
  // Lazy construction through a ref rather than `useState(() => …)`: React invokes a state
  // initializer twice under Strict Mode, which would open a second socket and a second IndexedDB
  // handle that nothing ever closes.
  sessionRef.current ??= new ScreenplayCollaborationSession(screenplayId, optionsRef.current);
  const [, adoptSession] = useReducer((generation: number) => generation + 1, 0);
  const session = sessionRef.current;
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
  const projectedVersion = useSyncExternalStore(
    session.subscribe,
    session.getProjectedVersion,
    session.getProjectedVersion,
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

  useEffect(() => {
    // React's development Strict Mode mounts every effect, tears it down, and mounts it again. The
    // cleanup below destroys the session, so the second mount would otherwise be left holding a
    // destroyed one: no socket, no join, an empty Y.Doc, and a save state frozen at `loading`. That
    // is exactly what the editor rendered as a blank document over a fully loaded screenplay
    // (#336). Replacing it here is also what makes a screenplay change safe without a remount.
    if (session.isDestroyed() || session.screenplayId !== screenplayId) {
      if (!session.isDestroyed()) void session.destroy();
      sessionRef.current = new ScreenplayCollaborationSession(screenplayId, optionsRef.current);
      adoptSession();
      return;
    }
    return () => {
      void session.destroy();
    };
  }, [screenplayId, session]);

  return {
    binding,
    contentReady,
    flush: () => session.flush(),
    participants,
    projectedVersion,
    replaceText: session.replaceText,
    saveState,
    text,
  };
}

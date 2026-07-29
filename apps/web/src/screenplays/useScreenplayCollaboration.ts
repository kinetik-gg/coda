import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { io } from 'socket.io-client';
import type { Screenplay } from './types';
import { ScreenplayCollaborationProvider } from './screenplay-collaboration-provider';

export function useScreenplayCollaboration(screenplay: Screenplay) {
  const initialVersions = useRef(new Map<string, number>());
  if (!initialVersions.current.has(screenplay.id)) {
    initialVersions.current.set(screenplay.id, screenplay.version);
  }
  const initialVersion = initialVersions.current.get(screenplay.id)!;
  const provider = useMemo(
    () =>
      new ScreenplayCollaborationProvider(
        screenplay.id,
        io({ autoConnect: false }),
        initialVersion,
      ),
    [initialVersion, screenplay.id],
  );
  useEffect(() => {
    provider.start();
    // `stop` preserves the Y.Doc across React StrictMode's setup-cleanup-setup probe. A provider
    // replaced by a different screenplay becomes unreachable after its socket listeners detach.
    return () => provider.stop();
  }, [provider]);
  const snapshot = useSyncExternalStore(
    provider.subscribe,
    () => provider.snapshot,
    () => provider.snapshot,
  );
  useEffect(() => provider.adoptVersion(screenplay.version), [provider, screenplay.version]);
  return { provider, ...snapshot };
}

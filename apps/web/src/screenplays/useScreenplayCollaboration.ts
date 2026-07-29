import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { io } from 'socket.io-client';
import type { Screenplay } from './types';
import { ScreenplayCollaborationProvider } from './screenplay-collaboration-provider';

export function useScreenplayCollaboration(screenplay: Screenplay) {
  const provider = useMemo(
    () =>
      new ScreenplayCollaborationProvider(
        screenplay.id,
        io({ autoConnect: false }),
        screenplay.version,
      ),
    [screenplay.id],
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
  return { provider, ...snapshot };
}

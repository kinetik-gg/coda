import { useEffect } from 'react';

/**
 * How the breakdown masthead asks the workspace beneath it to present the share modal.
 *
 * The masthead is a sibling of the workspace, not its parent — `App` renders both — so the request
 * travels the same way `Reset workspace` and `Publish default` already travel: a window event the
 * mounted workspace listens for. Sharing therefore opens *over* the breakdown the user is working
 * in, with no navigation and no remount, which is the whole point of the in-object entry point
 * (#176).
 */
const BREAKDOWN_SHARE_EVENT = 'coda:share-breakdown';

export function requestBreakdownShare(): void {
  window.dispatchEvent(new CustomEvent(BREAKDOWN_SHARE_EVENT));
}

export function useBreakdownShareRequests(onRequest: () => void): void {
  useEffect(() => {
    window.addEventListener(BREAKDOWN_SHARE_EVENT, onRequest);
    return () => window.removeEventListener(BREAKDOWN_SHARE_EVENT, onRequest);
  }, [onRequest]);
}

import { useEffect, useState } from 'react';

/**
 * Reports a value only once it has stopped changing for `delayMs`.
 *
 * Selection in a dense list is a *traversal*: holding ArrowDown walks every row
 * between where the user was and where they are going, and none of the rows in
 * between are a request worth making. A detail surface driven straight off
 * selection would issue a read per row — and `/api/v1/screenplays` is rate
 * limited per client, so a long traversal earns a 429 rather than a detail pane.
 *
 * Keying the reads off the settled selection collapses a traversal into one
 * read. Anything already known from the row itself should render off the live
 * selection, so the pane still follows the keyboard without waiting.
 */
export function useSettledValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    if (value === settled) return;
    const timer = window.setTimeout(() => setSettled(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, settled, delayMs]);

  return settled;
}

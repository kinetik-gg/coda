import type * as Y from 'yjs';

/** A single contiguous edit that turns one string into another. */
export interface ScreenplaySourceSplice {
  /** UTF-16 offset the edit starts at — the same index space `Y.Text` uses. */
  index: number;
  /** How many UTF-16 code units to delete at {@link index}. */
  removed: number;
  /** What to insert at {@link index} once the deletion is applied. */
  inserted: string;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * The longest shared prefix of `current` and `next`, in UTF-16 code units, never ending between the
 * two halves of a surrogate pair. `Y.Text` indexes code units exactly as JavaScript strings do, so
 * splitting a pair would insert a lone surrogate into the shared document.
 */
function sharedPrefix(current: string, next: string): number {
  const limit = Math.min(current.length, next.length);
  let length = 0;
  while (length < limit && current.charCodeAt(length) === next.charCodeAt(length)) length += 1;
  return length > 0 && isHighSurrogate(current.charCodeAt(length - 1)) ? length - 1 : length;
}

/** The longest shared suffix outside `prefix`, under the same surrogate-pair rule. */
function sharedSuffix(current: string, next: string, prefix: number): number {
  const limit = Math.min(current.length, next.length) - prefix;
  let length = 0;
  while (
    length < limit &&
    current.charCodeAt(current.length - 1 - length) === next.charCodeAt(next.length - 1 - length)
  ) {
    length += 1;
  }
  return length > 0 && isLowSurrogate(current.charCodeAt(current.length - length))
    ? length - 1
    : length;
}

/**
 * Reduces "replace the whole document with `next`" to the one splice that actually changed.
 *
 * A whole-document delete-and-reinsert would be correct in isolation but destroys every concurrent
 * collaborator's positions — cursors, selections, and the range anchors comment threads are pinned
 * to (#231) — for text that did not change. A re-conversion or repair of an imported screenplay
 * typically rewrites a fraction of the document, so the shared prefix and suffix are kept intact
 * and only the differing middle is spliced.
 */
export function screenplaySourceSplice(current: string, next: string): ScreenplaySourceSplice {
  const prefix = sharedPrefix(current, next);
  const suffix = sharedSuffix(current, next, prefix);
  return {
    index: prefix,
    removed: current.length - prefix - suffix,
    inserted: next.slice(prefix, next.length - suffix),
  };
}

/**
 * Applies {@link screenplaySourceSplice} to a `Y.Text` whose content is `current`, leaving it equal
 * to `next`. The caller owns the transaction and the resulting update; this only performs the edit.
 */
export function rewriteScreenplayText(text: Y.Text, current: string, next: string): void {
  const splice = screenplaySourceSplice(current, next);
  if (splice.removed > 0) text.delete(splice.index, splice.removed);
  if (splice.inserted.length > 0) text.insert(splice.index, splice.inserted);
}

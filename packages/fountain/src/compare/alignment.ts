import type { ScreenplayChangedRegion } from './types';

/**
 * Common-affix alignment: the cheap, exact half of the re-anchoring engine.
 *
 * Two revisions of a screenplay almost always share a long identical prefix and a long identical
 * suffix, because a person edited one area. Measuring those two affixes costs a single linear pass
 * and yields a proof rather than a guess:
 *
 * - Everything before the first differing code unit is at the *same* offset in both sources. A range
 *   that ends inside that prefix cannot have moved.
 * - Everything after the last differing code unit is at the same offset shifted by the whole-source
 *   length delta. A range that starts inside that suffix moved by exactly that delta and by nothing
 *   else.
 *
 * Only a range overlapping the window between the two affixes needs searching at all, which is what
 * keeps the engine bounded against the 5,000,000-code-unit contract ceiling however many ranges a
 * breakdown references.
 */

export interface SourceAlignment {
  readonly sourceLength: number;
  readonly targetLength: number;
  readonly identical: boolean;
  readonly prefixLength: number;
  readonly suffixLength: number;
  /** `null` when the sources are identical. */
  readonly changedRegion: ScreenplayChangedRegion | null;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * Number of leading code units the two strings share.
 *
 * Backed off by one when the boundary would land between a high and a low surrogate. Widening the
 * changed window is always safe — it only ever means a little more searching — whereas an affix
 * boundary inside a surrogate pair would let the engine propose an anchor that splits a character.
 */
export function commonPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left.charCodeAt(index) === right.charCodeAt(index)) index += 1;
  if (index > 0 && isHighSurrogate(left.charCodeAt(index - 1))) return index - 1;
  return index;
}

/**
 * Number of trailing code units the two strings share, never counting more than `limit` so the
 * suffix can never overlap an already-measured prefix.
 */
export function commonSuffixLength(left: string, right: string, limit: number): number {
  let index = 0;
  while (
    index < limit &&
    left.charCodeAt(left.length - 1 - index) === right.charCodeAt(right.length - 1 - index)
  ) {
    index += 1;
  }
  if (index > 0 && isLowSurrogate(left.charCodeAt(left.length - index))) return index - 1;
  return index;
}

export function alignSources(sourceText: string, targetText: string): SourceAlignment {
  const sourceLength = sourceText.length;
  const targetLength = targetText.length;

  if (sourceText === targetText) {
    return {
      sourceLength,
      targetLength,
      identical: true,
      prefixLength: sourceLength,
      suffixLength: 0,
      changedRegion: null,
    };
  }

  const prefixLength = commonPrefixLength(sourceText, targetText);
  const suffixLimit = Math.min(sourceLength, targetLength) - prefixLength;
  const suffixLength = commonSuffixLength(sourceText, targetText, suffixLimit);

  return {
    sourceLength,
    targetLength,
    identical: false,
    prefixLength,
    suffixLength,
    changedRegion: {
      sourceStart: prefixLength,
      sourceEnd: sourceLength - suffixLength,
      targetStart: prefixLength,
      targetEnd: targetLength - suffixLength,
    },
  };
}

/** How a range sits relative to the changed window. */
export type RangePlacement = 'unchanged-prefix' | 'unchanged-suffix' | 'overlaps-change';

export function placeRange(alignment: SourceAlignment, start: number, end: number): RangePlacement {
  const region = alignment.changedRegion;
  if (region === null) return 'unchanged-prefix';
  if (end <= region.sourceStart) return 'unchanged-prefix';
  if (start >= region.sourceEnd) return 'unchanged-suffix';
  return 'overlaps-change';
}

/**
 * The smallest window of the new source that is guaranteed to contain whatever the range's text
 * became, for a range that overlaps the changed window.
 *
 * The part of the range lying in the untouched prefix maps to itself; the part lying in the untouched
 * suffix maps by the length delta; everything between is the changed window, which by construction
 * is where the rest of it went. Clamping to those three facts gives a region that cannot be wrong,
 * only wider than necessary. An empty result means the range's text was replaced by nothing — the
 * `deleted` case.
 */
export function projectChangedRange(
  alignment: SourceAlignment,
  start: number,
  end: number,
): { start: number; end: number } {
  const region = alignment.changedRegion;
  if (region === null) return { start, end };
  const delta = alignment.targetLength - alignment.sourceLength;
  const projectedStart = start <= region.sourceStart ? start : region.sourceStart;
  const projectedEnd = end >= region.sourceEnd ? end + delta : region.targetEnd;
  return { start: projectedStart, end: Math.max(projectedStart, projectedEnd) };
}

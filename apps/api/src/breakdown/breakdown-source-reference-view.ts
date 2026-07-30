import type { SourceReferencePinSummary } from '@coda/contracts';

/** The minimal shape `attachPinSummaries` needs from a listed breakdown item. */
export interface ItemWithSourceReferences {
  sourceReferences?: ReadonlyArray<{ id: string }>;
}

const UNPINNED_SUMMARY: SourceReferencePinSummary = {
  resolution: 'unpinned',
  pin: null,
  staleness: null,
};

/**
 * Merges each item's `sourceReferences` with the current/stale/unavailable summary
 * `SourceReferenceStalenessService.summaries` computed for it, defaulting to the legacy `unpinned`
 * state for a reference with no pin row.
 *
 * Deliberately leaves an item untouched — no `sourceReferences` key added — when it did not already
 * carry one, so a caller (or a test double) that never asked for source references sees no shape
 * change from this pass.
 */
export function attachPinSummaries<T extends ItemWithSourceReferences>(
  items: readonly T[],
  summaries: ReadonlyMap<string, SourceReferencePinSummary>,
): T[] {
  return items.map((item): T => {
    // Read through the narrow, concrete `ItemWithSourceReferences` view rather than `T` directly: a
    // generic type parameter defeats `Array.isArray` narrowing and the compiler falls back to `any`
    // for everything derived from it. The single cast back to `T` below is the one unsafe step, and
    // it is sound because the merge only ever adds fields to — never removes fields from — `item`.
    // Deliberately `!== undefined` rather than `Array.isArray`: the standard library types
    // `Array.isArray` as `(arg: any) => arg is any[]`, which narrows the checked value to `any[]`
    // and would launder every element back to `any` from here on.
    const references = (item as ItemWithSourceReferences).sourceReferences;
    if (references === undefined) return item;
    const merged = references.map((reference) => ({
      ...reference,
      ...(summaries.get(reference.id) ?? UNPINNED_SUMMARY),
    }));
    return { ...item, sourceReferences: merged } as T;
  });
}

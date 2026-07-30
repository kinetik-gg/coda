import type { FountainRange } from '../types';

/**
 * The comparison and re-anchoring contract for screenplay source ranges (issue #241).
 *
 * This module is the whole public surface of the engine. The rebase preview (#242) turns a
 * `ScreenplaySourceComparison` into a plan a human reviews, and the apply step (#243) writes only
 * what the comparison marked auto-applicable or what a human explicitly decided. Everything the two
 * of them need — the decision, why it was reached, the candidate anchors, and the evidence — is on
 * these types, so neither has to re-derive a rule the engine already applied.
 *
 * ## Units and ranges
 *
 * Offsets are UTF-16 code units into the source string exactly as stored — a plain JavaScript
 * string index, no normalisation, no line-ending rewriting, no Unicode folding. Ranges are
 * half-open `[start, end)` and non-empty. That is the unit and shape fixed by
 * `SCREENPLAY_SOURCE_OFFSET_UNIT` and `screenplaySourceRangeSchema` in
 * `packages/contracts/src/breakdown-screenplay.ts`, and it is identical to `FountainRange`, so a
 * contract range can be handed to this engine and an engine range stored back with no conversion.
 *
 * The contract is deliberately not imported. `packages/fountain` has no workspace dependency on
 * `@coda/contracts`, and the contract module mirrors its own ceiling constant for exactly the same
 * leaf-module reason. The shapes are structurally identical instead, and
 * `compare-contract.test.ts` asserts the mirrored constants still agree.
 *
 * ## Returns evidence, never mutations
 *
 * Nothing here mutates anything and nothing here is I/O. A comparison reports what it found and how
 * confident it is. The caller decides.
 */

/** Mirrors `SCREENPLAY_SOURCE_OFFSET_UNIT`. Reported on every comparison so a persisted plan can assert the unit it was built against. */
export const FOUNTAIN_COMPARE_OFFSET_UNIT = 'utf16-code-unit';
export type FountainCompareOffsetUnit = typeof FOUNTAIN_COMPARE_OFFSET_UNIT;

/** Mirrors `SCREENPLAY_SOURCE_MAX_OFFSET` / `FOUNTAIN_SOURCE_MAX_CHARACTERS`. Sources longer than this are rejected. */
export const FOUNTAIN_COMPARE_MAX_SOURCE_LENGTH = 5_000_000;

/** A half-open `[start, end)` range of UTF-16 code units. Structurally identical to `ScreenplaySourceRange`. */
export type FountainSourceRange = FountainRange;

/**
 * How a referenced range in the old source relates to the new source.
 *
 * - `unchanged` — the range's text is byte-identical and sits at the same offsets. Auto-applicable.
 * - `shifted-with-identical-text` — the range's text is byte-identical and was found at exactly one
 *   place in the new source, at a different offset. Auto-applicable, because uniqueness was proven,
 *   not assumed.
 * - `materially-changed` — the range's text is gone, but the region it occupied still holds text.
 *   The engine reports that region as a candidate; it never claims the region *is* the range.
 * - `deleted` — the range's text is gone and the region it occupied holds nothing at all.
 * - `ambiguous` — the engine will not choose. Either the text matches in more than one place, or the
 *   evidence it was given contradicts itself, or it ran out of its search budget. Requires a human.
 *
 * These five values are the classification vocabulary; there is no sixth "error" state. Structurally
 * impossible input (a range outside its own source, an over-long source, a duplicate id) throws a
 * `ScreenplayComparisonError` instead, because that is a caller bug rather than a review decision.
 */
export type ScreenplayRangeClassification =
  'unchanged' | 'shifted-with-identical-text' | 'materially-changed' | 'deleted' | 'ambiguous';

/**
 * Why the classification was reached. This exists so #242 can render *why* without inferring it, and
 * so a surprising decision is debuggable from a stored plan alone.
 *
 * - `identical-source-text` — the two sources are the same string; nothing moved.
 * - `inside-unchanged-prefix` — the range lies entirely before the first differing code unit, so its
 *   offsets are forced by proof rather than by search.
 * - `inside-unchanged-suffix` — the range lies entirely after the last differing code unit, so its
 *   new offsets are forced by the length delta. Yields `unchanged` when the delta is zero.
 * - `unique-identical-match` — the excerpt occurs exactly once in the whole new source.
 * - `unique-identical-match-with-context` — the excerpt alone occurred more than once, but the
 *   excerpt surrounded by `contextCodeUnits` of its original neighbours occurs exactly once.
 * - `replacement-region` — the excerpt is gone; the region it occupied now holds different text.
 * - `replacement-region-empty` — the excerpt is gone and the region it occupied is empty.
 * - `multiple-identical-matches` — more than one plausible target survived every context width.
 * - `recorded-hash-mismatch` — the caller supplied a `recordedTextHash` that does not match the
 *   excerpt actually read out of the old source. The comparison stops there: the inputs disagree
 *   about what the range even says, so no re-anchor can be trusted.
 * - `search-budget-exhausted` — the request's `maxSearchPasses` ran out before this range could be
 *   resolved. Reported honestly rather than resolved by guessing.
 */
export type ScreenplayComparisonReason =
  | 'identical-source-text'
  | 'inside-unchanged-prefix'
  | 'inside-unchanged-suffix'
  | 'unique-identical-match'
  | 'unique-identical-match-with-context'
  | 'replacement-region'
  | 'replacement-region-empty'
  | 'multiple-identical-matches'
  | 'recorded-hash-mismatch'
  | 'search-budget-exhausted';

/** A place in the new source the range might belong. Never a decision on its own. */
export interface ScreenplayRangeCandidate {
  /** Half-open range in the *new* source. Non-empty, so it is a valid contract range as-is. */
  readonly range: FountainSourceRange;
  /** `targetText.slice(range.start, range.end)`. */
  readonly text: string;
  /** Lowercase hex SHA-256 of the UTF-8 encoding of `text`, per the contract's hash rule. */
  readonly textHash: string;
  /** Whether `text` equals the old excerpt exactly. False for every `materially-changed` candidate. */
  readonly identicalText: boolean;
  /** Whether this candidate starts at the range's original offset. */
  readonly atSourceOffset: boolean;
  /** `range.start - sourceRange.start`. */
  readonly shift: number;
  /**
   * How many code units of original surrounding context were needed to produce this candidate.
   * `0` means the excerpt alone; a larger number means the excerpt was ambiguous by itself.
   */
  readonly contextCodeUnits: number;
}

/** What the engine read out of the old source, and whether the caller's evidence agreed. */
export interface ScreenplayRangeSourceEvidence {
  readonly range: FountainSourceRange;
  readonly text: string;
  readonly textHash: string;
  /** The hash the caller recorded when the pin was made, or `null` when none was supplied. */
  readonly recordedTextHash: string | null;
  /** `null` when no hash was supplied, otherwise whether it matched `textHash`. */
  readonly recordedTextHashMatches: boolean | null;
}

/** The engine's verdict on one referenced range. */
export interface ScreenplayRangeComparison {
  /** The caller's correlation id, echoed unchanged. Typically a pin or source-reference id. */
  readonly id: string;
  readonly classification: ScreenplayRangeClassification;
  readonly reason: ScreenplayComparisonReason;
  /**
   * Whether #243 may carry this pin forward with no human decision.
   *
   * True only for `unchanged` and `shifted-with-identical-text`, and only ever set on a proven
   * unique byte-identical anchor. It is a field rather than a rule the caller re-derives so that
   * "what may apply silently" is decided once, here, next to the evidence that justifies it.
   */
  readonly autoApplicable: boolean;
  readonly source: ScreenplayRangeSourceEvidence;
  /**
   * The single proposed anchor, or `null` when there is nothing to propose.
   *
   * Set for `unchanged`, `shifted-with-identical-text`, and `materially-changed` — for the last of
   * those it is a *proposal to review*, not an answer, and `autoApplicable` is false. Always `null`
   * for `deleted` and for `ambiguous`: with no target or several, presenting one would be the
   * silent guess this engine exists to avoid.
   */
  readonly target: ScreenplayRangeCandidate | null;
  /**
   * Every plausible target the engine found, in ascending offset order.
   *
   * Length 0 for `deleted` and for a `recorded-hash-mismatch` or budget-exhausted `ambiguous`;
   * length 1 for a resolved range; length 2 or more only for `multiple-identical-matches`, where it
   * is exactly the choice a human has to make.
   */
  readonly candidates: readonly ScreenplayRangeCandidate[];
  /** True when more matches exist than `maxCandidates` allowed the engine to report. */
  readonly candidatesTruncated: boolean;
}

/** The region of each source that could possibly have been edited, derived from the common affixes. */
export interface ScreenplayChangedRegion {
  /** Half-open in the old source. `start === end` for a pure insertion. */
  readonly sourceStart: number;
  readonly sourceEnd: number;
  /** Half-open in the new source. `start === end` for a pure deletion. */
  readonly targetStart: number;
  readonly targetEnd: number;
}

/** Bounded-work accounting, so a caller can tell a clean result from a truncated one. */
export interface ScreenplayComparisonBudget {
  /** Full-source scans this request was allowed. */
  readonly maxSearchPasses: number;
  /** Full-source scans it actually spent. Ranges resolved from the common affixes cost zero. */
  readonly searchPassesUsed: number;
  /** True when at least one range's search stopped early because the budget ran out. */
  readonly exhausted: boolean;
}

export interface ScreenplayComparisonOptions {
  /**
   * Upper bound on full-source substring scans, which is what bounds the engine's work against the
   * 5,000,000-code-unit ceiling. Ranges that fall wholly inside an unchanged prefix or suffix are
   * resolved without any scan, so a typical single-region edit spends a handful of passes no matter
   * how many ranges were referenced. Default 128.
   */
  readonly maxSearchPasses?: number;
  /** Maximum candidates reported per range before `candidatesTruncated` is set. Default 16. */
  readonly maxCandidates?: number;
  /**
   * Ascending context widths, in code units, tried in order to disambiguate a repeated excerpt. The
   * first width that yields exactly one match resolves the range. Default `[32, 128, 512]`; an empty
   * array disables context disambiguation entirely.
   */
  readonly contextWidths?: readonly number[];
}

/** One referenced range to compare. */
export interface ScreenplayRangeQuery {
  /** Caller correlation id, unique within a request, echoed onto the result. */
  readonly id: string;
  /** Half-open, non-empty, and within the old source. */
  readonly range: FountainSourceRange;
  /**
   * The `sourceTextHash` recorded with the pin, if the caller has it.
   *
   * Supplying it is how a caller detects that its own records disagree with the revision text it
   * just read. A mismatch is reported as `ambiguous` / `recorded-hash-mismatch` rather than thrown,
   * because it is a real condition a human should see, not a programming error.
   */
  readonly recordedTextHash?: string;
}

export interface ScreenplayComparisonRequest {
  /** The old revision's `sourceText`, exactly as stored. */
  readonly sourceText: string;
  /** The new revision's `sourceText`, exactly as stored. */
  readonly targetText: string;
  /** Only the ranges the caller actually references. The engine never enumerates ranges itself. */
  readonly ranges: readonly ScreenplayRangeQuery[];
  readonly options?: ScreenplayComparisonOptions;
}

export interface ScreenplaySourceComparison {
  readonly offsetUnit: FountainCompareOffsetUnit;
  readonly sourceLength: number;
  readonly targetLength: number;
  readonly identicalSources: boolean;
  /** Length of the common prefix of the two sources, snapped off any split surrogate pair. */
  readonly commonPrefixLength: number;
  /** Length of the common suffix, clipped against the prefix and snapped off any split pair. */
  readonly commonSuffixLength: number;
  /** `null` when the sources are identical. */
  readonly changedRegion: ScreenplayChangedRegion | null;
  /** One entry per query, in the order the queries were given. */
  readonly ranges: readonly ScreenplayRangeComparison[];
  readonly budget: ScreenplayComparisonBudget;
}

export type ScreenplayComparisonErrorCode =
  | 'source-too-long'
  | 'target-too-long'
  | 'range-out-of-bounds'
  | 'empty-range'
  | 'non-integer-range'
  | 'duplicate-range-id'
  | 'invalid-option';

/**
 * Thrown for input that cannot describe a real comparison.
 *
 * These are all conditions the contract's own Zod schema plus an immutable revision's stored text
 * already rule out, so a caller that validated its input never sees one. Keeping them as throws
 * rather than a sixth classification means every value in `ScreenplayRangeClassification` is a
 * statement about the screenplay, not about the request.
 */
export class ScreenplayComparisonError extends Error {
  public readonly code: ScreenplayComparisonErrorCode;
  public readonly rangeId: string | null;

  public constructor(code: ScreenplayComparisonErrorCode, message: string, rangeId?: string) {
    super(message);
    this.name = 'ScreenplayComparisonError';
    this.code = code;
    this.rangeId = rangeId ?? null;
  }
}

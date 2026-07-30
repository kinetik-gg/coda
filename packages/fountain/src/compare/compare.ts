import { alignSources } from './alignment';
import { classifyRange } from './classify';
import { assertRequest, resolveOptions } from './request';
import { SearchBudget } from './search';
import {
  FOUNTAIN_COMPARE_OFFSET_UNIT,
  type ScreenplayComparisonRequest,
  type ScreenplayRangeComparison,
  type ScreenplaySourceComparison,
} from './types';

/**
 * Compares two screenplay sources over only the ranges a caller actually references, and reports how
 * each range re-anchors — or refuses to.
 *
 * Pure: no I/O, no clock, no randomness, no shared state between calls. The same request always
 * produces a structurally identical result, in the order the ranges were given, which is what lets
 * #242 persist a rebase plan and #243 later verify that plan was built against the same text.
 *
 * The engine returns evidence, never mutations. `autoApplicable` marks the two verdicts a caller may
 * carry forward without asking — a range whose text is byte-identical at offsets fixed by an
 * unchanged prefix or suffix, or one whose text was found in exactly one place. Everything else is a
 * decision for a person, and `reason` says why.
 *
 * @throws ScreenplayComparisonError for input that cannot describe a comparison: a source past the
 * 5,000,000-code-unit ceiling, an empty or non-integer or out-of-bounds range, a duplicate range id,
 * or a nonsensical option. Those are all caller bugs; they deliberately do not become classifications.
 */
export function compareScreenplaySources(
  request: ScreenplayComparisonRequest,
): ScreenplaySourceComparison {
  assertRequest(request);
  const options = resolveOptions(request.options);
  const { sourceText, targetText } = request;
  const alignment = alignSources(sourceText, targetText);
  const budget = new SearchBudget(options.maxSearchPasses);

  const ranges: ScreenplayRangeComparison[] = [];
  let exhausted = false;
  for (const query of request.ranges) {
    const result = classifyRange(query, { sourceText, targetText }, alignment, {
      options,
      budget,
    });
    ranges.push(result.comparison);
    exhausted ||= result.budgetExhausted;
  }

  return {
    offsetUnit: FOUNTAIN_COMPARE_OFFSET_UNIT,
    sourceLength: alignment.sourceLength,
    targetLength: alignment.targetLength,
    identicalSources: alignment.identical,
    commonPrefixLength: alignment.prefixLength,
    commonSuffixLength: alignment.suffixLength,
    changedRegion: alignment.changedRegion,
    ranges,
    budget: {
      maxSearchPasses: options.maxSearchPasses,
      searchPassesUsed: budget.used,
      exhausted,
    },
  };
}
